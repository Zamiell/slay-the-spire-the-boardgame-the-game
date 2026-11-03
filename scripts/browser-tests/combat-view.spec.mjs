import { test, expect } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { apply, createRoom, createStore, joinRoom, queryCombat, snapshotFor } from '../lib/rooms.mjs'
import { createRun } from '../../src/game/run.ts'
import { createCombat } from '../../src/game/combat.ts'
import { createRng } from '../../src/game/rng.ts'

test.use({ appKey: import.meta.url })

function fixture() {
  const room = createRoom(createStore())
  const seat = joinRoom(room, { name: 'Owner', character: 'defect' })
  const other = joinRoom(room, { name: 'Teammate', character: 'ironclad' })
  room.phase = 'run'
  room.run = createRun(47, room.seats.map(player => ({
    id: player.playerId, name: player.name, character: player.character,
  })))
  room.run.phase = 'combat'
  room.run.neow = null
  const combat = room.run.combat = createCombat(createRng(47), room.run.players, [{
    uid: 'enemy', defId: 'jaw_worm', row: 0, hp: 50, maxHp: 50, block: 0,
    strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false, dead: false,
  }])
  combat.phase = 'player'
  combat.die = 1
  combat.pendingTriggers = []
  for (const player of combat.players) {
    player.energy = 9
    player.relics = []
    player.powers = []
    player.block = 0
  }
  combat.players[0].orbs = ['lightning', null, null]
  combat.players[0].hand = [
    { uid: 'dual', defId: 'dual_cast', upgraded: false },
    { uid: 'burn', defId: 'burn', upgraded: false },
  ]
  combat.players[1].hand = [{ uid: 'private-card', defId: 'daze', upgraded: false }]
  return { room, seat, other }
}

async function mount(page, appURL, room, seat, pause, respond) {
  const queries = []
  const actions = []
  const held = []
  await page.route('**/__combat-preview', async route => {
    const request = route.request().postDataJSON()
    queries.push(request)
    const body = queryCombat(room, seat.token, request)
    if (pause(request)) await new Promise(resolve => held.push(resolve))
    await route.fulfill({ json: body })
  })
  await page.route('**/__combat-action', async route => {
    const action = route.request().postDataJSON()
    actions.push(action)
    const result = respond ? await respond(action) : apply(room, seat.token, action).snapshot
    await route.fulfill({ json: result })
  })
  await page.route('**/__combat-view-fixture', async route => {
    const response = await route.fetch()
    const html = await response.text()
    const entry = '<script type="module" src="/src/main.tsx"></script>'
    assert(html.includes(entry))
    await route.fulfill({ response, body: html.replace(entry, '')
      .replace('<div id="root"></div>', '<main id="root" class="app-shell sts-scope"></main>') })
  })
  await page.goto(`${appURL}/__combat-view-fixture`)
  await page.evaluate(async snapshot => {
    const [React, DOM, screen, adapter, codec, snapshots] = await Promise.all([
      import('/@id/react'), import('/@id/react-dom/client'), import('/src/ui/CombatScreen.tsx'),
      import('/src/ui/combat-screen/online-view.ts'), import('/src/protocol/combat-query.ts'),
      import('/src/protocol/room-snapshot.ts'),
      import('/src/ui/styles.css'), import('/src/ui/chrome.css'),
    ])
    const h = React.createElement ?? React.default.createElement
    const root = (DOM.createRoot ?? DOM.default.createRoot)(document.querySelector('#root'))
    const api = window.combatView = { snapshot: snapshots.decodeRoomSnapshot(snapshot), refresh: 0, resyncFrame: null, deferUpdates: false,
      update(next) { api.snapshot = snapshots.decodeRoomSnapshot(next); render() } }
    const onQuery = async (request, signal) => {
      const response = await fetch('/__combat-preview', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal,
      })
      if (!response.ok) throw new Error('Combat query failed.')
      const reply = codec.decodeCombatQueryReply(await response.json())
      if (reply.status === 'stale') throw new DOMException('The combat changed.', 'AbortError')
      return reply.result
    }
    const onAction = async action => {
      const response = await fetch('/__combat-action', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
      })
      const next = await response.json()
      const outcome = next.status ? next : { status: 'accepted', snapshot: next }
      if (outcome.snapshot && !api.deferUpdates) api.update(outcome.snapshot)
      return outcome
    }
    function render() {
      const current = api.snapshot
      const state = adapter.onlineCombatView(current.run.combat, current.you.playerId)
      api.state = state
      root.render(h(React.StrictMode ?? React.default.StrictMode, null, h(screen.CombatScreen, {
        state, act: 1, viewerId: current.you.playerId, onAction, onQuery,
        cardPreview: current.cardPreview,
        onResync: async () => {
          if (!api.resyncFrame) return false
          api.refresh++
          api.update(api.resyncFrame)
          return true
        },
        authoritativeVersion: current.version, authoritativeRefresh: api.refresh, authoritativeConnected: true,
        authoritativePendingTrigger: current.run.combat.pendingTriggerAbility,
        viewerStanceChangedThisTurn: current.run.combat.viewerStanceChangedThisTurn,
        partyStartTurnAbilities: current.startTurnAbilities, partyStartTurnScryAbilities: current.startTurnScryAbilities,
        startTurnDecidedPlayerIds: current.startTurnDecided, requiredStartTurnPlayerIds: current.startTurnRequired,
        startTurnCoordinatorId: current.startTurnCoordinatorId, startTurnChoiceId: current.startTurnChoiceId,
        savedStartTurnEnemyTargets: current.startTurnEnemyTargets, savedStartTurnChoices: current.startTurnChoices,
        partyStartTurnPostRollLocked: current.startTurnPostRollLocked,
        partyStartTurnOrderPending: current.startTurnOrderPending, partyStartTurnOrderLocked: current.startTurnOrderLocked,
        requiredEndTurnPlayerIds: current.endTurnRequired, decidedPlayerIds: current.endTurnDecided,
        endTurnTopPlayerIds: current.endTurnTopPlayerIds, partyEndTurnAbilities: current.endTurnAbilities,
      })))
    }
    render()
  }, snapshotFor(room, seat.token))
  await page.locator('.hand .card').first().waitFor()
  return { queries, actions, release: () => { held.splice(0).forEach(resolve => resolve()) } }
}

test('a late HUD reply cannot replace a newer partial combat view', async ({ page, appURL, artifacts }) => {
  const { room, seat, other } = fixture()
  const firstVersion = room.version
  const driver = await mount(page, appURL, room, seat, request => request.version === firstVersion)
  try {
    await expect.poll(() => driver.queries.length).toBeGreaterThan(0)
    await expect(page.getByRole('img', { name: /^Teammate: incoming unblocked damage/ })).toContainText('unknown')
    assert.equal(await page.evaluate(() => 'rng' in window.combatView.state), false)
    room.run.combat.players[0].hand = room.run.combat.players[0].hand.filter(card => card.defId !== 'burn')
    room.version++
    await page.evaluate(snapshot => window.combatView.update(snapshot), snapshotFor(room, seat.token))
    const expected = queryCombat(room, seat.token, {
      combatId: room.run.combat.combatId, version: room.version, query: { kind: 'hud' },
    }).result.incoming[0][1].damage
    const incoming = page.getByRole('img', { name: /^Owner: incoming unblocked damage/ })
    await expect(incoming).toContainText(`Incoming: ~${expected}`)
    driver.release()
    await page.waitForTimeout(150)
    await expect(incoming).toContainText(`Incoming: ~${expected}`)
    assert.equal(driver.actions.length, 0)
    await page.screenshot({ path: resolve(artifacts, 'fresh-hud.png') })
  } finally { driver.release() }
})

test('a decoded Oddly Smooth Stone choice can give Block to a teammate', async ({ page, appURL }) => {
  const { room, seat, other } = fixture()
  Object.assign(room.run.combat, { phase: 'start', turn: 2, die: 4, startTurnProgress: undefined })
  room.run.combat.players[0].relics = [{ defId: 'oddly_smooth_stone', spent: false }]
  await mount(page, appURL, room, seat, () => false)
  await page.getByRole('button', { name: "Resolve Owner's Oddly Smooth Stone", exact: true }).click()
  await page.locator(`.seat--targetable[data-player-id="${other.playerId}"]`).press('Enter')
  await page.getByRole('button', { name: /^(Resolve start|Confirm start-of-turn)/ }).click()
  await expect.poll(() => room.run.combat.phase).toBe('player')
  assert.equal(room.run.combat.players[1].block, 2)
})

test('an uncertain private reveal stays locked until a later successful refresh', async ({ page, appURL, artifacts }) => {
  const { room, seat } = fixture()
  Object.assign(room.run.combat.players[0], {
    hand: [{ uid: 'scry', defId: 'third_eye', upgraded: false }], draw: [], discard: [],
  })
  let first = true
  const driver = await mount(page, appURL, room, seat, () => false, action => {
    if (first) { first = false; return { status: 'unknown', refreshAttempt: 0 } }
    return apply(room, seat.token, action).snapshot
  })
  const card = page.locator('.hand .card[data-card-name="Third Eye"]')
  await card.press('Enter')
  await expect(page.getByRole('alert')).toContainText('confirm the card reveal')
  await page.getByRole('button', { name: 'Check room state' }).click()
  await expect(page.getByRole('alert')).toContainText('confirm the card reveal')
  await page.evaluate(() => window.combatView.update(structuredClone(window.combatView.snapshot)))
  await page.waitForTimeout(100)
  assert.deepEqual(driver.actions.map(action => action.kind), ['previewCard'])
  await page.screenshot({ path: resolve(artifacts, 'uncertain-reveal.png') })
  await page.evaluate(snapshot => { window.combatView.resyncFrame = snapshot }, snapshotFor(room, seat.token))
  await page.getByRole('button', { name: 'Check room state' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await card.press('Enter')
  await expect.poll(() => driver.actions.map(action => action.kind)).toEqual(['previewCard', 'previewCard', 'playCard'])
  await expect(card).toHaveCount(0)
  assert.equal(room.run.combat.players[0].discard.filter(card => card.uid === 'scry').length, 1)
})

for (const status of ['accepted', 'reconciled']) test(`a ${status} reveal waits for its rendered frame before continuing an empty Scry`, async ({ page, appURL }) => {
  const { room, seat } = fixture()
  Object.assign(room.run.combat.players[0], {
    hand: [{ uid: 'scry', defId: 'third_eye', upgraded: false }], draw: [], discard: [],
  })
  const driver = await mount(page, appURL, room, seat, () => false,
    action => ({ status, snapshot: apply(room, seat.token, action).snapshot }))
  await page.evaluate(() => { window.combatView.deferUpdates = true })
  await page.locator('.hand .card[data-card-name="Third Eye"]').press('Enter')
  await expect(page.getByRole('alert')).toContainText('confirm the card reveal')
  assert.deepEqual(driver.actions.map(action => action.kind), ['previewCard'])
  await page.evaluate(snapshot => {
    window.combatView.deferUpdates = false
    window.combatView.update(snapshot)
  }, snapshotFor(room, seat.token))
  await expect.poll(() => driver.actions.map(action => action.kind)).toEqual(['previewCard', 'playCard'])
})

for (const resource of ['shiv', 'soulburn']) test(`uncertain ${resource} spending cannot consume another token before recovery`, async ({ page, appURL }) => {
  const { room, seat } = fixture()
  const actor = room.run.combat.players[0]
  actor.shivs = 2
  actor.soulburn = 2
  actor.heat = 3
  actor.relics = [{ defId: 'corrupted_shard', spent: false }]
  let first = true
  const driver = await mount(page, appURL, room, seat, () => false, action => {
    if (first) { first = false; return { status: 'unknown', refreshAttempt: 0 } }
    return apply(room, seat.token, action).snapshot
  })
  const button = page.getByRole('button', { name: resource === 'shiv' ? 'Use Shiv' : /^Spend Soulburn,/ })
  await button.press('Enter')
  await expect(page.getByRole('alert')).toContainText('confirm the resource spend')
  await expect(button).toBeDisabled()
  await page.getByRole('button', { name: 'Check room state' }).click()
  await expect(button).toBeDisabled()
  assert.equal(driver.actions.length, 1)
  await page.evaluate(snapshot => { window.combatView.resyncFrame = snapshot }, snapshotFor(room, seat.token))
  await page.getByRole('button', { name: 'Check room state' }).click()
  await expect(button).toBeEnabled()
  await button.press('Enter')
  await expect.poll(() => driver.actions.length).toBe(2)
  await expect.poll(() => room.run.combat.players[0][resource === 'shiv' ? 'shivs' : 'soulburn']).toBe(1)
})

test('delayed authoritative Orb planning submits one card without exposing teammate piles', async ({ page, appURL, artifacts }) => {
  const { room, seat } = fixture()
  let pause = true
  const driver = await mount(page, appURL, room, seat, request => pause && request.query.kind === 'evoke')
  try {
    const before = structuredClone(room.run.combat)
    const card = page.locator('.hand').getByRole('button', { name: /Dual Cast.*cost/i })
    await expect(card).toBeVisible()
    const box = await card.boundingBox()
    const viewport = page.viewportSize()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(viewport.width / 2, viewport.height * .4, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => driver.queries.filter(request => request.query.kind === 'evoke').length).toBeGreaterThan(0)
    assert.equal(driver.actions.length, 0)
    assert.deepEqual(room.run.combat, before)
    await page.screenshot({ path: resolve(artifacts, 'awaiting-target-plan.png') })
    pause = false
    driver.release()
    await expect.poll(() => driver.actions.length).toBe(1)
    await expect(card).toHaveCount(0)
    assert.equal(room.run.combat.enemies[0].hp, 46)
    assert.deepEqual(driver.actions[0].evokeEnemyUids, ['enemy', 'enemy'])
    assert.equal(await page.evaluate(() => window.combatView.state.players[1].hand), null)
    await page.waitForTimeout(700)
    await page.screenshot({ path: resolve(artifacts, 'resolved-orbs.png') })
  } finally { pause = false; driver.release() }
})
