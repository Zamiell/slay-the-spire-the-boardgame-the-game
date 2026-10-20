// One verifier for every skin with a staged attack: each registered skin that has one (config in
// scripts/animation/skins/<skin>.json) plus the synthetic test skins of scripts/animation/test-skins,
// which keep the generic path covered before real art exists. Flags: --skin=<id>, --engine=, --screen=.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { installAttackFixture, paintedBounds, startAttackServer } from './lib/skin-attack-fixture.mjs'
import { SKIN_IDS, characterOfSkin, skinTraits } from '../src/game/skins.ts'
import { STAGED_ATTACKS } from '../src/ui/combat-screen/staged-attacks.ts'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/skin-attack/browser')
mkdirSync(output, { recursive: true })
const { origin, fixture, css: fixtureCss, dir: fixtureDir, close } = await startAttackServer(root)
const idle = '.seat__portrait > img'
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)

// The hero's own cards that attack, with how many enemies each hits (Cleave and Dagger Spray strike both).
const ATTACK_CARDS = {
  ironclad: [['strike_ironclad', 1], ['cleave', 2], ['twin_strike', 1]],
  silent: [['strike_silent', 1], ['dagger_spray', 2]],
  watcher: [['strike_watcher', 1], ['eruption', 1]],
  // Flame Tackle hits every enemy, then Commands a Slime (`command`: its target, `commandDamage`: what it deals). Only
  // `heroDamage` belongs to the hero's staged strike; the Slime's damage lands on its own Command beat.
  slime_boss: [['slime_boss_strike', 1], ['slime_boss_flame_tackle', 2, { command: 'enemy-0', commandDamage: 1, heroDamage: 2 }]],
}
const fileOf = pose => pose === 'idle' ? 'ready' : pose
// Every timed check follows the config's clock rather than restating its milliseconds.
function profile(config, table, synthetic) {
  const character = config.character ?? characterOfSkin(config.skin)
  const cards = ATTACK_CARDS[character]
  assert(cards, `${config.skin}: list ${character}'s attack cards in ATTACK_CARDS`)
  const keyEnds = [...config.keys.slice(1).map(([time]) => time), config.durationMs]
  const beats = config.keys.map(([time, pose], index) => [fileOf(pose), (time + keyEnds[index]) / 2])
  const lastHit = table.hits.at(-1)
  const framePose = fileOf(config.contactPoses.at(Math.min(1, config.contactPoses.length - 1)))
  return {
    skin: config.skin, character, cards, config, table, synthetic, beats,
    sounds: [...new Set([...table.cues, ...table.hits].map(step => `${step.sound}.mp3`))],
    hitSounds: table.hits.map(hit => `${hit.sound}.mp3`),
    beat: pose => beats.find(([name]) => name === pose)[1],
    idleReturn: config.keys.at(-1)[0],
    // Every registered drawing plus the hit VFX.
    assetsReady: table.poses.length + new Set(table.hits.map(hit => hit.vfx)).size,
    // The drawings shown while the actor is out at the target, each sampled mid-way through the part of its key
    // between arrival and departure.
    strikeBeats: config.keys.flatMap(([time, pose], index) => {
      const start = Math.max(time, config.travel.out[1]), end = Math.min(keyEnds[index], config.travel.back[0])
      return start < end ? [[fileOf(pose), (start + end) / 2]] : []
    }),
    framePose,
    // Grounded drawings (every drawing the config does not list as airborne) travel at most this fast; flight drawings are free.
    groundSpeed: config.audit?.tolerances?.groundSpeedPxPerMs,
    airborne: new Set(Object.keys(config.audit?.airborne ?? {}).map(fileOf)),
    // The cold play delays the drawing shown at the last hit.
    coldFile: `${config.skin}-${fileOf(config.keys.findLast(([time]) => time <= lastHit.ms)[1])}.webp`,
    cumulative: table.hits.map((_, index) => table.hits.slice(0, index + 1).reduce((sum, hit) => sum + hit.weight, 0)),
    // The registered Kratos drawing is sampled for its ash-white skin; solid test shapes by plain colour.
    ashMask: !synthetic,
    sourcePath: synthetic ? resolve(fixtureDir, `assets/combat/characters/animated/${config.skin}-${framePose}.webp`)
      : resolve(root, `public/assets/combat/characters/animated/${config.skin}-${framePose}.webp`),
  }
}
const registered = SKIN_IDS.filter(skin => skinTraits(skin)?.stagedAttack).map(skin => {
  assert(Object.hasOwn(STAGED_ATTACKS, skin), `${skin} has the stagedAttack trait but no scripts/animation/skins/${skin}.json`)
  return profile(JSON.parse(readFileSync(resolve(root, `scripts/animation/skins/${skin}.json`), 'utf8')), STAGED_ATTACKS[skin], false)
})
const synthetic = Object.values(fixture.configs).map(config => profile(config, fixture.table[config.skin], true))
const profiles = [...registered, ...synthetic].filter(entry => !arg('skin') || entry.skin === arg('skin'))
assert(profiles.length > 0, `no staged attack skin ${arg('skin')}`)
const errors = []
// Tolerance for a pinned flash against the landmark, in edges of the drawn canvas (about 5px at 480px): the measured miss is 0.1%, so 1% leaves room for rounding only.
const PIN_TOLERANCE = 0.01
// How far the lethal combo's target may leave from its table-derived moment on the fake clock (a Hermit volley's span is 169ms off Watcher's).
const LETHAL_COMBO_TOLERANCE_MS = 25
const ACTOR_DEFEAT_MS = 1800
async function assertPinnedFlashesOnTip(page, p, label, frozenAt) {
  for (const [index, hit] of p.config.hits.entries()) {
    if (!hit.pin) continue
    const tip = p.config.audit.landmarks[hit.at].props.staff[0]
    const seen = await page.evaluate(({ ms, index, frozenAt }) => {
      const attack = document.querySelector('.character-attack')
      const animations = [...document.querySelectorAll('.character-attack, .staged-hit')].flatMap(node => node.getAnimations({ subtree: true }))
      animations.forEach(animation => { animation.currentTime = ms })
      const image = [...attack.querySelectorAll('.character-attack__pose img')].find(node => Number(getComputedStyle(node.parentElement).opacity) > .5)
      const flash = document.querySelector(`.staged-hit[data-combo-beat="${index}"]`)
      const portrait = flash.offsetParent.getBoundingClientRect()
      const rect = image.getBoundingClientRect()
      const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
      const result = { src: image.src, fit, edge: Math.min(rect.width, rect.height), left: rect.left + (rect.width - image.naturalWidth * fit) / 2,
        top: rect.bottom - image.naturalHeight * fit, anchor: [portrait.left + flash.offsetLeft, portrait.top + flash.offsetTop] }
      animations.forEach(animation => { animation.currentTime = frozenAt })
      return result
    }, { ms: p.table.hits[index].ms + 40, index, frozenAt })
    assert(seen.src.endsWith(`-${hit.at}.webp`), `${label}: the pinned flash's drawing ${hit.at} is not showing at ${p.table.hits[index].ms}ms (${seen.src})`)
    const expected = [seen.left + tip[0] * seen.fit, seen.top + tip[1] * seen.fit]
    const miss = Math.hypot(seen.anchor[0] - expected[0], seen.anchor[1] - expected[1]) / seen.edge
    assert(miss < PIN_TOLERANCE, `${label}: the ${hit.at} flash anchors ${(miss * 100).toFixed(1)}% of the drawing from the prop tip ${JSON.stringify({ anchor: seen.anchor, expected })}`)
  }
}
// A skin dresses Slime Boss and nothing else: her slimes keep the plain hero's layout and stay in front of the skin's drawing,
// and she summons from the skin's own drawing (`<skin>-spawn.webp`), falling back to the idle drawing (`<skin>-hero.webp`).
async function assertSlimeFormation(page, p, label) {
  const setup = wear => page.evaluate(async wear => {
    const { bruiserSlime } = await import('/src/game/downfall/slime-boss.ts')
    const f = window.attackFixture
    document.documentElement.dataset.reducedMotion = 'false'
    f.reset('slime_boss', wear)
    f.state.players[0].slimes = [bruiserSlime('a'), bruiserSlime('b'), bruiserSlime('c')]
    f.render()
  }, wear)
  const measure = async () => {
    await page.waitForFunction(() => [...document.querySelectorAll('.slime-party__art')].every(image => image.complete && image.naturalWidth > 0))
    return page.evaluate(() => {
      const box = node => { const r = node.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }
      const covers = actor => {
        const [x, y, width, height] = box(actor)
        const stack = document.elementsFromPoint(x + width / 2, y + height / 2)
        const hero = stack.findIndex(node => node.closest('.seat__portrait, .character-attack'))
        return !stack.includes(actor) || hero >= 0 && hero < stack.indexOf(actor)
      }
      const actors = [...document.querySelectorAll('.slime-party__actor')]
      return { seat: box(document.querySelector('.seat__portrait')), hp: box(document.querySelector('.seat__interactive .bar')), actors: actors.map(box),
        covered: actors.filter(covers).length }
    })
  }
  await setup(null)
  const plain = await measure()
  await setup(p.skin)
  const worn = await measure()
  assert.equal(worn.actors.length, 3, `${label}: the skinned Slime Boss lost slimes`)
  assert.equal(worn.covered, 0, `${label}: a slime is hidden behind the skin ${JSON.stringify(worn)}`)
  for (const key of ['seat', 'hp']) assert(worn[key].every((value, index) => Math.abs(value - plain[key][index]) < .6), `${label}: the skin moves the hero's ${key} ${JSON.stringify({ plain: plain[key], worn: worn[key] })}`)
  assert(worn.actors.flat().every((value, index) => Math.abs(value - plain.actors.flat()[index]) < .6), `${label}: the skin moves the slime formation ${JSON.stringify({ plain: plain.actors, worn: worn.actors })}`)
  // The hero out at the target never covers her slimes.
  const coveredWhileAttacking = await page.evaluate(card => new Promise(resolve => {
    const actors = [...document.querySelectorAll('.slime-party__actor')]
    const covers = actor => {
      const r = actor.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const hero = stack.findIndex(node => node.closest('.seat__portrait, .character-attack'))
      return !stack.includes(actor) || hero >= 0 && hero < stack.indexOf(actor)
    }
    let covered = 0, frames = 0
    const sample = () => {
      covered = Math.max(covered, actors.filter(covers).length)
      if (++frames < 120 || document.querySelector('.character-attack')) requestAnimationFrame(sample); else resolve(covered)
    }
    window.attackFixture.attack(card)
    sample()
  }), p.cards[0][0])
  assert.equal(coveredWhileAttacking, 0, `${label}: the attack covers a slime`)
  // The summon: a Slime card shows the skin's drawing, or the idle drawing without one.
  const summon = async (seq, wanted) => {
    await page.evaluate(seq => {
      const f = window.attackFixture
      f.state.presentationEvents = [{ kind: 'card', seq, actorId: 'p1', sourceId: 'slime_boss_bruiser_slime', enemyIds: [], playerIds: [], upgraded: false, copied: false, energy: 1 }]
      f.render()
    }, seq)
    await page.waitForFunction(wanted => {
      const image = document.querySelector('.seat__portrait > img[data-static-art]')
      return image?.complete && image.naturalWidth > 0 && image.src.endsWith(wanted)
    }, wanted)
    const shown = await measure()
    assert.equal(shown.covered, 0, `${label}: a slime is hidden while the hero summons`)
    assert(shown.actors.flat().every((value, index) => Math.abs(value - worn.actors.flat()[index]) < .6), `${label}: the summon moves the slimes`)
  }
  const missingSpawn = `**/${p.skin}-spawn.webp`
  await page.route(missingSpawn, route => route.fulfill({ status: 404 }))
  await setup(p.skin)
  await summon(900, `/${p.skin}-hero.webp`)
  await page.unroute(missingSpawn)
  // The 404 was the point: it is not a missing-artwork error.
  errors.splice(0, errors.length, ...errors.filter(error => !error.endsWith(`/${p.skin}-spawn.webp`)))
  await setup(p.skin)
  await summon(901, `/${p.skin}-spawn.webp`)
  await page.evaluate(() => window.attackFixture.reset())
}
async function run(browser, engine, screen, viewport, p) {
  const { config, table, beats, strikeBeats, assetsReady } = p
  const skin = p.skin
  const canvas = config.canvas
  const contactFiles = config.contactPoses.map(fileOf)
  const framePose = `.character-attack__pose--${skin}-${p.framePose} img`
  const hero = `/${skin}-hero.webp`
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: screen !== 'desktop',
    hasTouch: screen !== 'desktop',
    ...(process.argv.includes('--record') ? { recordVideo: { dir: output, size: viewport } } : {}) })
  let releaseColdArtwork
  try {
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(String(e)))
    const soundRequests = new Set()
    page.on('request', request => { if (/\/sfx\//.test(request.url())) soundRequests.add(new URL(request.url()).pathname.split('/').at(-1)) })
    await page.addInitScript(() => {
      window.skinSounds = []
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...args) {
        if (this instanceof HTMLAudioElement) {
          window.skinSounds.push({ path: new URL(this.src).pathname.split('/').at(-1), at: performance.now() })
          return Promise.resolve()
        }
        return play.apply(this, args)
      }
    })
    page.on('response', r => { if (r.status() >= 400 && /\/assets\/combat\//.test(r.url())) errors.push(`${r.status()} ${r.url()}`) })
    const coldArtwork = new Promise(resolve => { releaseColdArtwork = resolve })
    await page.route(`**/${p.coldFile}`, async route => {
      await coldArtwork
      await route.continue()
    })
    await page.goto(origin)
    await page.evaluate(installAttackFixture, { character: p.character, skin, strike: p.cards[0][0] })
    if (p.synthetic) await page.addStyleTag({ content: fixtureCss })
    await page.waitForFunction(() => {
      const image = document.querySelector('.seat__portrait > img')
      return image?.complete && image.naturalWidth > 0
    })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => [...document.querySelectorAll('.enemy__portrait img')].every(image => image.complete))
    await page.locator('.board').screenshot({ path: resolve(output, `${skin}-${engine}-${screen}-cold-rest.png`) })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // A truly cold play must still travel and hit on one shared clock.
    // Delaying beyond the event lifetime reproduces the reviewed regression.
    const cold = await page.evaluate(hitMs => new Promise((resolve, reject) => {
      const onImpact = event => {
        if (event.detail.index !== 0) return
        clearTimeout(timeout)
        document.removeEventListener('staged-impact', onImpact)
        const attack = document.querySelector('.character-attack')
        if (!attack) { reject(new Error('cold impact lost its attacking character')); return }
        const transform = getComputedStyle(attack).transform
        const time = attack.getAnimations()[0]?.currentTime
        const target = document.querySelector(`[data-staged-impact-seq="${event.detail.seq}"]`)
        // A renderer can deliver the event after a short attack has already returned home (a 1000ms strike is out at the
        // target for about 200ms): where the box stands at the hit's own beat is read on the same clock, then put back.
        const [animation] = attack.getAnimations()
        animation.currentTime = hitMs
        const atHit = new DOMMatrix(getComputedStyle(attack).transform).e
        animation.currentTime = time
        resolve({
          time, targetTime: target?.getAnimations()[0]?.currentTime,
          start: attack.getAnimations()[0]?.startTime, targetStart: target?.getAnimations()[0]?.startTime,
          x: new DOMMatrix(transform).e, atHit, fallback: Boolean(attack.querySelector('.is-fallback')),
          goal: getComputedStyle(attack).getPropertyValue('--attack-x'),
        })
      }
      const timeout = setTimeout(() => {
        document.removeEventListener('staged-impact', onImpact)
        reject(new Error('cold combo never produced its first impact'))
      }, 15000)
      document.addEventListener('staged-impact', onImpact)
      window.attackFixture.attack()
    }), table.hits[0].ms).catch(error => { throw new Error(`${engine}/${screen}: ${error.message}`, { cause: error }) })
    assert(cold.fallback && Math.max(cold.x, cold.atHit) > 10, `${engine}/${screen}: cold cutout never travels ${JSON.stringify(cold)}`)
    // WebKit clamps a finished impact's currentTime at delay + duration.
    // startTime is the shared clock even when a busy renderer reports it late.
    assert(Number.isFinite(cold.start) && Number.isFinite(cold.targetStart) &&
      Math.abs(cold.start - cold.targetStart) < 2, `cold attacker and target clocks separated: ${JSON.stringify(cold)}`)
    // Artwork landing mid-play must not swap in the drawings or re-aim the travel.
    // Sample every frame of the play from before the release: whatever the load, each frame after the artwork is ready is judged.
    await page.evaluate(ready => {
      const state = window.coldSamples = { samples: [], stop: false }
      const tick = () => {
        const attack = document.querySelector('.character-attack')
        if (attack) state.samples.push({ ready: Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === ready,
          fallback: Boolean(attack.querySelector('.is-fallback')), goal: getComputedStyle(attack).getPropertyValue('--attack-x') })
        if (!state.stop) requestAnimationFrame(tick)
      }
      tick()
    }, assetsReady)
    releaseColdArtwork()
    await page.waitForFunction(ready => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === ready, assetsReady).catch(async error => {
      throw new Error(`${engine}/${screen}: warmup ${JSON.stringify(await page.locator('.board').evaluate(node => node.dataset))} ${JSON.stringify(errors)}`, { cause: error })
    })
    await page.waitForFunction(() => !document.querySelector('.character-attack'))
    const samples = await page.evaluate(() => { window.coldSamples.stop = true; return window.coldSamples.samples })
    const late = samples.filter(sample => sample.ready)
    assert.deepEqual(samples.filter(sample => !sample.fallback || sample.goal !== cold.goal), [], `${engine}/${screen}: late artwork changed the cold play`)
    // On a loaded renderer the whole play can end before the artwork is ready; there is then no late frame to judge.
    if (late.length === 0) console.warn(`${engine}/${screen}/${skin}: the cold play ended before its artwork was ready (${samples.length} frames sampled)`)
    await page.unroute(`**/${p.coldFile}`)
    const rest = await page.evaluate(paintedBounds, idle)
    assert(rest.width > 45 && rest.height > 70, `${engine}/${screen}: missing or tiny actor`)
    assert.deepEqual(await page.locator(idle).evaluate(image => [
      getComputedStyle(image).filter, getComputedStyle(image.closest('.seat')).filter,
    ]), ['none', 'none'], `${engine}/${screen}: filters pixelate overscanned idle in WebKit`)
    await page.locator('.board').screenshot({ path: resolve(output, `${skin}-${engine}-${screen}-idle.png`) })
    for (const [card, targetCount, choices] of p.cards) {
      const label = `${engine}/${screen}/${card}`
      // Capture live beats in one page call; browser round trips can outlast
      // a whole pose on a busy phone renderer.
      const played = await page.evaluate(({ card, choices, idleReturn, rest }) => new Promise((resolve, reject) => {
        const impacts = []
        const numbers = []
        const frameStats = { maxBodies: 0, goal: 0 }
        const damage = new Map()
        window.skinSounds = []
        const onImpact = event => {
          const enemy = event.target.closest('.enemy')
          queueMicrotask(() => impacts.push({ seq: event.detail.seq, index: event.detail.index,
            target: enemy.dataset.enemyId,
            hp: Number(enemy.querySelector('.bar__label').textContent.split('/')[0]),
            dead: enemy.classList.contains('enemy--dead') }))
        }
        document.addEventListener('staged-impact', onImpact)
        const observer = new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.matches('.hermit-damage-number')) numbers.push({
              target: record.target.closest('.enemy').dataset.enemyId, damage: Number(node.dataset.damage) })
          }
        })
        observer.observe(document.querySelector('.board'), { childList: true, subtree: true })
        const before = new Map(window.attackFixture.state.enemies.map(enemy => [enemy.uid, enemy.hp]))
        const seq = window.attackFixture.attack(card, choices)
        const event = window.attackFixture.state.presentationEvents.find(candidate => candidate.seq === seq)
        event.enemyIds.forEach(id => damage.set(id, event.enemyHpLoss[id] ?? 0))
        const started = performance.now()
        let last
        const finish = (error, result) => {
          document.removeEventListener('staged-impact', onImpact); observer.disconnect()
          error ? reject(error) : resolve(result)
        }
        const sample = () => {
          const attack = document.querySelector(`.character-attack[data-attack-seq="${seq}"]`)
          const time = attack?.getAnimations()[0]?.currentTime
          if (typeof time === 'number') {
            const portrait = attack.closest('.seat__portrait')
            const visible = [...attack.querySelectorAll('.character-attack__pose > img')]
              .filter(image => Number(getComputedStyle(image.parentElement).opacity) > .5)
            const image = visible[0]
            last = { time, src: image?.src, bodies: visible.length }
            frameStats.maxBodies = Math.max(frameStats.maxBodies, visible.length)
            frameStats.goal = Math.max(frameStats.goal, parseFloat(getComputedStyle(attack).getPropertyValue('--attack-x')) || 0)
            if (time >= idleReturn + 20 && visible.length === 1 && image?.src.endsWith(rest)) {
              const returned = new DOMMatrix(getComputedStyle(attack).transform).e
              if (Math.abs(returned) < .5) return finish(null, { frameStats, impacts,
                numbers, returned, damage: Object.fromEntries(damage), before: Object.fromEntries(before),
                sounds: window.skinSounds, age: performance.now() - started })
            }
          }
          if (performance.now() - started > 6000) finish(new Error(`combo/return never painted ${JSON.stringify(last)}`))
          else setTimeout(sample, 16)
        }
        sample()
      }), { card, choices, idleReturn: p.idleReturn, rest: `/${skin}-ready.webp` }).catch(error => { throw new Error(`${label}: ${error.message}`, { cause: error }) })
      assert.equal(played.frameStats.maxBodies, 1, `${label}: missing or duplicated attacker`)
      // The travel's goal, not a polled transform: on a loaded renderer polling can miss the whole out-at-target window.
      // The frozen-clock stance check below proves the weapon lands inside the target.
      assert(played.frameStats.goal > 10, `${label}: the actor never reaches the target`)
      assert.equal(Object.keys(played.damage).length, targetCount, 'wrong authoritative targets')
      for (const [target, total] of Object.entries(played.damage)) {
        const hits = played.impacts.filter(impact => impact.target === target)
        assert.deepEqual(hits.map(hit => hit.index), table.hits.map((_, index) => index), `${label}: missing/repeated/out-of-order impacts`)
        if (choices?.heroDamage !== undefined) assert.equal(total, choices.heroDamage, `${label}: the Slime's damage was weighed into the hero's strike`)
        // The Slime's own damage shows 450ms or more after the hero's first beat; a renderer that delivers a beat later than
        // that has already shown it, so a Command target may read that much lower.
        const late = choices?.command === target ? choices.commandDamage : 0
        for (const [index, fraction] of p.cumulative.entries()) {
          const expected = played.before[target] - total * fraction
          assert([expected, expected - late].some(hp => Math.abs(hits[index].hp - hp) < 1e-8),
            `${label}: wrong visible HP at beat ${index + 1}: ${JSON.stringify(hits)}`)
        }
        const numbers = played.numbers.filter(number => number.target === target)
        assert.equal(numbers.length, total > 0 ? table.hits.length : 0, `${label}: damage numbers duplicated`)
        numbers.forEach((number, index) => assert(Math.abs(number.damage - total * table.hits[index].weight) < 1e-8,
          `${label}: wrong weighted number ${JSON.stringify(number)}`))
      }
      if (engine === 'chromium') assert.deepEqual(played.sounds.filter(sound =>
        p.hitSounds.includes(sound.path)).map(sound => sound.path),
        p.hitSounds, 'impact SFX missing, repeated or out of order')
      await page.waitForFunction(() => !document.querySelector('.character-attack'))
      await page.locator('.board').screenshot({ path: resolve(output, `${skin}-${engine}-${screen}-${card}-returned.png`) })
    }
    // Snapshot the registered contact drawing after live playback checks.
    // Freezing every visual clock makes the exported frame reviewable.
    await page.evaluate(() => window.attackFixture.reset())
    await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-10-05T00:00:10Z'))
    const frozenSeq = await page.evaluate(() => window.attackFixture.attack())
    await page.locator(framePose).waitFor({ state: 'attached' })
    const frozenAt = p.beat(p.framePose)
    await page.evaluate(async ({ seq, frozenAt }) => {
      await Promise.all([...document.querySelectorAll('.character-attack__pose img')].map(image => image.decode()))
      const animations = [...document.querySelectorAll(`.character-attack, [data-staged-impact-seq="${seq}"]`)]
        .flatMap(node => node.getAnimations({ subtree: true }))
      animations.forEach(animation => animation.pause())
      await Promise.all(animations.map(animation => animation.ready))
      animations.forEach(animation => { animation.currentTime = frozenAt })
    }, { seq: frozenSeq, frozenAt })
    const poseChecks = await page.evaluate(({ beats, frozenAt, canvas }) => {
      const attack = document.querySelector('.character-attack')
      const animations = attack.getAnimations({ subtree: true })
      const checks = beats.map(([pose, time]) => {
          animations.forEach(animation => { animation.currentTime = time })
          const visible = [...attack.querySelectorAll('.character-attack__pose img')]
            .filter(image => Number(getComputedStyle(image.parentElement).opacity) > .5)
          return { pose, time, count: visible.length, src: visible[0]?.src,
            decoded: visible[0]?.complete && visible[0].naturalWidth === canvas }
        })
      animations.forEach(animation => { animation.currentTime = frozenAt })
      return checks
    }, { beats, frozenAt, canvas })
    for (const drawing of poseChecks) assert(drawing.count === 1 && drawing.decoded &&
      drawing.src.endsWith(`/${skin}-${drawing.pose}.webp`),
      `${engine}/${screen}: timed pose missing or duplicated ${JSON.stringify(drawing)}`)
    // While the actor is out it stands still: one travel, a planted rear sole, and one
    // blade-tip line for both light hits and the slam, landing inside the target.
    const stance = await page.evaluate(({ strikeBeats, frozenAt }) => {
      const attack = document.querySelector('.character-attack')
      const animations = attack.getAnimations({ subtree: true })
      const target = document.querySelector('.enemy[data-enemy-id="enemy-0"] .enemy__portrait').getBoundingClientRect()
      const measure = ([pose, time]) => {
        animations.forEach(animation => { animation.currentTime = time })
        const image = [...attack.querySelectorAll('.character-attack__pose img')]
          .find(node => Number(getComputedStyle(node.parentElement).opacity) > .5)
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        const solid = (x, y) => data[(y * canvas.width + x) * 4 + 3] > 64
        let right = 0, rightY = 0, bottom = 0, paintTop = canvas.height
        for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
          if (!solid(x, y)) continue
          if (x > right) { right = x; rightY = y }
          paintTop = Math.min(paintTop, y)
          bottom = Math.max(bottom, y)
        }
        // The planted rear sole is the leftmost run of solid columns in the ground band.
        let footStart = -1, footEnd = -1
        for (let x = 0; x < canvas.width && (footEnd < 0 || x - footEnd <= 6); x++) {
          let touches = false
          for (let y = bottom - 22; y <= bottom && !touches; y++) touches = solid(x, y)
          if (touches) { if (footStart < 0) footStart = x; footEnd = x }
        }
        const rect = image.getBoundingClientRect()
        const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height)
        const left = rect.left + (rect.width - canvas.width * fit) / 2
        const top = rect.bottom - canvas.height * fit
        return { pose, travel: new DOMMatrix(getComputedStyle(attack).transform).e,
          tip: left + right * fit, tipY: top + rightY * fit, foot: left + (footStart + footEnd) / 2 * fit,
          top: top + paintTop * fit, pixel: fit }
      }
      const poses = strikeBeats.map(measure)
      animations.forEach(animation => { animation.currentTime = frozenAt })
      return { poses, target: [target.left, target.right, target.top, target.bottom],
        boardTop: document.querySelector('.board').getBoundingClientRect().top }
    }, { strikeBeats, frozenAt })
    const strike = stance.poses
    const label = `${engine}/${screen}`
    if (p.groundSpeed) {
      // Real-engine travel profile on the stepped clock: while a drawing with a planted foot is shown the box must not skate.
      const step = 4
      const samples = await page.evaluate(({ duration, step, frozenAt }) => {
        const attack = document.querySelector('.character-attack')
        const animations = attack.getAnimations({ subtree: true })
        const out = []
        for (let time = 0; time <= duration; time += step) {
          animations.forEach(animation => { animation.currentTime = time })
          const matrix = new DOMMatrix(getComputedStyle(attack).transform)
          const image = [...attack.querySelectorAll('.character-attack__pose img')]
            .find(node => Number(getComputedStyle(node.parentElement).opacity) > .5)
          out.push({ time, x: matrix.e, y: matrix.f, file: image?.src.split('/').pop() })
        }
        animations.forEach(animation => { animation.currentTime = frozenAt })
        return out
      }, { duration: config.durationMs, step, frozenAt })
      let fastest = { speed: 0 }
      for (let index = 1; index < samples.length; index++) {
        const [before, after] = [samples[index - 1], samples[index]]
        const [pose, next] = [before, after].map(sample => sample.file?.replace(`${skin}-`, '').replace('.webp', ''))
        assert(pose && next, `${label}: no drawing shown at ${before.time}ms`)
        const speed = Math.hypot(after.x - before.x, after.y - before.y) / step
        // A step that straddles a change of drawing counts as flight when either side is a flight drawing.
        if (!p.airborne.has(pose) && !p.airborne.has(next) && speed > fastest.speed) fastest = { speed, pose, time: before.time }
      }
      assert(fastest.speed <= p.groundSpeed, `${label}: ${fastest.pose} (a drawing with a planted foot) travels ${fastest.speed.toFixed(2)} px/ms at ${fastest.time}ms, over the ${p.groundSpeed} px/ms cap: the foot skates`)
      console.log(`${label}: fastest grounded travel ${fastest.speed.toFixed(2)} px/ms (${fastest.pose}), cap ${p.groundSpeed}`)
    }
    assert(strike.every(pose => Math.abs(pose.travel - strike[0].travel) < .5),
      `${label}: the actor moves between its hits ${JSON.stringify(strike)}`)
    const contact = strike.filter(pose => contactFiles.includes(pose.pose))
    const tips = contact.map(pose => pose.tip)
    // The documented agreement of the contact drawings (docs/skins/attack-animation.md): 12 canvas px.
    assert(Math.max(...tips) - Math.min(...tips) < 12 * strike[0].pixel,
      `${label}: light hits and slam reach different distances ${JSON.stringify(contact)}`)
    const [targetLeft, targetRight, targetTop, targetBottom] = stance.target
    assert(contact.every(pose => pose.tip > targetLeft && pose.tip < targetRight &&
      pose.tipY > targetTop && pose.tipY < targetBottom),
      `${label}: blades miss the target ${JSON.stringify({ contact, target: stance.target })}`)
    // Integer CSS shifts leave a few canvas pixels of noise.
    const feet = strike.map(pose => pose.foot)
    assert(Math.max(...feet) - Math.min(...feet) < 8 * strike[0].pixel,
      `${label}: rear foot slides while the actor is out ${JSON.stringify(strike)}`)
    // The board clips its overflow, so raised blades must stay below its top edge.
    assert(strike.every(pose => pose.top >= stance.boardTop),
      `${label}: the board clips the raised weapon ${JSON.stringify({ boardTop: stance.boardTop, strike })}`)
    // A pinned flash grows from where its drawing's prop tip is: the flash's anchor must sit on that drawing's tip landmark
    // (config.audit.landmarks, canvas px) as the actor is actually drawn at that beat.
    await assertPinnedFlashesOnTip(page, p, label, frozenAt)
    const shotPath = resolve(output, `${skin}-${engine}-${screen}-second-light-frame.png`)
    const geometry = await page.evaluate(selector => ({
      board: document.querySelector('.board').getBoundingClientRect().toJSON(),
      image: document.querySelector(selector).getBoundingClientRect().toJSON(),
    }), framePose)
    await page.locator('.board').screenshot({ path: shotPath })
    // Sample the contact drawing's opaque pixels (Kratos: its ash-white skin mask) in the composited screenshot.
    // DOM opacity/geometry alone missed WebKit's ancestor-filter clipping.
    const painted = spawnSync('python3', ['-c', `
import json, sys
from PIL import Image
geometry = json.load(sys.stdin)
shot = Image.open(sys.argv[1]).convert('RGB')
source = Image.open(sys.argv[2]).convert('RGBA')
b, r = geometry['board'], geometry['image']
fit = min(r['width'] / source.width, r['height'] / source.height)
left = r['x'] - b['x'] + (r['width'] - source.width * fit) / 2
top = r['y'] - b['y'] + r['height'] - source.height * fit
scale = shot.width / b['width']
points = set()
for y in range(0, source.height, 3):
    for x in range(0, source.width, 3):
        red, green, blue, alpha = source.getpixel((x,y))
        if alpha < 220: continue
        if geometry['ashMask'] and (min(red,green,blue) < 170 or max(red,green,blue) - min(red,green,blue) > 40): continue
        point = (round((left + x * fit) * scale), round((top + y * fit) * scale))
        if 0 <= point[0] < shot.width and 0 <= point[1] < shot.height: points.add((point, (red, green, blue)))
def painted(point, colour):
    pixel = shot.getpixel(point)
    if geometry['ashMask']: return min(pixel) > 140 and max(pixel) - min(pixel) < 55
    return sum(abs(a - b) for a, b in zip(pixel, colour)) < 90
matched = sum(painted(*entry) for entry in points)
assert len(points) > 50 and matched / len(points) > .25, (matched, len(points), 'the skin did not paint at contact')
print(f'visible skin: {matched}/{len(points)}')
`, shotPath, p.sourcePath], {
      input: JSON.stringify({ ...geometry, ashMask: p.ashMask }), encoding: 'utf8',
    })
    assert.equal(painted.status, 0, `${engine}/${screen}: ${painted.stderr || painted.stdout}`)

    await page.clock.resume()
    if (engine === 'webkit') assert(p.sounds.every(file => soundRequests.has(file)), `WebKit did not decode the ${skin} sounds ${[...soundRequests]}`)
    await page.evaluate(() => window.attackFixture.reset())
    const settled = await page.evaluate(paintedBounds, idle)
    assert(Math.abs(settled.height - rest.height) < 2, 'attack changed resting stature')
    // In-game reduced motion must retain exactly the same physical cutout.
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'true'
      window.attackFixture.reset()
    })
    await page.waitForFunction(hero => document.querySelector('.seat__portrait > img')?.src.endsWith(hero), hero)
    await page.locator(idle).evaluate(image => image.decode())
    const reduced = await page.evaluate(paintedBounds, idle)
    assert(Math.abs(reduced.height - rest.height) < 2, `reduced motion changes the actor size ${JSON.stringify({ reduced, rest })}`)
    assert(Math.abs(reduced.width - rest.width) < 2, 'reduced motion crops the weapon')
    assert(Math.abs(reduced.ground - rest.ground) < 2, 'reduced motion shifts planted feet')
    await page.evaluate(() => window.attackFixture.attack())
    assert.equal(await page.locator('.character-attack').count(), 0, 'reduced motion plays attack')
    assert.equal(await page.locator('.staged-hit').count(), 0, 'reduced motion retains hit effects')
    // A skin dresses its hero and nothing else: Watcher's Wrath and Calm aura follows the character, skinned or plain.
    if (p.character === 'watcher') {
      for (const wear of [skin, null]) for (const stance of ['wrath', 'calm']) {
        await page.evaluate(([wear, stance]) => {
          document.documentElement.dataset.reducedMotion = 'false'
          const f = window.attackFixture; f.reset('watcher', wear)
          f.state.players[0].stance = stance; f.render()
        }, [wear, stance])
        assert.equal(await page.locator(`.seat .stance-aura--${stance}`).count(), 1, `${engine}/${screen}: ${wear ?? 'plain Watcher'} in ${stance} shows its aura`)
      }
      await page.evaluate(() => window.attackFixture.reset())
    }
    if (p.character === 'slime_boss') await assertSlimeFormation(page, p, `${engine}/${screen}`)
    // Cards and item-granted Shivs both keep separate weighted debts.
    // The second lethal combo must not erase the first or kill its target early.
    for (const source of [p.cards[0][0], 'shiv']) {
      await page.evaluate(() => {
        document.documentElement.dataset.reducedMotion = 'false'
        const f = window.attackFixture; f.reset()
        f.state.enemies.splice(1); f.state.enemies[0].hp = 2; f.render()
      })
      await page.waitForFunction(ready => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === ready, assetsReady)
      const queued = await page.evaluate(({ source, total }) => new Promise((resolve, reject) => {
        const f = window.attackFixture
        const samples = []
        const onImpact = event => {
          const enemy = event.target.closest('.enemy')
          queueMicrotask(() => {
            samples.push({ seq: event.detail.seq, index: event.detail.index,
              hp: Number(enemy.querySelector('.bar__label').textContent.split('/')[0]),
              dead: enemy.classList.contains('enemy--dead') })
            if (samples.length === total) {
              clearTimeout(timeout); document.removeEventListener('staged-impact', onImpact); resolve(samples)
            }
          })
        }
        const timeout = setTimeout(() => {
          document.removeEventListener('staged-impact', onImpact)
          reject(new Error(`queued combo lost impacts: ${JSON.stringify(samples)}`))
        }, 8000)
        document.addEventListener('staged-impact', onImpact)
        f.attack(source); f.attack(source)
      }), { source, total: 2 * table.hits.length })
      assert.deepEqual(queued.map(hit => hit.index), [...table.hits.keys(), ...table.hits.keys()], `${source}: queued combos overlap or lose beats`)
      queued.forEach((hit, index) => {
        assert(Math.abs(hit.hp - (2 - Math.floor(index / table.hits.length) - p.cumulative[index % table.hits.length])) < 1e-8, 'queued weighted debt restores old HP')
        assert.equal(hit.dead, index === queued.length - 1, 'lethal combo falls before its last hit')
      })
      await page.waitForFunction(() => !document.querySelector('.character-attack'))
    }
    // A lethal combo's target keeps falling for ACTOR_DEFEAT_MS (1800, hooks.ts) after its own combo's last hit: the second of
    // two queued combos starts one animation later, and the skin's table, never another attack's (a Hermit volley is
    // 489ms), decides how far into it the last hit lands. The rule is timer arithmetic, so it is judged on the page's fake
    // clock (page.clock, still installed from the frozen frame above): the removal timer fires at exactly that time whatever
    // the machine's load, and a wrong span moves it by tens of milliseconds.
    {
      await page.evaluate(() => {
        document.documentElement.dataset.reducedMotion = 'false'
        const f = window.attackFixture; f.reset()
        f.state.enemies.splice(1); f.state.enemies[0].hp = 2; f.render()
      })
      await page.waitForFunction(ready => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === ready, assetsReady)
      const expected = ACTOR_DEFEAT_MS + config.durationMs + table.hits.at(-1).ms
      const settleReact = () => page.evaluate(() => new Promise(resolve => {
        const channel = new MessageChannel()
        let turns = 0
        channel.port1.onmessage = () => { if (++turns < 4) channel.port2.postMessage(0); else resolve() }
        channel.port2.postMessage(0)
      }))
      // A margin the evaluate/pauseAt round trip cannot outrun on a loaded machine (the clock keeps running until it pauses).
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000))
      await page.evaluate(card => { window.attackFixture.attack(card); window.attackFixture.attack(card) }, p.cards[0][0])
      await settleReact()
      await page.clock.runFor(expected - LETHAL_COMBO_TOLERANCE_MS)
      await settleReact()
      assert.equal(await page.locator('.enemy').count(), 1, `${engine}/${screen}: a lethal combo's target was gone ${LETHAL_COMBO_TOLERANCE_MS}ms before ${config.durationMs}ms + its last hit at ${table.hits.at(-1).ms}ms + the ${ACTOR_DEFEAT_MS}ms fall`)
      await page.clock.runFor(2 * LETHAL_COMBO_TOLERANCE_MS)
      await settleReact()
      assert.equal(await page.locator('.enemy').count(), 0, `${engine}/${screen}: a lethal combo's target was still there ${LETHAL_COMBO_TOLERANCE_MS}ms after ${config.durationMs}ms + its last hit at ${table.hits.at(-1).ms}ms + the ${ACTOR_DEFEAT_MS}ms fall`)
      await page.clock.resume()
      await page.waitForFunction(() => !document.querySelector('.character-attack'))
    }
    // Restoration clears an in-flight play and never replays it on reconnect.
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'false'
      window.attackFixture.reset()
    })
    await page.waitForFunction(ready => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === ready, assetsReady)
    await page.evaluate(() => window.attackFixture.attack())
    await page.locator('.character-attack').waitFor()
    await page.evaluate(() => {
      const f = window.attackFixture; f.connected = false; f.render()
      f.restoration++; f.connected = true; f.render()
    })
    await page.waitForFunction(() => !document.querySelector('.character-attack'))
    await page.locator('.board').screenshot({ path: resolve(output, `${skin}-${engine}-${screen}-restored.png`) })
    // Bosses paint outside the rows; the actor out at the target must still draw over the boss it hits.
    await page.evaluate(() => {
      const f = window.attackFixture; f.reset()
      f.state.enemies.splice(1)
      Object.assign(f.state.enemies[0], { defId: 'time_eater', isBoss: true, hp: 60, maxHp: 60 })
      f.render()
    })
    await page.waitForFunction(ready => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === ready, assetsReady)
    const bossLayer = await page.evaluate(([last, lastMs]) => new Promise((resolve, reject) => {
      const style = document.createElement('style')
      style.textContent = '.character-attack, .character-attack * { pointer-events: auto !important; }'
      const onImpact = event => {
        if (event.detail.index !== last) return
        clearTimeout(timeout); document.removeEventListener('staged-impact', onImpact)
        // The event can arrive late on a busy machine; judge the layering at the hit's own beat, not at that moment.
        document.querySelector('.character-attack').getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = lastMs })
        document.head.append(style)
        const portrait = document.querySelector('.board__bosses .enemy__portrait').getBoundingClientRect()
        const hit = document.elementFromPoint(portrait.left + portrait.width / 2, portrait.top + portrait.height / 2)
        style.remove()
        resolve(hit?.closest('.character-attack') ? 'skin' : hit?.closest('.enemy') ? 'boss' : String(hit?.className))
      }
      const timeout = setTimeout(() => {
        document.removeEventListener('staged-impact', onImpact)
        reject(new Error('the last hit never landed on the boss'))
      }, 8000)
      document.addEventListener('staged-impact', onImpact)
      window.attackFixture.attack()
    }), [table.hits.length - 1, table.hits.at(-1).ms])
    assert.equal(bossLayer, 'skin', `${engine}/${screen}: the actor strikes behind the boss`)
    await page.waitForFunction(() => !document.querySelector('.character-attack'))
    console.log(`PASS ${engine}/${screen}/${skin}: weighted ${table.hits.length}-hit attack, poses, planted stance, shared weapon contact, art inside the board, boss layering, SFX, targets, scale, cold loading, reduced motion and restoration`)
  } finally { releaseColdArtwork?.(); await context.close() }
}

// A browser the machine killed mid-run (out of memory under a loaded test host) says so in these words. Only that
// infrastructure failure is retried, on a fresh browser and a bounded number of times; every assertion failure is final.
const BROWSER_GONE = /Target page, context or browser has been closed|Browser has been closed|browser has disconnected/i
const INFRASTRUCTURE_RETRIES = 2

try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]
    .filter(([engine]) => !arg('engine') || arg('engine') === engine)) {
    let browser = await type.launch({ headless: true })
    try {
      for (const [screen, viewport] of [['desktop', { width: 1440, height: 900 }],
        ['horizontal-phone', { width: 844, height: 390 }]]
        .filter(([screen]) => !arg('screen') || arg('screen') === screen)) {
        for (const p of profiles) {
          for (let attempt = 0; ; attempt++) {
            try { await run(browser, engine, screen, viewport, p); break } catch (error) {
              if (!BROWSER_GONE.test(String(error?.message)) || attempt >= INFRASTRUCTURE_RETRIES) throw error
              console.warn(`INFRASTRUCTURE ${engine}/${screen}/${p.skin}: the browser was closed under the test (attempt ${attempt + 1} of ${INFRASTRUCTURE_RETRIES + 1}); relaunching`)
              await browser.close().catch(() => {})
              browser = await type.launch({ headless: true })
            }
          }
        }
      }
    } finally { await browser.close().catch(() => {}) }
  }
  assert.deepEqual(errors, [], 'browser errors or missing combat artwork')
} finally { await close() }
