import { test, expect } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { apply, createRoom, createStore, joinRoom, snapshotFor } from '../lib/rooms.mjs'
import { createRun, enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url })

function fixture(phase) {
  const room = createRoom(createStore(), { code: 'CHOICE' })
  const seat = joinRoom(room, { name: 'Ann', character: 'ironclad' })
  const other = joinRoom(room, { name: 'Bo', character: 'silent' })
  room.phase = 'run'
  room.run = createRun(47, room.seats.map(seat => ({ id: seat.playerId, name: seat.name, character: seat.character })))
  room.run.neow = null
  room.run.phase = 'map'
  if (phase === 'campfire') {
    const id = room.run.map.rows[0][0]
    room.run.map.rooms[id].kind = 'campfire'
    room.run = enterRoom(room.run, id)
  } else {
    room.run.phase = 'reward'
    room.run.rewardDestination = 'map'
    room.run.rewards = room.seats.map(seat => ({
      playerId: seat.playerId, gold: 8, potion: 'weak_potion', potionQueue: ['weak_potion'],
      relic: 'anchor', bossRelics: false, cardReward: true, choices: null, upgraded: false,
    }))
  }
  for (const player of room.run.players) {
    player.hp = 1
    player.potions = []
  }
  return { room, seat, other }
}

async function mount(page, appURL, room, seat, mode) {
  await page.route('**/__noncombat-fixture', async route => {
    const response = await route.fetch()
    const html = await response.text()
    const entry = '<script type="module" src="/src/main.tsx"></script>'
    assert(html.includes(entry), 'fixture must replace only the application entrypoint')
    await route.fulfill({ response, body: html.replace(entry, '')
      .replace('<div id="root"></div>', '<main id="root" class="app-shell sts-scope"></main>') })
  })
  await page.goto(`${appURL}/__noncombat-fixture`)
  await page.evaluate(async ({ snapshot, players, mode }) => {
    const [React, DOM, campfire, reward, local, scope] = await Promise.all([
      import('/@id/react'), import('/@id/react-dom/client'),
      import('/src/ui/OnlineCampfireScreen.tsx'), import('/src/ui/OnlineRewardScreen.tsx'),
      import('/src/ui/CampfireScreen.tsx'), import('/src/ui/actions/room-action.ts'),
      import('/src/ui/styles.css'), import('/src/ui/chrome.css'),
    ])
    const h = React.createElement ?? React.default.createElement
    const root = (DOM.createRoot ?? DOM.default.createRoot)(document.querySelector('#root'))
    const api = window.noncombat = {
      snapshot, refresh: 0, calls: [], refreshResult: false,
      update(next, refresh = api.refresh) { api.snapshot = next; api.refresh = refresh; render() },
      reply(index, outcome) { api.calls[index].resolve(outcome) },
      reject(index) { api.calls[index].reject(new Error('Connection interrupted')) },
    }
    const render = () => {
      const snapshot = api.snapshot
      const run = snapshot.run
      const viewer = snapshot.you.playerId
      const onAction = action => new Promise((resolve, reject) => {
        api.calls.push({ action, viewer, resolve, reject })
      })
      const props = { key: scope.roomActionScope(snapshot), snapshot, refresh: api.refresh, onAction,
        onResync: async () => {
          if (!api.refreshResult) return false
          api.update(api.refreshResult.snapshot, api.refreshResult.refresh)
          return true
        } }
      if (mode === 'local-campfire') {
        root.render(h(local.CampfireScreen, { players: [players[0]], onResolve: choices => {
          api.calls.push({ action: { kind: 'campfire', choices }, viewer })
        } }))
      } else if (mode === 'campfire') {
        root.render(h(campfire.OnlineCampfireScreen, { ...props,
          player: run.players.find(player => player.id === viewer), saved: snapshot.campfireChoice,
          decided: snapshot.campfireDecided, seats: snapshot.seats,
          transformAvailable: snapshot.campfireTransformAvailable,
        }))
      } else {
        root.render(h(reward.OnlineRewardScreen, { ...props, run, viewerId: viewer }))
      }
    }
    render()
    await document.fonts.ready
  }, { snapshot: snapshotFor(room, seat.token), players: room.run.players, mode })
}

const calls = page => page.evaluate(() => window.noncombat.calls.map(({ action, viewer }) => ({ action, viewer })))
const reply = (page, index, outcome) => page.evaluate(({ index, outcome }) => window.noncombat.reply(index, outcome), { index, outcome })
const update = (page, snapshot, refresh = 0) => page.evaluate(({ snapshot, refresh }) =>
  window.noncombat.update(snapshot, refresh), { snapshot, refresh })
const commit = async (page, room, seat, index) => {
  const action = (await calls(page))[index].action
  const result = apply(room, seat.token, action)
  await update(page, result.snapshot)
  await reply(page, index, { status: 'accepted', snapshot: result.snapshot })
}

for (const mode of ['local-campfire', 'campfire']) test(`${mode}: shared Remove then Transform choices`, async ({ page, appURL }, info) => {
  const { room, seat } = fixture('campfire')
  const player = room.run.players[0]
  player.relics = ['peace_pipe', 'straight_razor'].map(defId => ({ defId, spent: false }))
  player.deck = [
    { uid: 'bane', defId: 'ascenders_bane', upgraded: false },
    { uid: 'curse', defId: 'injury', upgraded: false },
    { uid: 'strike', defId: 'strike_ironclad', upgraded: false },
    { uid: 'defend', defId: 'defend_ironclad', upgraded: false },
  ]
  await mount(page, appURL, room, seat, mode)
  await page.getByRole('button', { name: /^Rest/ }).click()
  await expect(page.getByRole('dialog', { name: 'Choose a card to remove' })).toBeVisible()
  await expect(page.locator('.card-picker__grid .card')).toHaveCount(3)
  await page.locator('.card-picker__grid .card[data-card-name="Strike"]').click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose a card to transform' })).toBeVisible()
  await expect(page.locator('.card-picker__grid .card')).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('campfire-transform.png') })
  await page.locator('.card-picker__grid .card').click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(1)
  assert.deepEqual((await calls(page))[0].action.choices[seat.playerId],
    { choice: 'rest', removeCardUid: 'strike', transformCardUid: 'defend' })
})

test('campfire: uncertain and rejected delivery cannot duplicate a choice', async ({ page, appURL }, info) => {
  const { room, seat } = fixture('campfire')
  await mount(page, appURL, room, seat, 'campfire')
  await page.getByRole('button', { name: /^Rest/ }).click()
  await reply(page, 0, { status: 'unknown', refreshAttempt: 5 })
  const check = page.getByRole('button', { name: 'Check room state' })
  await expect(check).toBeVisible()
  await check.click()
  await expect(page.getByRole('alert')).toContainText('remains locked')
  assert(await check.evaluate(button => {
    const box = button.getBoundingClientRect()
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight &&
      box.height < 80
  }), 'recovery must remain reachable on the supported screen')
  await page.screenshot({ path: info.outputPath('campfire-recovery.png') })
  await update(page, snapshotFor(room, seat.token), 5)
  await expect(check).toBeVisible()
  assert.equal((await calls(page)).length, 1)
  await page.evaluate(snapshot => {
    window.noncombat.refreshResult = { snapshot, refresh: 6 }
  }, snapshotFor(room, seat.token))
  await check.click()
  await expect(page.getByRole('button', { name: /^Rest/ })).toBeEnabled()
  await page.getByRole('button', { name: /^Rest/ }).click()
  await reply(page, 1, { status: 'refused', snapshot: snapshotFor(room, seat.token) })
  await expect(page.getByRole('button', { name: /^Rest/ })).toBeEnabled()
  await page.getByRole('button', { name: /^Rest/ }).click()
  await commit(page, room, seat, 2)
  await expect(page.getByRole('status')).toContainText('Ann chose to Rest')
  assert.equal((await calls(page)).length, 3)
})

test('rewards: partial Skip stops on uncertainty and resumes only remaining loot', async ({ page, appURL }, info) => {
  const { room, seat } = fixture('reward')
  await mount(page, appURL, room, seat, 'reward')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await commit(page, room, seat, 0)
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await reply(page, 1, { status: 'unknown', refreshAttempt: 1 })
  await expect(page.getByRole('button', { name: 'Check room state' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('reward-recovery-arrival.png') })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished))
  })
  await page.screenshot({ path: info.outputPath('reward-recovery.png') })
  assert.deepEqual((await calls(page)).map(call => call.action.kind), ['goldReward', 'potionReward'])
  await update(page, snapshotFor(room, seat.token), 2)
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect.poll(async () => (await calls(page)).length).toBe(3)
  assert.equal((await calls(page))[2].action.kind, 'potionReward', 'Gold must not be sent twice')
  await commit(page, room, seat, 2)
  await expect.poll(async () => (await calls(page)).length).toBe(4)
  await commit(page, room, seat, 3)
  await expect.poll(async () => (await calls(page)).length).toBe(5)
  await commit(page, room, seat, 4)
  await expect(page.getByRole('status')).toHaveText('Waiting for teammates…')
})

test('rewards: acknowledgement waits for rendered evidence, including duplicate Potions', async ({ page, appURL, phone }) => {
  const { room, seat } = fixture('reward')
  await mount(page, appURL, room, seat, 'reward')
  await page.getByRole('button', { name: '8 Gold', exact: true }).click()
  const result = apply(room, seat.token, { kind: 'goldReward' })
  await reply(page, 0, { status: 'accepted', snapshot: result.snapshot })
  await expect(page.getByRole('button', { name: 'Check room state' })).toBeVisible()
  await update(page, result.snapshot)
  await expect(page.getByRole('button', { name: '8 Gold', exact: true })).toHaveCount(0)
  const potion = page.getByRole('button', { name: /Weak Potion/ })
  if (phone) {
    await potion.tap()
    assert.equal((await calls(page)).length, 1, 'the first touch must inspect, not claim, the Potion')
    await potion.tap()
  } else await potion.click()
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await commit(page, room, seat, 1)
  await expect(page.getByRole('button', { name: /Weak Potion/ })).toBeEnabled()
  assert.equal(room.run.rewards[0].potion, 'weak_potion')
  assert.equal(room.run.rewards[0].potionQueue?.length ?? 0, 0)
})

test('rewards: changing viewer fences delayed replies and unsent batch actions', async ({ page, appURL }) => {
  const { room, seat, other } = fixture('reward')
  await mount(page, appURL, room, seat, 'reward')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await update(page, snapshotFor(room, other.token))
  await expect(page.getByRole('button', { name: '8 Gold', exact: true })).toBeEnabled()
  await reply(page, 0, { status: 'accepted' })
  await page.getByRole('button', { name: '8 Gold', exact: true }).click()
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  assert.equal((await calls(page))[1].viewer, other.playerId)
  assert.equal((await calls(page))[1].action.kind, 'goldReward')
  await page.evaluate(() => window.noncombat.reject(1))
  await expect(page.getByRole('button', { name: 'Check room state' })).toBeVisible()
})
