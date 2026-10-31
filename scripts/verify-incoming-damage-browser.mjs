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
    assert.match(await tip.innerText(), /Other end-of-turn effects and HP-loss prevention/)
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
    await page.mouse.move(2, 2)
    await counter.evaluate(counter => counter.blur())
    await page.waitForTimeout(180)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.enemies[0], { hp: 2, poison: 2 })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 0')
    assert(await page.evaluate(() => {
      const enemy = window.__STS_DEBUG__.getRun().combat.enemies[0]
      return enemy.hp === 2 && enemy.poison === 2 && !enemy.dead
    }), 'the preview must not apply Poison to the live enemy')
    if (phone) await counter.tap()
    else { await page.mouse.move(2, 2); await counter.hover() }
    await page.locator('.potion-tip').filter({ hasText: 'incoming unblocked damage 0' }).waitFor()
    assert.match(await page.locator('.potion-tip').innerText(), /Includes Poison before attacks/)
    await page.screenshot({ path: `${output}/${screen}-lethal-poison.png` })
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.enemies[0].poison = 1
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 2')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.enemies[0], { hp: 30, poison: 0 })
      window.__STS_DEBUG__.setRun(run)
    })
    await pickUpCard(page, page.locator('.hand .card[data-card-name="Defend"]'))
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
      run.combat.players[0].block = 3
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 0 (+1)')
    if (phone) await counter.tap()
    else { await page.mouse.move(2, 2); await counter.hover() }
    const excessTip = page.locator('.potion-tip').filter({ hasText: '1 excess Block' })
    await excessTip.waitFor()
    assert.match(await excessTip.innerText(), /\(\+1\) means 1 excess Block would go unused/)
    assert.match(await counter.getAttribute('aria-label'), /1 excess Block/)
    assert(await counter.evaluate(counter => {
      const box = counter.getBoundingClientRect()
      const strip = counter.closest('.seat__status-strip').getBoundingClientRect()
      return box.left >= strip.left && box.right <= strip.right && box.bottom <= innerHeight
    }), `${screen}: the extra Block count must not clip`)
    await page.screenshot({ path: `${output}/${screen}-excess-block.png` })
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 2)
    await counter.evaluate(counter => counter.blur())
    await page.waitForTimeout(180)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].powers.push({ uid: 'retain-block', defId: 'barricade', upgraded: false })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 0')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.players[0], { stance: 'wrath', block: 0 })
      run.combat.players[0].powers = run.combat.players[0].powers.filter(power => power.defId !== 'barricade')
      run.combat.enemies.forEach(enemy => { enemy.defId = 'jaw_worm'; enemy.strength = 0; enemy.weak = 0 })
      run.combat.die = 6
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 1')
    if (phone) await counter.tap()
    else { await page.mouse.move(2, 2); await counter.hover() }
    const wrathTip = page.locator('.potion-tip').filter({ hasText: 'incoming unblocked damage 1' })
    await wrathTip.waitFor()
    assert.match(await wrathTip.innerText(), /Wrath adds 1 damage before enemy attacks/)
    assert.match(await wrathTip.innerText(), /Block absorbs 0 of it/)
    await page.screenshot({ path: `${output}/${screen}-wrath.png` })
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].block = 1
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.seat__incoming-damage')?.textContent === 'Incoming: 0')
    assert.match(await page.locator('.potion-tip').innerText(), /Block absorbs 1 of it/)
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].stance = 'neutral'
      run.combat.enemies.forEach(enemy => { enemy.defId = 'small_slime' })
      window.__STS_DEBUG__.setRun(run)
    })
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
    const partyBeforeFrost = await page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun()))
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[1].orbs = ['frost', null, null]
      window.__STS_DEBUG__.setRun(run)
    })
    const teammateCounter = page.locator('.row__seat:has([data-player-id="p2"]) .seat__incoming-damage')
    await page.waitForFunction(() => document.querySelector('.row__seat:has([data-player-id="p2"]) .seat__incoming-damage')
      ?.textContent === 'Incoming: 0')
    const beforeFrostInspection = await page.evaluate(() => window.__STS_DEBUG__.getRun())
    await teammateCounter.focus()
    const frostTip = page.locator('.potion-tip').filter({ hasText: 'plus 1 Block from Frost Orbs' })
    await frostTip.waitFor()
    assert.match(await frostTip.innerText(), /current bonuses and the Block cap/)
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun()), beforeFrostInspection)
    assert.equal(beforeFrostInspection.combat.players[1].block, 0, 'forecast Frost must not grant live Block')
    await page.screenshot({ path: `${output}/${screen}-frost.png` })
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[1].orbEndTurnBonus = 1
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.row__seat:has([data-player-id="p2"]) .seat__incoming-damage')
      ?.textContent === 'Incoming: 0 (+1)')
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), partyBeforeFrost)
    await teammateCounter.getByText('Incoming: 1', { exact: true }).waitFor()
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.enemies[1], { hp: 1, poison: 1 })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => [...document.querySelectorAll('.seat__incoming-damage')]
      .every(counter => counter.textContent === 'Incoming: 0'))
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat, { phase: 'start', startTurnStage: 'effects', startTurnProgress: undefined, die: 4 })
      run.combat.players[0].block = 0
      run.combat.players[0].relics = [{ defId: 'gambling_chip', spent: false }, { defId: 'the_abacus', spent: false }]
      run.combat.enemies[0].defId = 'jaw_worm'
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.row--viewer .seat__incoming-damage')?.textContent === 'Incoming: 4')
    await counter.evaluate(element => element.blur())
    await page.mouse.move(2, 2)
    await page.waitForTimeout(180)
    if (phone) await counter.tap()
    else await counter.hover()
    const startTip = page.locator('.potion-tip').filter({ hasText: 'Remaining start-of-turn choices' })
    await startTip.waitFor()
    assert.match(await startTip.innerText(), /Based on the current die and board/)
    await page.screenshot({ path: `${output}/${screen}-start-turn.png` })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Use The Abacus:/ }).press('Enter')
    await page.waitForFunction(() => document.querySelector('.row--viewer .seat__incoming-damage')?.textContent === 'Incoming: 0')
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.phase), 'start',
      'the preview must update before the remaining start-turn choices resolve')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: incoming damage, live Block/debuff updates, tooltip and party targets`)
  }
} finally {
  await browser.close()
  await server.close()
}
