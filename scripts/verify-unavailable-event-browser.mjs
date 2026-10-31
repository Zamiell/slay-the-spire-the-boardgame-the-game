import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom } from './lib/rooms.mjs'
import { EVENT_DEFINITIONS } from '../src/game/events.ts'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/unavailable-event'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: `http://127.0.0.1:${address.port}` }, '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true } },
} })
await server.listen()
const browser = await chromium.launch()
let releaseAction
const errors = []
function fixture(id, players, emptyRewards = false) {
  const run = postNeowRun(47, players)
  run.players.forEach(player => { player.gold = emptyRewards ? 10 : 0; player.relics = []; player.potions = [] })
  if (emptyRewards) { run.itemDecks.relics = []; run.relicDeck = [] }
  const roomId = run.map.rows[0][0]
  run.map.rooms[roomId].kind = 'event'
  run.eventDeck = [{ ...EVENT_DEFINITIONS[id], instanceId: `unavailable-${id}`, act: 1,
    minAscension: 0, requiresColorlessUnlock: false }]
  return { run, roomId }
}
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    page.on('pageerror', error => errors.push(error.message))
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    await page.goto(origin)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
      await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const playerId = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].id)
    const notice = page.locator('.event-panel--unavailable')
    const continueButton = () => notice.getByRole('button', { name: 'Continue →', exact: true })
    for (const [id, emptyRewards] of [
      ['old_beggar', false], ['the_cleric', false], ['we_meet_again', false], ['nloth', false], ['we_meet_again', true],
    ]) {
      const { run, roomId } = fixture(id, [{ id: playerId, name: 'Watcher', character: 'watcher' }], emptyRewards)
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
      const node = page.locator(`.room[data-room="${roomId}"]`)
      if (phone) { await node.tap(); await node.tap() }
      else await node.click()
      await notice.getByRole('heading', { name: 'No available choices', exact: true }).waitFor()
      assert.equal(await notice.locator('#event-title').innerText(), EVENT_DEFINITIONS[id].name)
      assert.match(await notice.getByRole('status').innerText(), /continue without choosing an option/)
      await page.waitForTimeout(300)
      let held = await page.evaluate(() => window.__STS_DEBUG__.getRun())
      assert.equal(held.phase, 'room', 'an unavailable event must wait for acknowledgment')
      assert.deepEqual(held.players, run.players, 'showing the notice must not spend any resources')
      await continueButton().scrollIntoViewIfNeeded()
      assert(await continueButton().evaluate(button => {
        const box = button.getBoundingClientRect()
        const panel = button.closest('.event-panel').getBoundingClientRect()
        return box.left >= panel.left && box.right <= panel.right && box.top >= 0 && box.bottom <= innerHeight &&
          button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      }), `${screen}/${id}: Continue must fit and be reachable`)
      if (id === 'old_beggar') {
        await page.screenshot({ path: `${output}/${screen}-notice.png` })
        await page.reload()
        await page.getByRole('button', { name: 'Resume', exact: true }).click()
        await notice.waitFor()
        assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().phase), 'room')
        await page.evaluate(() => {
          const run = structuredClone(window.__STS_DEBUG__.getRun())
          run.players[0].gold = 4
          window.__STS_DEBUG__.setRun(run)
        })
        await notice.waitFor({ state: 'detached' })
        await page.locator('.event-options button:enabled').first().waitFor()
        await page.evaluate(() => {
          const run = structuredClone(window.__STS_DEBUG__.getRun())
          run.players[0].gold = 0
          window.__STS_DEBUG__.setRun(run)
        })
        await notice.waitFor()
      }
      held = await page.evaluate(() => window.__STS_DEBUG__.getRun())
      if (phone) await continueButton().tap()
      else await continueButton().click()
      await page.locator('.map').waitFor()
      const after = await page.evaluate(() => window.__STS_DEBUG__.getRun())
      assert.equal(after.roomState, null)
      assert.equal(after.map.position, roomId)
      assert.deepEqual(after.players, held.players)
    }

    const room = createRoom(rooms.store)
    const owner = joinRoom(room, { name: 'Owner', character: 'watcher' })
    joinRoom(room, { name: 'Peer', character: 'silent' })
    const { run, roomId } = fixture('old_beggar', room.seats.map(seat =>
      ({ id: seat.playerId, name: seat.name, character: seat.character })))
    room.phase = 'run'
    room.run = enterRoom(run, roomId)
    room.version++
    const before = structuredClone(room.run)
    await page.evaluate(session => sessionStorage.setItem('sts-room-session', JSON.stringify(session)),
      { code: room.code, token: owner.token })
    await page.reload()
    await page.locator('.connection--connected').waitFor()
    await notice.waitFor()
    await page.waitForTimeout(300)
    assert.deepEqual(room.run, before, 'opening the online notice must not send an automatic skip')
    await page.reload()
    await page.locator('.connection--connected').waitFor()
    await notice.waitFor()
    assert.deepEqual(room.run, before, 'reconnecting must preserve the unavailable event')
    room.run.roomState.pendingDecisions = { [room.seats[1].playerId]: { optionIds: ['give'] } }
    room.version++
    rooms.publishRoom(room.code)
    await notice.getByRole('status').filter({ hasText: 'Another player is resolving a choice' }).waitFor()
    assert(await continueButton().isDisabled(), 'a shared pending choice must finish before skipping')
    room.run = structuredClone(before)
    room.version++
    rooms.publishRoom(room.code)
    await notice.getByRole('status').filter({ hasText: 'continue without choosing an option' }).waitFor()
    let attempts = 0
    const gate = new Promise(resolve => { releaseAction = resolve })
    await page.route('**/api/rooms/*/action', async route => {
      if (route.request().postDataJSON()?.action?.kind !== 'eventSkip') return route.continue()
      attempts++
      if (attempts === 1) return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ error: 'Please try Continue again.' }) })
      await gate
      return route.continue()
    })
    await continueButton().click()
    await page.getByRole('alert').filter({ hasText: 'Please try Continue again.' }).waitFor()
    await continueButton().waitFor()
    await page.waitForTimeout(350)
    assert.equal(attempts, 1, 'a refusal must not automatically retry leaving the event')
    assert(await continueButton().isEnabled(), 'Continue must become available again after a refusal')
    await continueButton().click()
    const pending = notice.getByRole('button', { name: 'Leaving event…', exact: true })
    await pending.waitFor()
    assert(await pending.isDisabled(), 'an in-flight Continue must not be submitted twice')
    assert.deepEqual(room.run, before)
    releaseAction()
    await page.locator('.map').waitFor()
    assert.equal(attempts, 2)
    assert.equal(room.run.phase, 'map')
    assert.equal(room.run.roomState, null, 'one acknowledgment must settle all unavailable seats')
    assert.deepEqual(room.run.players, before.players)
    const partial = fixture('we_meet_again', room.seats.map(seat =>
      ({ id: seat.playerId, name: seat.name, character: seat.character })))
    partial.run.players[1].relics = [{ defId: 'anchor', spent: false }]
    room.run = enterRoom(partial.run, partial.roomId)
    room.version++
    rooms.publishRoom(room.code)
    await notice.waitFor()
    await continueButton().click()
    await page.getByRole('status').filter({ hasText: 'No options are available for you. Waiting for the rest of the party' }).waitFor()
    assert.equal(room.run.phase, 'room', 'acknowledgment must preserve available teammate choices')
    assert.deepEqual(room.run.roomState.decisions[owner.playerId].optionIds, ['unavailable'])
    assert.equal(room.run.roomState.decisions[room.seats[1].playerId], undefined)
    await page.close()
    console.log(`PASS ${screen}: unavailable event explanation, explicit Continue, saved runs, online reconnect and retry`)
  }
  assert.deepEqual(errors, [])
} finally {
  releaseAction?.()
  await browser.close()
  await server.close()
  await rooms.close()
}
