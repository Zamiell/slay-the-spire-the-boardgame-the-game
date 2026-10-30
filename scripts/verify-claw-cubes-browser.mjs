import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/claw-cubes'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { port: 0 } })
await server.listen()
const browser = await chromium.launch()
const errors = []
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://localhost:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const run = postNeowRun(47, [{ id: 'p1', name: 'Defect', character: 'defect' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const combat = enterRoom(run, room)
    Object.assign(combat.combat, { phase: 'player', die: 1, turn: 1, presentationEvents: [] })
    Object.assign(combat.combat.players[0], {
      hp: 100, maxHp: 100, energy: 3, relics: [], powers: [], potions: [], orbs: [null, null, null],
      shivs: 1, clawCubesGainedThisCombat: 0,
      hand: [
        { uid: 'claw-one', defId: 'claw_claw_pack', upgraded: false },
        { uid: 'claw-two', defId: 'claw_claw_pack', upgraded: true },
        { uid: 'keep-turn', defId: 'deflect', upgraded: false },
      ],
      draw: Array.from({ length: 5 }, (_, i) => ({ uid: `next-${i}`, defId: 'deflect', upgraded: false })),
      discard: [], exhaust: [],
    })
    combat.combat.enemies = [{
      ...combat.combat.enemies[0], uid: 'target', defId: 'jaw_worm', hp: 50, maxHp: 50,
      block: 0, dead: false, isBoss: false,
    }]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), combat)
    await page.locator('.hand .card').first().waitFor()
    const counter = page.locator('.combat__claw-cubes')
    assert.equal(await counter.count(), 0, 'zero cubes should not add an empty status counter')
    for (const [name, count] of [['Claw (Claw Pack)', 1], ['Claw (Claw Pack)+', 2]]) {
      await page.locator(`.hand .card[title="${name}"]`).click()
      await page.locator('[data-enemy-id="target"] .enemy__hit-area').click()
      await page.waitForFunction(count => document.querySelector('.combat__claw-cubes strong')?.textContent === String(count), count)
    }
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.enemies[0].hp), 46)
    assert.equal(await counter.locator('.red-cube-icon').count(), 1)
    assert.equal(await page.locator('.seat__status-strip .token--clawCubes .red-cube-icon').count(), 1)
    const beforeInspection = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat))
    if (phone) await counter.tap()
    else { await page.keyboard.press('Tab'); await counter.focus() }
    const tip = page.locator('.potion-tip').filter({ hasText: 'Claw cubes: 2' })
    await tip.waitFor()
    assert.match(await tip.innerText(), /not spent/)
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat)), beforeInspection,
      'inspecting the counter must not spend cubes or mutate combat')
    assert(await counter.evaluate(element => {
      const box = element.getBoundingClientRect()
      const shiv = document.querySelector('.shiv-actions').getBoundingClientRect()
      const icon = element.querySelector('svg').getBoundingClientRect()
      const count = element.querySelector('strong').getBoundingClientRect()
      return box.left >= innerWidth / 2 && box.right <= innerWidth && box.top >= 0 &&
        box.bottom <= innerHeight && (box.right <= shiv.left || shiv.right <= box.left) &&
        Math.abs(icon.top + icon.height / 2 - count.top - count.height / 2) < 1
    }), `${screen}: Claw counter must fit at the top right without covering Shivs`)
    await page.screenshot({ path: `${output}/${screen}.png` })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^End Turn \d+/ }).click()
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getRun().combat
      return state.turn === 2 && state.phase === 'player'
    })
    assert.equal(await counter.locator('strong').innerText(), '2', 'Claw cubes must persist between turns')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      const teammate = { ...structuredClone(run.combat.players[0]), id: 'p2', name: 'Teammate', row: 1,
        clawCubesGainedThisCombat: 5 }
      run.combat.players.push(teammate)
      run.players = structuredClone(run.combat.players)
      window.__STS_DEBUG__.setRun(run)
      window.__STS_DEBUG__.setViewer('p2')
    })
    await page.waitForFunction(() => document.querySelector('.combat__claw-cubes strong')?.textContent === '5')
    await page.evaluate(async () => {
      const { createCombat } = await import('/src/game/combat.ts')
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat = createCombat(run.rng, run.combat.players, run.combat.enemies, 'fresh-claw-combat')
      window.__STS_DEBUG__.setRun(run)
    })
    await counter.waitFor({ state: 'detached' })
    assert(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players.every(player =>
      player.clawCubesGainedThisCombat === 0)), 'new combat must clear all players\' cubes')
    await page.close()
    console.log(`PASS ${screen}: live Claw cubes, tooltip, Shivs, turn persistence, viewer changes and combat reset`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
