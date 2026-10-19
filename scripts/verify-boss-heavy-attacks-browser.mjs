import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'

// Each Boss's hardest turn mounts its signature layers on the real board:
// the charge, a landing per struck hero, camera shake, flash and hero recoil.
const output = resolve('artifacts/boss-heavy-attacks')
mkdirSync(output, { recursive: true })
const CASES = [
  ['slime_boss', 2, 'slime-crush', 1], ['hexaghost', 5, 'hexaghost-inferno', 2], ['bronze_automaton', 3, 'automaton-beam', 1],
  ['guardian_defensive', 1, 'guardian-bash', 1], ['the_collector', 2, 'collector-fireball', 1], ['the_champ', 2, 'champ-execute', 1],
  ['the_champ_fury', 1, 'champ-flurry', 2], ['awakened_one_phase_1', 1, 'awakened-rend', 1],
  ['awakened_one_phase_2', 0, 'awakened-eruption', 1], ['time_eater', 2, 'time-crush', 1], ['corrupt_heart', 1, 'heart-pulse', 1],
]
const PHONE_CASES = CASES.filter(([defId]) => ['hexaghost', 'bronze_automaton', 'the_champ_fury', 'time_eater'].includes(defId))
const QUIET = [['slime_boss', 1], ['hexaghost', 0], ['hexaghost', 1], ['hexaghost', 3], ['donu', 1], ['deca', 0], ['guardian_attack', 0]]
const server = await createServer({ logLevel: 'silent', server: { port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const errors = []
try {
  for (const [screen, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, isMobile: screen === 'horizontal-phone', hasTouch: screen === 'horizontal-phone' })
    const page = await context.newPage()
    await page.addInitScript(identity => localStorage.setItem('sts-profile', JSON.stringify(identity)),
      { username: `Heavy${randomUUID().slice(0, 8)}`, token: randomUUID(), secured: true })
    // Hold the swing open so the clock can be scrubbed without the real 1830ms timer ending it.
    await page.addInitScript(() => {
      const timeout = window.setTimeout
      window.setTimeout = (fn, ms, ...rest) => timeout(fn, window.holdBossAttack && ms === 1830 ? 300000 : ms, ...rest)
      window.holdBossAttack = true
    })
    page.on('pageerror', error => errors.push(String(error)))
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('/assets/combat/')) errors.push(`${response.status()} ${response.url()}`)
    })
    await page.goto(`http://localhost:${server.httpServer.address().port}/?combat-webp=1`)
    await page.evaluate(async () => {
      document.querySelector('#root').style.display = 'none'
      document.documentElement.dataset.mobilePerformance = String(innerWidth < 900)
      document.documentElement.dataset.reducedMotion = 'false'
      const node = document.createElement('div')
      node.className = 'app-shell app-shell--combat sts-scope'
      node.style.gridTemplateRows = 'minmax(0, 1fr)'
      document.body.append(node)
      const [React, ReactDOM, { CombatScreen }, { createPlayer }, { createCombat }, { createRng }] = await Promise.all([
        import('/@id/react'), import('/@id/react-dom/client'), import('/src/ui/CombatScreen.tsx'), import('/src/game/run.ts'),
        import('/src/game/combat.ts'), import('/src/game/rng.ts'), import('/src/ui/styles.css'), import('/src/ui/chrome.css'),
      ])
      const root = (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(node)
      const fixture = window.heavyFixture = { restoration: 0, autoAdvance: false }
      fixture.render = () => root.render((React.createElement ?? React.default.createElement)(CombatScreen, {
        state: structuredClone(fixture.state), act: 2, viewerId: 'p1', autoAdvance: fixture.autoAdvance,
        authoritativeRestoration: fixture.restoration, authoritativeConnected: true,
        onChange: next => { fixture.state = next; fixture.render() },
      }))
      fixture.install = (defId, actionIndex) => {
        const rng = createRng(47)
        const players = ['p1', 'p2'].map((id, index) => {
          const player = createPlayer(rng, id, index ? 'silent' : 'ironclad', index ? 'silent' : 'ironclad', index)
          player.hp = player.maxHp = 80
          player.hand = []; player.draw = []; player.relics = []
          return player
        })
        const enemy = { uid: 'heavy-review', defId, row: 0, isBoss: true, ascension: 0, hp: 999, maxHp: 999, block: 0, strength: 0,
          vulnerable: 0, weak: 0, poison: 0, actionIndex, abilityUsed: false, dead: false }
        fixture.state = createCombat(rng, players, [enemy])
        fixture.state.phase = 'player'; fixture.state.presentationEvents = []
        fixture.state.players.forEach(player => { player.facingEnemyUid = enemy.uid })
        fixture.autoAdvance = false; fixture.restoration++; fixture.render()
      }
      fixture.attack = () => { fixture.state.phase = 'enemy'; fixture.render() }
      fixture.resolve = async () => {
        const { enemyTurn } = await import('/src/game/combat.ts')
        fixture.state = enemyTurn(fixture.state)
        fixture.render()
      }
    })
    const ready = async defId => {
      await page.waitForFunction(defId => document.querySelector('.enemy')?.dataset.enemyDef === defId &&
        document.querySelector('.enemy')?.dataset.animation === 'idle', defId)
      await page.waitForFunction(() => {
        const image = document.querySelector('.enemy img[data-animation-layer="idle"]')
        return image?.complete && image.naturalWidth > 0
      })
      await page.waitForTimeout(600)
    }
    const scrub = time => page.evaluate(time => document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time }), time)

    // The horizontal phone shares every rule; it samples the sets to keep the suite quick.
    const phone = screen !== 'desktop'
    for (const [defId, index] of phone ? QUIET.slice(0, 4) : QUIET) {
      await page.evaluate(([defId, index]) => window.heavyFixture.install(defId, index), [defId, index])
      await ready(defId)
      await page.evaluate(() => window.heavyFixture.attack())
      await page.waitForSelector('.enemy.enemy--acting')
      assert.equal(await page.locator('.enemy[data-heavy-attack]').count(), 0, `${screen}: ${defId}[${index}] is not a big hit`)
      assert.equal(await page.locator('.boss-heavy-charge, .boss-heavy-target').count(), 0, `${screen}: ${defId}[${index}] mounts no signature layers`)
    }

    for (const [defId, index, kind, hits] of phone ? PHONE_CASES : CASES) {
      await page.evaluate(([defId, index]) => window.heavyFixture.install(defId, index), [defId, index])
      await ready(defId)
      await page.evaluate(() => window.heavyFixture.attack())
      await page.waitForSelector('.enemy.enemy--acting[data-heavy-attack]')
      const enemy = page.locator('.enemy')
      assert.equal(await enemy.getAttribute('data-heavy-attack'), kind, `${screen}: ${defId} signature`)
      assert.equal(await enemy.getAttribute('data-heavy-hits'), String(hits), `${screen}: ${defId} hit count`)
      assert.equal(await page.locator('.boss-heavy-target').count(), 2, `${screen}: ${defId} lands on both heroes`)
      assert.equal(await page.locator('.boss-heavy-charge').count(), 1, `${screen}: ${defId} charges once`)

      await scrub(300)
      await page.waitForTimeout(60)
      const charge = await page.evaluate(() => {
        const aura = document.querySelector('.boss-heavy-charge__aura')
        const body = document.querySelector('.enemy__art--cutout:not([data-inactive])')?.getBoundingClientRect()
        const frame = document.querySelector('.boss-heavy-charge')?.getBoundingClientRect()
        return { aura: Number(getComputedStyle(aura).opacity), width: frame.width, height: frame.height,
          inside: frame.left >= body.left && frame.right <= body.right && frame.bottom <= body.bottom + 1 }
      })
      assert.ok(charge.aura > 0.2, `${screen}: ${defId} aura builds during the windup`)
      assert.ok(charge.width > 20 && charge.height > 20, `${screen}: ${defId} charge wraps the painted body`)
      assert.ok(charge.inside, `${screen}: ${defId} charge stays within the artwork`)

      await scrub(860)
      await page.waitForTimeout(60)
      const landing = await page.evaluate(() => {
        const board = document.querySelector('.board').getBoundingClientRect()
        const bursts = [...document.querySelectorAll('.boss-heavy-target__burst:not(.boss-heavy-target__burst--echo)')].map(element => {
          const rect = element.getBoundingClientRect()
          return { opacity: Number(getComputedStyle(element).opacity), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width }
        })
        const seats = [...document.querySelectorAll('.seat:not(.seat--dead) .seat__portrait')].map(element => getComputedStyle(element).animationName)
        return { board: { left: board.left, right: board.right, top: board.top, bottom: board.bottom }, bursts, seats,
          shake: getComputedStyle(document.querySelector('.board')).animationName,
          vignette: getComputedStyle(document.querySelector('.board'), '::before').animationName }
      })
      assert.equal(landing.bursts.length, 2, `${screen}: ${defId} one landing per hero`)
      for (const burst of landing.bursts) {
        assert.ok(burst.opacity > 0.5 && burst.width > 40, `${screen}: ${defId} landing is visible`)
        assert.ok(burst.x > landing.board.left && burst.x < landing.board.right && burst.y > landing.board.top && burst.y < landing.board.bottom,
          `${screen}: ${defId} landing sits on the board`)
      }
      assert.ok(landing.shake.includes('boss-heavy-shake'), `${screen}: ${defId} shakes the stage`)
      assert.ok(landing.vignette.includes('boss-heavy-'), `${screen}: ${defId} darkens the edges`)
      assert.ok(landing.seats.every(name => name.includes('boss-heavy-recoil')), `${screen}: ${defId} knocks every hero back`)
      await page.locator('.board').screenshot({ path: resolve(output, `${screen}-${kind}.png`) })
    }

    // The first flight of a two-hit swing is visible before the second one is due.
    for (const [defId, index, selector, at] of [['hexaghost', 5, '.boss-heavy-target__flight', 600], ['the_champ_fury', 1, '.boss-heavy-target__flight', 600]]) {
      await page.evaluate(([defId, index]) => window.heavyFixture.install(defId, index), [defId, index])
      await ready(defId)
      await page.evaluate(() => window.heavyFixture.attack())
      await page.waitForSelector('.enemy--acting[data-heavy-attack]')
      await scrub(at)
      await page.waitForTimeout(60)
      assert.ok(await page.evaluate(selector => Number(getComputedStyle(document.querySelector(selector)).opacity) > 0.5, selector),
        `${screen}: ${defId} first strike is visible in flight`)
    }

    // Resolution advances the rotation mid-swing; the landings must outlive it.
    await page.evaluate(() => window.heavyFixture.install('the_champ_fury', 1))
    await ready('the_champ_fury')
    await page.evaluate(() => window.heavyFixture.attack())
    await page.waitForSelector('.enemy--acting[data-heavy-attack]')
    await page.evaluate(() => window.heavyFixture.resolve())
    assert.notEqual(await page.evaluate(() => window.heavyFixture.state.phase), 'enemy', `${screen}: the engine resolved the enemy phase`)
    await scrub(1100)
    await page.waitForTimeout(60)
    assert.equal(await page.locator('.boss-heavy-target__impact').count(), 2, `${screen}: landings survive the phase resolving`)
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.boss-heavy-target__burst--echo')].every(element => Number(getComputedStyle(element).opacity) > 0.3)),
      `${screen}: second strike lands after the phase resolved`)

    // A real swing ends cleanly: every layer unmounts and the stage stops shaking.
    await page.evaluate(() => { window.holdBossAttack = false; window.heavyFixture.install('slime_boss', 2) })
    await ready('slime_boss')
    await page.evaluate(() => window.heavyFixture.attack())
    await page.waitForSelector('.enemy[data-heavy-attack]')
    await page.waitForFunction(() => !document.querySelector('.enemy[data-heavy-attack]') && !document.querySelector('.boss-heavy-target'), null, { timeout: 15000 })
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.board')).animationName), 'none', `${screen}: stage rests after the swing`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Boss big-hit signatures passed')
} finally {
  await browser.close()
  await server.close()
}
