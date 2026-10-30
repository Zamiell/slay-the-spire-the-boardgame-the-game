import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { pickUpCard, confirmCardPlay } from './lib/card-interactions.mjs'

const output = 'artifacts/incoming-damage'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const run = postNeowRun(83, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const next = enterRoom(run, room)
    Object.assign(next.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined })
    Object.assign(next.combat.players[0], {
      hp: 9, maxHp: 9, block: 1, energy: 3, vulnerable: 0, relics: [], potions: [],
      hand: [{ uid: 'defend', defId: 'defend_watcher', upgraded: false },
        { uid: 'strike', defId: 'strike_watcher', upgraded: false }],
      powers: [{ uid: 'water', defId: 'like_water', upgraded: false }],
    })
    next.combat.enemies = [0, 1].map(index => ({
      ...next.combat.enemies[0], uid: `slime-${index}`, defId: 'small_slime', row: 0,
      hp: 30, maxHp: 30, strength: index === 0 ? 1 : 0, block: 0, weak: 0, dead: false,
    }))
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), next)
    const counter = page.locator('.row--viewer .seat__incoming-damage')
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 2')
    const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    if (phone) await counter.tap()
    else await counter.hover()
    const tip = page.locator('.potion-tip').filter({ hasText: 'incoming unblocked damage 2' })
    await tip.waitFor()
    assert.match(await tip.innerText(), /current 1 Block/)
    assert.match(await tip.innerText(), /before end-of-turn effects and HP-loss prevention/)
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
      'reading incoming damage must not mutate combat or advance RNG')
    assert(await counter.evaluate(counter => {
      const box = counter.getBoundingClientRect()
      const strip = counter.closest('.seat__status-strip').getBoundingClientRect()
      const hp = counter.closest('.row__seat').querySelector('.bar').getBoundingClientRect()
      return box.left >= strip.left && box.right <= strip.right && box.top >= hp.bottom &&
        box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), `${screen}: incoming damage must fit under HP beside the existing status icons`)
    assert(await tip.evaluate(tip => {
      const box = tip.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }))
    await page.screenshot({ path: `${output}/${screen}-incoming.png` })
    await page.keyboard.press('Escape')
    await pickUpCard(page, page.locator('.hand .card[title="Defend"]'))
    await confirmCardPlay(page)
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 1')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.enemies[0].weak = 1
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 0')
    assert(await counter.evaluate(counter => counter.classList.contains('seat__incoming-damage--clear')))
    await page.screenshot({ path: `${output}/${screen}-blocked.png` })
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].block = 1
      run.combat.players.push({ ...structuredClone(run.combat.players[0]), id: 'p2', name: 'Teammate', row: 1, block: 0 })
      run.players = structuredClone(run.combat.players)
      run.combat.enemies[1].row = 1
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelectorAll('.seat__incoming-damage').length === 2)
    assert.equal(await page.locator('.row__seat:has([data-player-id="p1"]) .seat__incoming-damage').innerText(), 'Incoming: 0')
    assert.equal(await page.locator('.row__seat:has([data-player-id="p2"]) .seat__incoming-damage').innerText(), 'Incoming: 1')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat, { phase: 'start', startTurnStage: 'effects', startTurnProgress: undefined, die: 4 })
      run.combat.players[0].relics = [{ defId: 'gambling_chip', spent: false }, { defId: 'loaded_die', spent: false }]
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: ?')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: incoming damage, live Block/debuff updates, tooltip and party targets`)
  }
} finally {
  await browser.close()
  await server.close()
}
