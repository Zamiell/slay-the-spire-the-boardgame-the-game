#!/usr/bin/env node
// Real engine evokes through the production renderer; failure contract precedes implementation.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { installAttackFixture } from './lib/skin-attack-fixture.mjs'

const output = resolve('artifacts/defect-chan-evoke')
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const report = { cases: [], errors: [] }
const skin = 'monogatari_defect'
const phase = name => `.monogatari-evoke [data-evoke-phase="${name}"]`

async function reset(page, original = false) {
  await page.evaluate(({ skin, original }) => {
    const f = window.attackFixture
    f.reset('defect', skin)
    if (original) { delete f.state.players[0].skin; f.render() }
  }, { skin, original })
  await page.locator('.seat__portrait > :is(img,video)').evaluate(async image => {
    if (image.decode) await image.decode()
    else if (image.readyState < 2) await new Promise(resolve => image.addEventListener('loadeddata', resolve, { once: true }))
  })
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.enemy__portrait img')].map(image => image.decode())))
}

async function evoke(page, orbs, mixed = false) {
  return page.evaluate(async ({ orbs, mixed }) => {
    const { playCard } = await import('/src/game/combat.ts')
    const f = window.attackFixture
    f.state.players[0].orbs = [...orbs, ...Array(3 - orbs.length).fill(null)]
    const card = { uid: `evoke-${f.run}-${f.state.presentationEvents.length}`, defId: mixed ? 'fission' : 'dual_cast', upgraded: mixed }
    f.state.players[0].hand.push(card)
    f.state = playCard(f.state, 'p1', card.uid, {
      enemyUid: null, playerId: 'p1', evokeSlots: mixed ? [0, 1] : [0],
      evokeEnemyUids: ['enemy-0', 'enemy-1'],
    })
    const events = f.state.presentationEvents.filter(event => event.kind === 'orb' && event.sourceId === 'orb-evoke')
    window.evokeSample = { maxBodies: 0, phases: [], errors: [], frames: 0 }
    f.render()
    let last = performance.now()
    const painted = node => {
      if (node instanceof HTMLImageElement && (!node.complete || !node.naturalWidth)) return false
      for (let p = node; p && !p.classList.contains('seat__portrait'); p = p.parentElement) {
        const s = getComputedStyle(p)
        if (Number(s.opacity) < .1 || s.visibility === 'hidden' || s.display === 'none') return false
      }
      return node.getBoundingClientRect().width > 0
    }
    const s = window.evokeSample
    s.elapsed = 0
    const tick = () => {
      const now = performance.now()
      if (!s.frozen) s.elapsed += now - last
      last = now
      const bodies = [...document.querySelectorAll('.seat__portrait > :is(img,video), .character-attack__pose img')].filter(painted)
      s.maxBodies = Math.max(s.maxBodies, bodies.length)
      s.frames++
      if (bodies.length !== 1) s.errors.push({ bodies: bodies.length, at: s.elapsed,
        nodes: [...document.querySelectorAll('.seat__portrait > :is(img,video), .character-attack__pose img')].map(n => ({src:n.getAttribute('src'), complete:n.complete, width:n.naturalWidth, opacity:getComputedStyle(n).opacity, parentOpacity:getComputedStyle(n.parentElement).opacity, phase:n.parentElement.dataset.evokePhase, clock:n.parentElement.getAnimations()[0]?.currentTime})) })
      for (const body of bodies) {
        const p = body.closest('[data-evoke-phase]')?.dataset.evokePhase
        if (p && !s.phases.includes(p)) s.phases.push(p)
      }
      if (s.elapsed < 1050) requestAnimationFrame(tick)
      else s.done = true
    }
    requestAnimationFrame(tick)
    return events.map(event => ({ seq: event.seq, orb: event.orb, targets: event.enemyIds }))
  }, { orbs, mixed })
}

async function geometry(page, hand) {
  const sources = await page.locator('.defect-evoke').evaluateAll((nodes, hand) => nodes.map(node => {
    const p = node.closest('.seat__portrait').getBoundingClientRect()
    const r = node.getBoundingClientRect()
    const origin = hand ? [.71, .478] : [.497, .482]
    return { origin: node.dataset.evokeOrigin, dx: r.left - p.left - p.width * origin[0], dy: r.top - p.bottom + p.width * (1 - origin[1]),
      rays: [...node.querySelectorAll('.defect-evoke__ray')].map(ray => {
        const id = ray.dataset.evokeTarget
        const angle = parseFloat(ray.style.getPropertyValue('--beam-angle')) * Math.PI / 180
        const length = parseFloat(ray.style.getPropertyValue('--beam-length'))
        const target = document.querySelector(`.enemy[data-enemy-id="${id}"] .enemy__portrait`).getBoundingClientRect()
        const x = r.left + Math.cos(angle) * length
        const y = r.top + Math.sin(angle) * length
        // Enemy body registration is owned by the existing beam component; report endpoint for audit.
        return { id, x, y, target: { left: target.left, right: target.right, top: target.top, bottom: target.bottom },
          delay: ray.querySelector('img').getAnimations()[0]?.effect.getTiming().delay,
          duration: ray.querySelector('img').getAnimations()[0]?.effect.getTiming().duration }
      }) }
  }), hand)
  assert.equal(sources.length, 2)
  for (const source of sources) {
    assert.equal(source.origin, hand ? 'hand' : 'chest')
    assert(Math.abs(source.dx) < 2 && Math.abs(source.dy) < 2, 'beam source misses registered hand/chest')
    for (const ray of source.rays) {
      assert.equal(ray.delay, 240); assert.equal(ray.duration, 520)
      assert(ray.x >= ray.target.left && ray.x <= ray.target.right && ray.y >= ray.target.top && ray.y <= ray.target.bottom, 'beam misses target portrait')
    }
  }
  assert.deepEqual(sources.flatMap(source => source.rays.map(ray => ray.id)).sort(), ['enemy-0', 'enemy-1'])
  assert.equal(await page.locator('.monogatari-evoke .character-attack__bolt').count(), 0, 'evoke launched a flying attack orb')
  return sources
}

// Software-rendered frames can outlast a 140ms pose: capture with the running animations (and the
// sampler clock) frozen, optionally seeked to a time inside the wanted pose, then let them continue.
// The event itself still expires on wall-clock time, so only one capture per evoke.
async function shoot(page, file, at, selector) {
  await page.evaluate(async at => {
    window.frozenAnimations = document.getAnimations().filter(animation => animation.playState === 'running')
    for (const animation of window.frozenAnimations) {
      animation.pause()
      if (at !== undefined) animation.currentTime = at
    }
    if (window.evokeSample) window.evokeSample.frozen = true
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, at)
  if (selector) await waitVisible(page, selector)
  await page.screenshot({ path: resolve(output, file) })
  await page.evaluate(() => {
    for (const animation of window.frozenAnimations) animation.play()
    if (window.evokeSample) window.evokeSample.frozen = false
  })
}

const waitPhase = (page, name) => waitVisible(page, phase(name))
async function waitVisible(page, selector) {
  await page.waitForFunction(selector => {
    const p = document.querySelector(selector)
    return p && getComputedStyle(p).visibility === 'visible' &&
      Number(getComputedStyle(p).opacity) > .5 && p.querySelector('img')?.complete && p.querySelector('img')?.naturalWidth > 0
  }, selector)
}

try {
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    if (process.argv.includes('--chromium') && engine !== 'chromium') continue
    const browser = await launcher.launch()
    try {
      for (const [screen, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }]]) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: screen !== 'desktop', hasTouch: screen !== 'desktop', recordVideo: { dir: output, size: viewport } })
        const page = await context.newPage(); page.setDefaultTimeout(10_000)
        page.on('pageerror', e => report.errors.push(String(e)))
        page.on('response', r => { if (r.status() >= 400 && /\/assets\/.*(?:monogatari_defect|defect-.*beam|channel)/.test(r.url())) report.errors.push(`${r.status()} ${r.url()}`) })
        const name = `${engine}-${screen}`
        let release
        try {
          const gate = new Promise(resolve => { release = resolve })
          await page.route('**/monogatari_defect-release.webp', async route => { await gate; await route.continue() })
          await page.goto(origin); await page.evaluate(installAttackFixture, { character: 'defect', skin }); await reset(page)
          const coldEvents = await evoke(page, ['lightning'])
          assert.equal(coldEvents.length, 2)
          await page.waitForFunction(() => document.querySelectorAll('.defect-evoke').length === 2)
          const cold = await geometry(page, false)
          await shoot(page, `${name}-cold.png`)
          await page.waitForFunction(() => window.evokeSample.done)
          const coldSample = await page.evaluate(() => window.evokeSample)
          assert.equal(coldSample.maxBodies, 1); assert.deepEqual(coldSample.errors, []); assert.deepEqual(coldSample.phases, [])
          release(); await page.unrouteAll({ behavior: 'wait' })
          await page.waitForFunction(() => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === 5)
          const warm = []
          for (const orb of ['lightning', 'dark']) {
            await reset(page)
            const events = await evoke(page, [orb])
            assert.equal(events.length, 2)
            assert.deepEqual(events.map(event => event.targets), [['enemy-0'], ['enemy-1']])
            await waitPhase(page, 'focus')
            assert.equal(await page.locator('.monogatari-evoke').count(), 1, 'simultaneous evokes duplicate pose owner')
            assert.equal(await page.locator(`.monogatari-evoke [data-evoke-orb="${orb}"][data-evoke-orb-phase="focus"]`).count(), 1)
            await waitPhase(page, 'cast')
            const castSource = await page.locator(`${phase('cast')} img`).getAttribute('src')
            const beams = await geometry(page, true)
            assert(castSource.endsWith(`${skin}-release.webp`))
            await page.waitForFunction(() => window.evokeSample.done)
            const sample = await page.evaluate(() => window.evokeSample)
            assert.equal(sample.maxBodies, 1); assert.deepEqual(sample.errors, []); assert.deepEqual(sample.phases, ['focus', 'cast', 'recover'])
            warm.push({ orb, events, beams, sample })
          }
          for (const [orb, shot, at] of [['lightning', 'focus', 100], ['lightning', 'cast', 400], ['lightning', 'recover', 820], ['dark', 'cast', 400]]) {
            await reset(page); await evoke(page, [orb])
            await shoot(page, `${name}-${orb}-${shot}.png`, at, phase(shot))
            await page.waitForFunction(() => window.evokeSample.done)
          }
          await reset(page)
          const mixed = await evoke(page, ['lightning', 'dark'], true)
          assert.deepEqual(mixed.map(event => event.orb), ['lightning', 'dark'])
          await waitPhase(page, 'cast'); await geometry(page, true)
          await page.waitForFunction(() => window.evokeSample.done)
          assert.deepEqual((await page.evaluate(() => window.evokeSample)).errors, [])
          // A later cast must not retract the palm while earlier beams still leave it.
          await reset(page); await evoke(page, ['lightning']); await waitPhase(page, 'cast')
          await evoke(page, ['dark'])
          const queued = await page.evaluate(() => ({ poses: document.querySelectorAll('.monogatari-evoke').length,
            focus: document.querySelector('.monogatari-evoke [data-evoke-phase="focus"] img')?.getAttribute('src') }))
          assert.equal(queued.poses, 1)
          assert(queued.focus.endsWith(`${skin}-release.webp`), 'queued evoke retracts the hand under an older beam')
          await shoot(page, `${name}-queued-cast.png`)
          await page.waitForFunction(() => window.evokeSample.done)
          assert.deepEqual((await page.evaluate(() => window.evokeSample)).errors, [])
          // Impact events outlive the 900ms pose. A subsequent attack must regain its body.
          await reset(page); await evoke(page, ['lightning'])
          // Each capture gets its own attack: a slow frame outlasts the 500ms pose that follows.
          for (const [pose, at] of [['charge', 300], ['release', 1000]]) {
            if (pose !== 'charge') { await reset(page); await evoke(page, ['lightning']) }
            await page.waitForFunction(() => window.evokeSample.done)
            await page.waitForFunction(() => !document.querySelector('.monogatari-evoke')).catch(() => assert.fail('settled evoke still owns the body'))
            await page.evaluate(() => window.attackFixture.attack('strike_defect'))
            assert.equal(await page.locator('.monogatari-evoke').count(), 0)
            await shoot(page, `${name}-after-evoke-${pose}.png`, at, `.character-attack--monogatari_defect .monogatari-pose--${pose}`)
          }
          // A normal projectile attack overlapping with real evokes must not paint two actors.
          await reset(page); await page.evaluate(() => window.attackFixture.attack('strike_defect'))
          await evoke(page, ['dark']); await waitPhase(page, 'cast')
          await page.waitForFunction(() => window.evokeSample.done)
          assert.deepEqual((await page.evaluate(() => window.evokeSample)).errors, [])
          // An attack started during the cast resumes its existing clock at recovery. The attack starts on the first painted
          // frame of the cast, inside the page. Its clock is judged without a wall-clock threshold a slow renderer can miss: the
          // attack's own animation (object and startTime) must be the very one recovery hands the body back to, whenever that is.
          await reset(page); await evoke(page, ['dark'])
          const released = '.character-attack--monogatari_defect .monogatari-pose--release'
          const overlapped = await page.evaluate(release => new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('the cast never painted')), 8000)
            const poll = () => {
              const cast = document.querySelector('.monogatari-evoke [data-evoke-phase="cast"]')
              if (!cast || getComputedStyle(cast).visibility !== 'visible' || Number(getComputedStyle(cast).opacity) < .5) { requestAnimationFrame(poll); return }
              clearTimeout(timeout)
              const evokeClock = cast.getAnimations()[0].currentTime
              window.attackFixture.attack('strike_defect')
              const animation = document.querySelector(release)?.getAnimations()[0]
              if (!animation) { reject(new Error('the overlapping attack has no running pose clock')); return }
              window.overlappedAttackAnimation = animation
              animation.ready.then(() => resolve({ evokeClock, startTime: animation.startTime }))
            }
            poll()
          }), released)
          assert(overlapped.evokeClock >= 240 && overlapped.evokeClock < 760, `the attack did not start inside the cast ${JSON.stringify(overlapped)}`)
          await page.waitForFunction(() => window.evokeSample.done)
          assert.deepEqual((await page.evaluate(() => window.evokeSample)).errors, [])
          const resumed = await page.locator(released).evaluate(node => {
            const animation = node.getAnimations()[0]
            return { same: animation === window.overlappedAttackAnimation, startTime: animation.startTime, clock: animation.currentTime }
          })
          assert(resumed.same && resumed.startTime === overlapped.startTime, `overlapped attack restarted its clock ${JSON.stringify({ overlapped, resumed })}`)
          for (const interrupt of ['restoration', 'disconnect', 'death', 'reduced']) {
            await reset(page); await evoke(page, ['lightning']); await waitPhase(page, 'focus')
            await page.evaluate(interrupt => {
              const f = window.attackFixture
              if (interrupt === 'restoration') f.restoration++
              if (interrupt === 'disconnect') f.connected = false
              if (interrupt === 'death') { f.state.players[0].dead = true; f.state.players[0].hp = 0 }
              if (interrupt === 'reduced') document.documentElement.dataset.reducedMotion = 'true'
              f.render()
            }, interrupt)
            await page.waitForFunction(() => !document.querySelector('.monogatari-evoke'))
            assert(await page.locator('.seat__portrait > :is(img,video)').isVisible())
            await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'false' })
          }
          await reset(page, true); await evoke(page, ['lightning'])
          await page.waitForFunction(() => document.querySelectorAll('.defect-evoke').length === 2)
          assert.equal(await page.locator('.monogatari-evoke').count(), 0, 'original Defect inherited anime pose')
          assert.deepEqual(await page.locator('.defect-evoke').evaluateAll(nodes => nodes.map(n => n.dataset.evokeOrigin)), ['original', 'original'])
          await shoot(page, `${name}-original-defect.png`)
          report.cases.push({ engine, screen, cold, coldSample, warm, mixed, interrupts: ['restoration', 'disconnect', 'death', 'reduced'] })
        } finally {
          release?.(); await page.unrouteAll({ behavior: 'wait' })
          const video = page.video(); await context.close()
          if (video) await video.saveAs(resolve(output, `${name}.webm`))
        }
      }
    } finally { await browser.close() }
  }
  assert.deepEqual(report.errors, [])
  console.log(`PASS ${report.cases.length} Defect-chan evoke cases: focus/cast/beam targets, cold latch, one body, overlap, lifecycle and original Defect`)
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await server.close()
}
