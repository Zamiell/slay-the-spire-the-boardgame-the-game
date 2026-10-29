import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium, setTestUsername } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat, startPlayerTurnWithChoices } from '../src/game/combat.ts'
import { createRng } from '../src/game/rng.ts'

// Failure cases: capped cards also hide/refuse non-card tokens; tokens increment
// the card count; reconnect loses tokens; invalid/off-turn spending works.
for (const resource of ['shivs', 'soulburn']) {
  const shiv = resource === 'shivs'
  const label = shiv ? 'Shiv' : 'Soulburn'
  const actionKind = shiv ? 'spendShiv' : 'spendSoulburn'
  const damage = shiv ? 8 : 4 // Shiv bonus + Strength; Weak and Vulnerable cancel.
  const out = new URL(`../artifacts/${shiv ? 'shiv' : 'soulburn'}-time-warp-browser/`, import.meta.url)
  mkdirSync(out, { recursive: true })
  const rooms = createRoomServer()
  const address = await rooms.listen(0)
  const roomOrigin = `http://127.0.0.1:${address.port}`
  const vite = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
    watch: { ignored: ['**/artifacts/**'] }, proxy: {
    '/api': { target: roomOrigin }, '/ws': { target: roomOrigin, ws: true },
  } } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const guest = await browser.newPage({ viewport: { width: 844, height: 390 } })
    const errors = []
    for (const tab of [page, guest]) {
      tab.setDefaultTimeout(30_000)
      tab.on('pageerror', error => errors.push(String(error)))
    }
    async function enter(tab, name, code) {
      await tab.goto(origin, { waitUntil: 'domcontentloaded' })
      await setTestUsername(tab, name)
      await tab.getByRole('button', { name: 'Play online', exact: true }).click()
      await tab.locator('.online-character-roster').getByRole('button', { name: code ? 'Silent' : 'Defect', exact: true }).click()
      if (code) await tab.getByLabel('Room code').fill(code)
      await tab.getByRole('button', { name: code ? 'Join' : 'Create room', exact: true }).click()
      await tab.locator('.online-lobby').waitFor()
      return tab.evaluate(() => JSON.parse(sessionStorage.getItem('sts-room-session')))
    }
    const saved = await enter(page, 'WarpHex')
    await enter(guest, 'WarpGuest', saved.code)
    const room = rooms.store.rooms.get(saved.code)
    room.seats[0].character = shiv ? 'silent' : 'hexaghost'
    room.phase = 'run'
    room.run = createRun(4242, room.seats.map(seat => ({ id: seat.playerId, name: seat.name, character: seat.character })))
    room.run.phase = 'combat'
    room.run.act = 3
    room.run.neow = null
    room.run.combat = createCombat(createRng(47), room.run.players, [{
      uid: 'time', defId: 'time_eater', row: 0, isBoss: true, hp: 100, maxHp: 120,
      block: 0, strength: 0, vulnerable: 3, weak: 0, poison: 0, goldReward: 0,
      cardReward: null, actionIndex: 2, abilityUsed: true, dead: false,
    }])
    const actor = room.run.combat.players[0]
    Object.assign(actor, { hand: [{ uid: 'blocked-defend', defId: shiv ? 'defend_silent' : 'defend_hexaghost', upgraded: false }],
      heat: 4, [resource]: 2, shivDamageBonus: 1, cardsPlayedThisTurn: 3, strength: 6, weak: 2 })
    room.run.combat.phase = 'player'
    room.run.combat.turn = 6
    const cappedCombat = structuredClone(room.run.combat)
    room.run.combat.enemies[0].actionIndex = 0
    actor.cardsPlayedThisTurn = 0
    actor.hand = Array.from({ length: 6 }, (_, index) => ({
      uid: `time-warp-deflect-${index}`, defId: 'deflect', upgraded: false,
    }))
    room.endTurnReady = {}
    room.version++
    rooms.publishRoom(saved.code)
    const counter = page.locator('.combat__time-warp')
    const expectCount = (tab, count, limit) => tab.waitForFunction(({ count, limit }) =>
      document.querySelector('.combat__time-warp strong')?.textContent === `${count}/${limit}`, { count, limit })
    await expectCount(page, 0, 5)
    for (let count = 1; count <= 5; count++) {
      await page.locator('.hand .card').first().click()
      await expectCount(page, count, 5)
      if (count === 4) {
        assert.equal(await counter.getAttribute('data-warning'), 'true')
        assert.equal(await counter.getAttribute('data-limit-reached'), null)
        await page.screenshot({ path: new URL('desktop-one-card-left.png', out).pathname })
      }
    }
    assert.equal(await counter.getAttribute('data-limit-reached'), 'true')
    assert((await counter.innerText()).includes('Limit reached'))
    await expectCount(guest, 0, 5)
    assert(await page.locator('.hand .card').first().isDisabled(), 'the sixth card was not blocked')
    room.run.combat = { ...cappedCombat, combatId: `${cappedCombat.combatId}:tokens` }
    room.endTurnReady = { [actor.id]: true, [room.seats[1].playerId]: false }
    room.version++
    rooms.publishRoom(saved.code)
    const token = () => page.getByRole('button', { name: shiv ? 'Use Shiv' : /^Spend Soulburn,/ })
    await token().waitFor()
    if (shiv) {
      assert.equal((await token().innerText()).trim(), '2', 'Shiv button must show the available count')
      assert.equal(await token().getAttribute('aria-description'), '2 Shivs available')
    }
    await expectCount(page, 3, 3)
    assert(await page.locator('.hand .card').first().isDisabled(), 'Time Warp no longer caps ordinary cards')
    async function refuse(action) {
      const before = structuredClone(room.run)
      const response = await fetch(`${roomOrigin}/api/rooms/${saved.code}/action`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-room-token': saved.token },
        body: JSON.stringify({ action }),
      })
      assert(!response.ok, `illegal action accepted: ${JSON.stringify(action)}`)
      assert.deepEqual(room.run, before, 'refused action changed the run')
    }
    await refuse({ kind: 'playCard', cardUid: 'blocked-defend', preflight: true })
    await refuse({ kind: actionKind, enemyUid: 'missing-target' })
    await page.screenshot({ path: new URL('desktop-token-at-cap.png', out).pathname, fullPage: true })
    await token().click()
    await page.getByRole('button', { name: /^Time Eater,/ }).locator('.enemy__hit-area').click()
    await page.locator(shiv ? '[aria-label="Use Shiv"][aria-pressed="false"]'
      : '[aria-label="Spend Soulburn, 1 available"]').waitFor()
    if (shiv) {
      assert.equal((await token().innerText()).trim(), '1', 'spending a Shiv must update the visible count')
      assert.equal(await token().getAttribute('aria-description'), '1 Shivs available')
    }
    await guest.getByRole('button', { name: new RegExp(`^Time Eater, ${100 - damage} of`) }).waitFor()
    assert.equal(room.run.combat.players[0][resource], 1)
    assert.equal(room.run.combat.enemies[0].hp, 100 - damage, `${label} damage/modifiers changed`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await token().waitFor()
    await page.setViewportSize({ width: 844, height: 390 })
    if (shiv) {
      assert.equal((await token().innerText()).trim(), '1', 'reconnect must preserve the remaining Shiv count')
      assert(await token().evaluate((button) => {
        const box = button.getBoundingClientRect()
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      }), 'Shiv count is clipped on a horizontal phone')
    }
    await expectCount(page, 3, 3)
    assert(await counter.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), 'Time Warp counter is clipped on a horizontal phone')
    await page.screenshot({ path: new URL('phone-token-after-reconnect.png', out).pathname, fullPage: true })
    await token().click()
    await page.getByRole('button', { name: /^Time Eater,/ }).locator('.enemy__hit-area').click()
    await token().waitFor({ state: 'detached' })
    assert.equal(room.run.combat.enemies[0].hp, 100 - 2 * damage)
    assert.equal(room.run.combat.players[0].cardsPlayedThisTurn, 3)
    await expectCount(page, 3, 3)
    assert.equal(room.run.combat.players[0].attacksPlayedThisTurn, shiv ? 2 : 0)
    assert.equal(room.run.combat.players[0].energy, 3)
    assert.equal(room.run.combat.turn, 6)
    await refuse({ kind: actionKind, enemyUid: 'time' })
    for (const blocked of [{ phase: 'enemy' }, { cardPlayLocked: true }, { dead: true }]) {
      room.run.combat.players[0][resource] = 1
      if (blocked.phase) room.run.combat.phase = blocked.phase
      else Object.assign(room.run.combat.players[0], blocked)
      await refuse({ kind: actionKind, enemyUid: 'time' })
      room.run.combat.phase = 'player'
      Object.assign(room.run.combat.players[0], { cardPlayLocked: false, dead: false })
    }
    for (const [slot, limit] of [[0, 5], [1, 4], [2, 3]]) {
      room.run.combat.enemies[0].actionIndex = slot
      room.version++
      rooms.publishRoom(saved.code)
      await expectCount(page, 3, limit)
    }
    room.run.combat.phase = 'roundEnd'
    room.run.combat = startPlayerTurnWithChoices(room.run.combat)
    room.endTurnReady = {}
    room.version++
    rooms.publishRoom(saved.code)
    await expectCount(page, 0, 3)
    room.run.combat.enemies[0].dead = true
    room.run.combat.enemies[0].hp = 0
    room.version++
    rooms.publishRoom(saved.code)
    await counter.waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    writeFileSync(new URL('result.json', out), JSON.stringify({ passed: true,
      cardsPlayed: 3, resource, tokenDamage: 2 * damage, turn: 6,
      cases: ['ordinary cards capped', 'invalid target refused', `two ${label}s after cap`,
        'live per-player counter', 'one-card-left warning', 'rotating limits and next-turn reset',
        'reconnect and horizontal phone', 'card counter unchanged; Shivs count as Attacks',
        'empty, off-turn, locked and dead spending refused', 'already-ready owner can spend'] }, null, 2))
    console.log(`PASS ${label}/Time Warp browser; ${new URL('result.json', out).pathname}`)
  } finally {
    await browser.close()
    await vite.close()
    await rooms.close()
  }
}
