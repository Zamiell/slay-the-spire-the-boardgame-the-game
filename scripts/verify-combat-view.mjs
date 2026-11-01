import assert from 'node:assert/strict'
import { createRoomServer } from './room-server.mjs'
import { createRoom, createStore, joinRoom, queryCombat, snapshotFor } from './lib/rooms.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat, canActivatePotion, startTurnAbilities } from '../src/game/combat.ts'
import { createRng } from '../src/game/rng.ts'
import { combatActor, hasCombatSimulation, localCombat } from '../src/game/combat/view.ts'
import { decodeCombatQueryReply, parseCombatQuery } from '../src/protocol/combat-query.ts'
import { redactPlayer } from '../src/server/player-projection.ts'
import { previewCardDamage } from '../src/game/combat/preview.ts'
import { evaluateCombatQuery } from '../src/game/combat/preview-queries.ts'
import { onlineCombatView } from '../src/ui/combat-screen/online-view.ts'
import { suite, check, report } from './lib/harness.mjs'

const card = (defId, uid = defId) => ({ uid, defId, upgraded: false })
function fixture(store = createStore()) {
  const room = createRoom(store)
  const seats = ['ironclad', 'defect'].map(character => joinRoom(room, { name: character, character }))
  const run = createRun(47, seats.map(seat => ({ id: seat.playerId, name: seat.name, character: seat.character })))
  run.phase = 'combat'
  run.neow = null
  run.combat = createCombat(createRng(47), run.players, [{
    uid: 'public-enemy', defId: 'jaw_worm', row: 0, hp: 50, maxHp: 50, block: 0,
    strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false, dead: false,
  }])
  run.combat.phase = 'player'
  run.combat.die = 1
  run.combat.pendingTriggers = []
  for (const player of run.combat.players) {
    player.relics = []
    player.powers = []
    player.block = 0
    player.energy = 9
  }
  run.combat.players[0].hand = [card('strike_ironclad'), card('burn')]
  run.combat.players[1].hand = [card('daze', 'private-teammate-card')]
  room.run = run
  room.phase = 'run'
  const request = query => ({ version: room.version, combatId: run.combat.combatId, query })
  return { room, seats, combat: run.combat, request }
}

suite('combat views')
check('redacted piles remain unknown and cannot supply local simulation authority', () => {
  const { room, seats } = fixture()
  const view = onlineCombatView(snapshotFor(room, seats[0].token).run.combat, seats[0].playerId)
  assert.equal(view.players[1].hand, null)
  assert.equal(view.players[1].draw, null)
  assert.equal(combatActor(view, seats[1].playerId), undefined)
  assert(combatActor(view, seats[0].playerId))
  assert.equal(hasCombatSimulation(view), false)
  assert.throws(() => localCombat(view), /simulation authority/)
  for (const field of ['rng', 'potionDeck', 'summonSupply', 'discardedThisTurn']) assert.equal(field in view, false)
})

check('authoritative HUD queries preserve the room and include only visible hand effects', () => {
  const { room, seats, combat, request } = fixture()
  const before = structuredClone(room)
  const reply = queryCombat(room, seats[0].token, request({ kind: 'hud' }))
  assert.deepEqual(decodeCombatQueryReply(JSON.parse(JSON.stringify(reply))), reply)
  assert.deepEqual(room, before)
  assert.equal(reply.result.incoming.length, 1)
  assert.equal(reply.result.incoming[0][0], seats[0].playerId)
  assert.equal(reply.result.incoming[0][1].hiddenHandEffects, true)
  assert(!JSON.stringify(reply).includes('private-teammate-card'))
  combat.players[1].hand = [card('shame', 'different-private-card')]
  assert.deepEqual(queryCombat(room, seats[0].token, request({ kind: 'hud' })), reply)
  combat.players[0].hand = [card('strike_ironclad')]
  const withoutBurn = queryCombat(room, seats[0].token, request({ kind: 'hud' }))
  assert(reply.result.incoming[0][1].damage > withoutBurn.result.incoming[0][1].damage)
})

check('private ordered supplies cannot become speculative damage information', () => {
  const { combat } = fixture()
  const actor = combat.players[0]
  actor.hand = [card('pommel_strike')]
  actor.draw = [card('daze')]
  assert(previewCardDamage(combat, actor.id, 'pommel_strike', 'public-enemy'))
  assert.equal(previewCardDamage(combat, actor.id, 'pommel_strike', 'public-enemy', true), null)
})

check('Transforming Brew availability comes from authority, not a fabricated empty reward pile', () => {
  const { combat } = fixture()
  const actor = combat.players[0]
  actor.potions = ['transforming_brew']
  actor.cardRewards = ['bash']
  actor.rareRewards = []
  const visible = redactPlayer(actor, actor.id)
  assert.equal(visible.transformAvailable, true)
  assert.equal(canActivatePotion(combat, visible, 'transforming_brew'), true)
  actor.cardRewards = []
  assert.equal(canActivatePotion(combat, redactPlayer(actor, actor.id), 'transforming_brew'), false)
  assert.equal(redactPlayer(actor, 'another-seat').transformAvailable, undefined)
})

check('Scry eligibility cannot reveal cards drawn by an uncommitted discard reaction', () => {
  const { room, seats, combat, request } = fixture()
  const actor = combat.players[0]
  actor.hand = [card('slayer_deceive_reality', 'source')]
  const revealed = [card('reflex'), card('clash'), card('strike_ironclad')]
  actor.draw = [...revealed, card('daze', 'hidden-next')]
  room.cardPreviews = { [actor.id]: { cardUid: 'source', kind: 'scryToHand', cards: revealed } }
  const query = { kind: 'scryPlay', source: 'hand', cardUid: 'source', discarded: ['reflex'],
    context: { enemyUid: null, playerId: actor.id } }
  const first = evaluateCombatQuery(combat, actor.id, query, { revealedCards: revealed })
  assert(!first.eligible.includes('clash'))
  const publicFirst = queryCombat(room, seats[0].token, request(query))
  assert.equal(publicFirst.result.eligible, null)
  assert.throws(() => queryCombat(room, seats[0].token, request({ ...query, discarded: ['hidden-next'] })), /revealed cards/)
  assert.throws(() => queryCombat(room, seats[0].token, request({
    ...query, context: { ...query.context, enemyUid: 'public-enemy' },
  })), /Reveal this card/)
  actor.draw[3] = card('strike_ironclad', 'hidden-next')
  const second = evaluateCombatQuery(combat, actor.id, query, { revealedCards: revealed })
  assert(second.eligible.includes('clash'))
  assert.deepEqual(queryCombat(room, seats[0].token, request(query)), publicFirst)
})

check('preview requests reject stale frames, foreign cards, and unbounded work', () => {
  const { room, seats, request } = fixture()
  assert.throws(() => queryCombat(room, 'unknown', request({ kind: 'hud' })), /Unknown seat/)
  assert.throws(() => queryCombat(room, seats[0].token, { ...request({ kind: 'hud' }), version: -1 }))
  assert.equal(queryCombat(room, seats[0].token, { ...request({ kind: 'hud' }), version: room.version + 1 }).status, 'stale')
  const query = { kind: 'evoke', cardUid: 'private-teammate-card', source: 'hand',
    context: { enemyUid: null, playerId: seats[0].playerId } }
  assert.throws(() => queryCombat(room, seats[0].token, request(query)), /not available/)
  assert.throws(() => parseCombatQuery(request({ ...query, context: { ...query.context, energySpent: 1e9 } })))
})

check('start-turn previews cannot substitute decisions for another seat', () => {
  const { room, seats, combat, request } = fixture()
  combat.phase = 'start'
  combat.turn = 2
  combat.players.forEach((player, index) => {
    player.powers = [card('infinite_blades', `blades-${index}`)]
    player.shivs = index === 0 ? 5 : 0
  })
  const abilities = startTurnAbilities(combat)
  const order = abilities.map(ability => ability.id)
  const base = { kind: 'startTurn', order, choices: order.map(id => ({ id, shivEnemyUids: [] })) }
  const before = structuredClone(room)
  const result = queryCombat(room, seats[0].token, request(base))
  const forged = structuredClone(base)
  forged.choices.find(choice => abilities.find(ability => ability.id === choice.id)?.playerId === seats[1].playerId)
    .shivEnemyUids = ['private-teammate-card']
  assert.deepEqual(queryCombat(room, seats[0].token, request(forged)), result)
  assert.deepEqual(room, before)
  decodeCombatQueryReply(JSON.parse(JSON.stringify(result)))
})

const service = createRoomServer()
try {
  const { port } = await service.listen(0)
  const { room, seats, request } = fixture(service.store)
  const before = structuredClone(room)
  const endpoint = `http://127.0.0.1:${port}/api/rooms/${room.code}/preview`
  const send = (token, body = request({ kind: 'hud' })) => fetch(endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-room-token': token },
    body: JSON.stringify(body),
  })
  const denied = await send('unknown')
  const allowed = await send(seats[0].token)
  const body = await allowed.json()
  check('HTTP previews authenticate without recording or advancing gameplay', () => {
    assert.equal(denied.status, 401)
    assert.equal(allowed.status, 200)
    decodeCombatQueryReply(body)
    assert.deepEqual(room, before)
  })
  const stale = { ...request({ kind: 'hud' }), version: room.version + 1 }
  const staleReply = await send(seats[0].token, stale)
  check('a retired read is an explicit stale outcome, not a noisy HTTP refusal', () => assert.equal(staleReply.status, 200))
  assert.equal(decodeCombatQueryReply(await staleReply.json()).status, 'stale')
  let throttled = false
  for (let batch = 0; batch < 13 && !throttled; batch++) {
    const statuses = await Promise.all(Array.from({ length: 25 }, async () => {
      const response = await send(seats[0].token, stale)
      await response.arrayBuffer()
      return response.status
    }))
    throttled = statuses.includes(429)
  }
  const recovery = await fetch(endpoint.replace('/preview', ''), { headers: { 'x-room-token': seats[0].token } })
  await recovery.arrayBuffer()
  check('calculation bursts cannot consume the room recovery read budget', () => {
    assert(throttled)
    assert.equal(recovery.status, 200)
  })
} finally { await service.close() }

report('combat views')
