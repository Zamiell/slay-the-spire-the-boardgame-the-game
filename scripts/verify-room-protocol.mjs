import { is } from 'valibot'
import { parseChoiceAction, RoomCredentialsSchema, UID_LIMIT } from '../src/protocol/actions.ts'
import {
  CardTargetsSchema, CardCharacterChoicesSchema, ChamberChoicesSchema,
  PowerChoicesSchema, TriggerTargetsSchema, parseActionFields,
} from '../src/protocol/action-fields.ts'
import {
  cardPlayContext, powerContext, potionContext, slotList, targetList,
} from './lib/rooms/action-context.mjs'
import { redactPlayer } from '../src/server/player-projection.ts'
import { redactRun, redactCombat } from './lib/rooms/projection.mjs'
import { createRoom, createStore, joinRoom, snapshotFor, startRun } from './lib/rooms.mjs'
import { createCombat } from '../src/game/combat.ts'
import { createRng } from '../src/game/rng.ts'
import { suite, check, assert, assertEqual, assertDeepEqual, report } from './lib/harness.mjs'

suite('room protocol')

check('migrated action schemas preserve error messages and validation order', () => {
  const die = { kind: 'resolveDieRelicChoice', choiceId: 7 }
  const player = { kind: 'resolvePlayerChoice', choiceId: 7 }
  const slayer = { kind: 'resolveSlayerChoice' }
  for (const [action, error] of [
    [{ ...die, choiceId: '7', enemyUid: 2 }, 'Die Relic choice id must be a whole number'],
    [{ ...die, enemyUid: [] }, 'Die Relic enemy must be a valid id'],
    [{ ...die, discardUids: ['card', 2] }, 'Discard choices must be a list of card ids'],
    [{ ...die, exhaustUids: Array(UID_LIMIT + 1).fill('card') }, 'Exhaust choices must be a list of card ids'],
    [{ ...player, choiceId: null, extra: true }, 'No card choice is pending'],
    [{ ...player, draw: 'true', extra: true }, 'A card choice answer carries only draw, discardUid or count'],
    [{ ...player, draw: 'true' }, 'Draw must be true or false'],
    [{ ...player, discardUid: ['card'] }, 'Discard must be a card id'],
    [{ ...player, count: 2 ** 60 }, 'Count must be a whole number'],
    [{ ...slayer, enemyUid: 7, replace: 1 }, 'A Nightmare target must be an enemy id'],
    [{ ...slayer, replace: 1 }, 'Replace must be true or false'],
    [{ ...slayer, choiceId: 1.5 }, 'The choice id must be a whole number'],
  ]) assertDeepEqual(parseChoiceAction(action), { status: 'invalid', error })
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const action = JSON.parse(`{"kind":"resolvePlayerChoice","choiceId":7,"${key}":true}`)
    assertEqual(parseChoiceAction(action).error, 'A card choice answer carries only draw, discardUid or count')
  }
})

check('unknown fields and legacy ids remain compatible, without validating unsupported actions', () => {
  const action = { kind: 'resolveDieRelicChoice', choiceId: -1, enemyUid: null, futureField: { kept: true } }
  assertDeepEqual(parseChoiceAction(action), { status: 'valid', action })
  assertDeepEqual(parseChoiceAction({ kind: 'resolveSlayerChoice' }), {
    status: 'valid', action: { kind: 'resolveSlayerChoice' },
  })
  assertEqual(parseChoiceAction({
    kind: 'resolvePlayerChoice', choiceId: 1, count: -1, requestId: 'ack', type: 'action', preflight: true,
  }).status, 'valid', 'legality, authorization, and stale ids remain the authoritative writer’s responsibility')
  for (const input of [null, [], {}, { kind: 'playCard' }, { kind: 'future-action' }]) {
    assertDeepEqual(parseChoiceAction(input), { status: 'unsupported' })
  }
})

check('credential schema accepts legacy extras but not malformed saved sessions', () => {
  assert(is(RoomCredentialsSchema, { code: 'ABC123', token: 'owner-token', legacy: true }))
  for (const input of [null, [], { code: 123, token: 'owner-token' }, { code: 'ABC123' }]) {
    assert(!is(RoomCredentialsSchema, input))
  }
})

check('combat field groups preserve historical first errors and recovery-format ordering', () => {
  for (const [schema, fields, error] of [
    [CardTargetsSchema, { enemyUids: null, playerIds: 1 }, 'Enemy choices must be a list of ids'],
    [CardTargetsSchema, { recoverDiscardUid: 'a', recoverDiscardUids: [], recoverExhaustUid: 2 },
      'Discard recovery must use one choice format'],
    [CardTargetsSchema, { recoverDiscardUid: 'a', recoverDiscardUids: [2] },
      'Discard recovery must be a list of card ids'],
    [CardTargetsSchema, { recoverExhaustUid: 'a', recoverExhaustUids: [], energySpent: 0.5 },
      'Exhaust recovery must use one choice format'],
    [CardTargetsSchema, { energySpent: null, corruptedShardMode: 'bad' }, 'X Energy must be a whole number'],
    [CardTargetsSchema, { corruptedShardMode: null }, 'Corrupted Shard Mode must be attack or defense'],
    [CardCharacterChoicesSchema, { loadUids: [1], spendVigor: -1 }, 'Load choices must be a list of ids'],
    [CardCharacterChoicesSchema, { spendVigor: 2 ** 60 }, 'Vigor spend must be a non-negative whole number'],
    [CardCharacterChoicesSchema, { guardianBlockSpend: -1, guardianModeShift: 1 },
      'Guardian Block spend must be a non-negative whole number'],
    [CardCharacterChoicesSchema, { guardianModeShift: null, guardianPowerCardUid: [] },
      'Guardian Mode shift must be true or false'],
    [ChamberChoicesSchema, { recoverDiscardUid: 'a', recoverDiscardUids: [], recoverExhaustUid: 2 },
      'Exhaust recovery must be a card id'],
    [ChamberChoicesSchema, {
      recoverDiscardUid: 'a', recoverDiscardUids: [], recoverExhaustUid: 'b', recoverExhaustUids: [],
    }, 'Exhaust recovery must use one choice format'],
    [ChamberChoicesSchema, { soulburnEnemyUids: [1], energySpent: 0.5 }, 'soulburnEnemyUids must be a list of ids'],
    [ChamberChoicesSchema, { guardianPowerCardUid: false, spendVigor: -1 }, 'Power Beam must identify a Power card'],
    [PowerChoicesSchema, { scryDiscardUids: 'a', exhaustUids: null }, 'Scry choices must be a list of ids'],
    [TriggerTargetsSchema, { enemyRow: null, enemyUid: 1 }, 'Triggered ability row must be a whole number'],
    [TriggerTargetsSchema, { enemyUid: null, targetPlayerId: 1 }, 'Triggered ability enemy must be a valid id'],
    [TriggerTargetsSchema, { targetPlayerId: null }, 'Triggered ability player must be a valid id'],
    [TriggerTargetsSchema, { slimeEnemyUids: [null] }, 'Triggered Slime targets must be a list of ids'],
  ]) assertDeepEqual(parseActionFields(schema, fields), { status: 'invalid', error })
})

check('bounded combat lists retain duplicate/order semantics and never silently truncate', () => {
  for (const [schema, key] of [
    [CardTargetsSchema, 'enemyUids'], [CardTargetsSchema, 'recoverDiscardUids'],
    [CardCharacterChoicesSchema, 'slimeUids'], [ChamberChoicesSchema, 'topdeckUids'],
    [PowerChoicesSchema, 'exhaustUids'], [TriggerTargetsSchema, 'slimeEnemyUids'],
  ]) {
    const list = Array(UID_LIMIT).fill('same-id')
    const parsed = parseActionFields(schema, { [key]: list, futureField: { untouched: true } })
    assertEqual(parsed.status, 'valid')
    assertDeepEqual(parsed.fields[key], list, 'duplicates are a game-legality concern, not deduplicated here')
    assert(!Object.hasOwn(parsed.fields, 'futureField'), 'unknown fields cannot enter engine context')
    assertEqual(parseActionFields(schema, { [key]: [...list, 'extra'] }).status, 'invalid')
    for (const value of [null, 'id', [1], ['id', undefined]]) {
      assertEqual(parseActionFields(schema, { [key]: value }).status, 'invalid')
    }
    assertEqual(parseActionFields(schema, {}).status, 'valid')
    assertEqual(parseActionFields(schema, { [key]: undefined }).status, 'valid')
  }
  assertEqual(parseActionFields(CardTargetsSchema, { energySpent: 2 ** 60 }).status, 'valid',
    'X Energy historically requires an integer, not a safe integer or a nonnegative amount')
})

check('context normalization preserves distinct hand, Chamber, Power and Potion policies', () => {
  const raw = {
    enemyUid: 17, playerId: false, switchWithPlayerId: 0, mode: '1',
    guardianModeShift: 'true', secondGuardianModeShift: true, spendMiracle: 1,
    scryToHandUid: null, metamorphosisPowerUid: 'power', evil: 'must not forward',
  }
  const fields = { loadUids: ['a', 'a'], energySpent: 2 }
  const contextual = { discardUids: [], exhaustUids: [], shivEnemyUids: ['enemy'] }
  const hand = cardPlayContext(raw, 'owner', fields, contextual)
  const chamber = cardPlayContext(raw, 'owner', fields, contextual, true)
  assertEqual(hand.enemyUid, 17)
  assertEqual(hand.playerId, false)
  assertEqual(hand.mode, '1')
  assertEqual(chamber.enemyUid, null)
  assertEqual(chamber.playerId, 'owner')
  assertEqual(chamber.switchWithPlayerId, null)
  assertEqual(chamber.mode, undefined)
  for (const context of [hand, chamber]) {
    assertEqual(context.guardianModeShift, false)
    assertEqual(context.secondGuardianModeShift, true)
    assertEqual(context.spendMiracle, false)
    assertEqual(context.scryToHandUid, undefined)
    assertEqual(context.metamorphosisPowerUid, 'power')
    assertDeepEqual(context.loadUids, ['a', 'a'])
    assertDeepEqual(context.shivEnemyUids, ['enemy'])
    assert(!Object.hasOwn(context, 'evil'))
  }
  assertDeepEqual(slotList(['length', '__proto__', -1, 0, 1.5]), [-1, -1, -1, 0, -1])
  assertDeepEqual(targetList([null, 'a', 2]), [null, 'a', ''])
  assertEqual(slotList(Array(UID_LIMIT + 1).fill(0)).length, UID_LIMIT)
  const power = powerContext({ ...raw, enemyRow: '1', orbSlots: ['length', 0] }, fields)
  assertEqual(power.enemyRow, null)
  assertEqual(power.playerId, null)
  assertDeepEqual(power.orbSlots, [-1, 0])
  const potion = potionContext({
    ...raw, targetPlayerId: false, die: 0.5, recoverDiscardUid: null,
    exhaustUids: [...Array(UID_LIMIT + 1).fill('a'), false],
  }, ['enemy'])
  assertEqual(potion.targetPlayerId, false)
  assertEqual(potion.die, undefined)
  assertEqual(potion.recoverDiscardUid, undefined)
  assertEqual(potion.exhaustUids.length, UID_LIMIT + 1, 'Potion choices are filtered, not capped')
})

function fixture() {
  const room = createRoom(createStore(), { code: 'PROTOC' })
  const a = joinRoom(room, { name: 'Owner', character: 'ironclad' })
  const b = joinRoom(room, { name: 'Peer', character: 'silent' })
  startRun(room, a.token, { seed: 31 })
  const player = room.run.players[0]
  player.deck = [
    { uid: 'private-z', defId: 'strike_ironclad', upgraded: false },
    { uid: 'private-a', defId: 'defend_ironclad', upgraded: false },
  ]
  player.draw = [...player.deck]
  player.hand = [player.deck[0]]
  player.relics = [{
    defId: 'burning_blood', spent: false,
    pendingRewardDraws: ['private-reward'], pendingRewardIndices: [5], guardianGemGroups: [['private-gem']],
  }]
  player.futureSecret = 'never publish new engine fields'
  return { room, a, b, player }
}

check('typed player projection is an allowlist and never exposes draw order or peer private cards', () => {
  const { player, a, b } = fixture()
  const before = structuredClone(player)
  const mine = redactPlayer(player, a.playerId)
  const peer = redactPlayer(player, b.playerId)
  assertDeepEqual(mine.draw.map((card) => card.uid), ['private-a', 'private-z'])
  assertDeepEqual(mine.hand, player.hand)
  assertEqual(peer.deck, null)
  assertEqual(peer.draw, null)
  assertEqual(peer.hand, null)
  assertEqual(peer.deckCount, 2)
  assert(!JSON.stringify(peer).includes('private-'))
  for (const view of [mine, peer]) {
    assert(!Object.hasOwn(view, 'futureSecret'))
    assert(!Object.hasOwn(view, 'cardRewards'))
    assert(!Object.hasOwn(view, 'rareRewards'))
  }
  assertDeepEqual(player, before, 'projection must not reorder or mutate the authoritative player')
})

check('legacy optional player fields keep established wire defaults, not invented engine state', () => {
  const { player, a } = fixture()
  delete player.chamber
  delete player.chamberSlots
  delete player.heat
  delete player.damageStats
  const view = redactPlayer(player, a.playerId)
  assertDeepEqual(view.chamber, [])
  assertEqual(view.chamberCount, 0)
  assertEqual(view.heat, 0)
  assertEqual(view.damageStats, undefined)
  assert(!Object.hasOwn(view, 'discardedThisTurn'))
})

check('room snapshots use the extracted run and combat projections for each viewer', () => {
  const { room, a, b } = fixture()
  room.run.phase = 'combat'
  room.run.combat = createCombat(createRng(7), room.run.players, [])
  room.run.combat.pendingDistilled = { playerId: a.playerId, cards: room.run.players[0].deck }
  const before = structuredClone(room)
  for (const seat of [a, b]) {
    const snapshot = snapshotFor(room, seat.token)
    assertDeepEqual(snapshot.run, redactRun(room.run, seat.playerId, room))
    assertDeepEqual(snapshot.run.combat, redactCombat(room.run.combat, seat.playerId))
    assert(!Object.hasOwn(snapshot.run.combat, 'rng'))
  }
  assertEqual(redactCombat(room.run.combat, b.playerId).pendingDistilled.cards, null)
  assertDeepEqual(room.run, before.run)
})

report('room protocol')
