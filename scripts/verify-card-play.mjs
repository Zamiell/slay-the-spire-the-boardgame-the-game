import assert from 'node:assert/strict'
import { createCardPlayCoordinator, describeCardPickup } from '../src/ui/combat-screen/card-play.ts'
import { pendingFor } from '../src/ui/combat-screen/card-play-requirements.ts'
import { createCombat, lightningRowTarget, playCard, slimeCommandEnemyChoiceCount } from '../src/game/combat.ts'
import { cardDef, faceOf } from '../src/game/cards.ts'
import { createPlayer } from '../src/game/run.ts'
import { createRng } from '../src/game/rng.ts'
import { bruiserSlime } from '../src/game/downfall/slime-boss.ts'

const rng = createRng(47)
const player = createPlayer(rng, 'p1', 'Ironclad', 'ironclad', 0)
const state = createCombat(rng, [player], [{
  uid: 'enemy', defId: 'jaw_worm', row: 0, hp: 30, maxHp: 30, block: 0,
  strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false, dead: false,
}])
const viewer = state.players[0]
viewer.energy = 9
const card = (defId, extra = {}) => ({ uid: defId, defId, upgraded: false, ...extra })
let pending = null
let commits = []
let actions = []
const options = {
  state, viewer, stateRef: { current: state }, cardActionPending: { current: false },
  pending, miracleOnCard: false, blocked: false, survivorDiscard: false,
  setUsingCard() {}, setPending(next) { pending = next }, clearOtherActions() {},
  withAdjacentChoices: next => next, downfallChoicesReady: () => true,
  slimeEnemyChoicesRequired: () => 0, slayerTargetAffordable: () => true,
  hermitEnemyChoicesRequired: () => 0,
  cardContext: () => ({}), commit: next => commits.push(next),
}
for (const defId of ['dual_cast', 'unload', 'blade_dance', 'carve_reality']) {
  const local = structuredClone(state)
  local.phase = 'player'
  local.enemies[0].row = 1
  local.players.push(createPlayer(createRng(48), 'p2', 'Defect', 'defect', 1))
  const actor = local.players[0]
  actor.hand = [card(defId)]
  actor.powers = [card('electrodynamics')]
  actor.orbs = ['lightning', null, null]
  actor.shivs = defId === 'blade_dance' ? 5 : 2
  let submitted
  let staged
  const context = next => ({
    enemyUid: next.enemyUid, playerId: next.playerId, mode: next.mode ?? undefined,
    evokeSlots: next.evokeSlots, evokeEnemyUids: next.evokeEnemyUids,
    shivEnemyUids: next.shivEnemyUids, enemyUids: next.enemyUids,
  })
  const coordinator = createCardPlayCoordinator({ ...options, state: local, viewer: actor,
    stateRef: { current: local }, cardContext: context, setPending: next => { staged = next },
    commit: next => { submitted = next } })
  const outcome = coordinator.confirm(actor.hand[0], 'hand')
  if (defId === 'carve_reality') {
    assert.equal(outcome, 'choosing', 'a sole enemy must not select a card mode')
    assert.equal(coordinator.choose({ ...staged, mode: 1, enemyChoices: 2 }), 'choosing')
    assert.deepEqual(staged.enemyUids, [], 'distinct attacks cannot reuse the same enemy')
  } else if (defId === 'blade_dance') {
    assert.equal(outcome, 'choosing', 'overflow Shiv attacks remain optional')
    assert.deepEqual(staged.shivEnemyUids, [])
  } else {
    assert.equal(outcome, 'submitted', `${defId}: mandatory repeated targets should be automatic`)
    if (defId === 'dual_cast') assert.deepEqual(submitted.evokeEnemyUids,
      [lightningRowTarget(1), lightningRowTarget(1)], 'Lightning must not target an empty player row')
    else assert.deepEqual(submitted.shivEnemyUids, ['enemy', 'enemy'])
    const played = playCard(local, actor.id, defId, context(submitted))
    assert.notEqual(played, local, `${defId}: automatic choices must be accepted by the engine`)
    assert(played.enemies[0].hp < local.enemies[0].hp)
  }
}
for (const defId of ['defend_ironclad', 'shrug_it_off', 'survivor', 'inflame', 'whirlwind']) {
  viewer.hand = [card(defId)]
  const before = structuredClone(state)
  describeCardPickup(state, viewer, viewer.hand[0], 'hand')
  assert.deepEqual(state, before, `${defId}: pickup planning mutated gameplay`)
}
viewer.hand = [card('defend_ironclad')]
assert.equal(createCardPlayCoordinator(options).confirm(viewer.hand[0], 'hand'), 'submitted')
assert.equal(commits.length, 1)
assert.equal(commits[0].card.uid, 'defend_ironclad')
commits = []
viewer.hand = [card('survivor'), card('strike_ironclad')]
assert.equal(createCardPlayCoordinator(options).confirm(viewer.hand[0], 'hand'), 'submitted')
assert.deepEqual(commits[0].picked, ['strike_ironclad'])
assert.equal(commits[0].choiceConfirmed, true)
commits = []
viewer.hand.push(card('defend_ironclad'))
assert.equal(createCardPlayCoordinator(options).confirm(viewer.hand[0], 'hand'), 'choosing')
assert.equal(commits.length, 0)
assert.equal(pending.choice.kind, 'discard')
const selected = { ...pending, picked: ['strike_ironclad'], choiceConfirmed: true }
assert.equal(createCardPlayCoordinator({ ...options, pending }).choose(selected), 'submitted')
assert.equal(commits.length, 1)
assert.deepEqual(commits[0].picked, ['strike_ironclad'])

for (const [defId, upgraded] of [['true_grit', false], ['sever_soul', true]]) {
  commits = []
  viewer.hand = [card(defId, { upgraded }), card('defend_ironclad')]
  assert.equal(createCardPlayCoordinator({ ...options, pending: null })
    .confirm(viewer.hand[0], 'hand', 'enemy'), 'submitted')
  assert.deepEqual(commits[0].picked, ['defend_ironclad'])
  assert.equal(commits[0].choiceConfirmed, true)
}
for (const defId of ['purity', 'concentrate']) {
  commits = []
  viewer.hand = [card(defId), card('defend_ironclad')]
  assert.equal(createCardPlayCoordinator({ ...options, pending: null }).confirm(viewer.hand[0], 'hand'), 'choosing')
  assert.equal(commits.length, 0, `${defId}: choosing none must remain possible`)
  assert.deepEqual(pending.picked, [])
}
commits = []
viewer.hand = [card('prepared')]
const onlyDrawn = card('defend_ironclad', { uid: 'newly-drawn' })
assert.equal(createCardPlayCoordinator({ ...options, pending: null })
  .choose(pendingFor(viewer.hand[0], [onlyDrawn], state, viewer)), 'submitted')
assert.deepEqual(commits[0].picked, ['newly-drawn'], 'post-draw discards must use the revealed pool')
commits = []
viewer.hand = [card('defend_ironclad')]
const copied = { ...pendingFor(card('sever_soul'), null, state, viewer, false), enemyUid: 'enemy' }
assert.equal(createCardPlayCoordinator({ ...options, pending: null }).choose(copied), 'submitted')
assert.deepEqual(commits[0].picked, ['defend_ironclad'], 'a copy must not exclude an unrelated hand card')

commits = []
viewer.hand = [card('whirlwind')]
assert.equal(createCardPlayCoordinator(options).confirm(viewer.hand[0], 'hand'), 'choosing')
assert.equal(pending.energySpent, null)
assert.equal(commits.length, 0, 'confirming pickup must still wait for an X-cost choice')
assert.equal(createCardPlayCoordinator({ ...options, pending }).choose({
  ...pending, energySpent: 2, energyCharged: 2, effectEnergy: 2,
}), 'submitted', 'after choosing X, the sole enemy should be selected automatically')
assert.equal(commits[0].energySpent, 2)
assert.equal(commits[0].enemyUid, 'enemy')

viewer.hand = [card('prepared'), card('strike_ironclad')]
const online = createCardPlayCoordinator({ ...options, pending: null,
  onAction: async action => { actions.push(action); return { status: 'refused' } },
})
describeCardPickup(state, viewer, viewer.hand[0], 'hand')
assert.equal(actions.length, 0, 'pickup must not request private cards')
assert.equal(online.confirm(viewer.hand[0], 'hand'), 'choosing')
assert.equal(actions[0].kind, 'previewCard')
assert.equal(options.cardActionPending.current, true)
online.confirm(viewer.hand[0], 'hand')
assert.equal(actions.length, 1, 'a pending preview must not be sent twice')
await Promise.resolve()
assert.equal(options.cardActionPending.current, false)
const revealed = { ...pendingFor(viewer.hand[0], [viewer.hand[1]], state, viewer),
  choice: { kind: 'discard', amount: 1 } }
pending = revealed
assert.equal(createCardPlayCoordinator({ ...options, pending }).cancel(), 'choosing')
assert.equal(pending, revealed, 'revealing private cards must prevent cancellation')

viewer.hand = [card('sever_soul'), card('defend_ironclad')]
state.startTurnProgress = { choices: [], forcedCard: {
  playerId: viewer.id, cardUid: 'sever_soul', sourceCardId: 'havoc', exhaustNonPower: true,
} }
pending = { ...pendingFor(viewer.hand[0], null, state, viewer), picked: ['defend_ironclad'], choiceConfirmed: true }
const forcedPending = pending
const forcedCoordinator = createCardPlayCoordinator({ ...options, pending })
assert.equal(forcedCoordinator.cancel(), 'choosing', 'a forced play cannot be abandoned')
assert.equal(forcedCoordinator.confirm(viewer.hand[0], 'hand'), 'choosing',
  'clicking the staged forced card must not cancel its choices')
assert.equal(pending, forcedPending)
commits = []
assert.equal(forcedCoordinator.confirm(viewer.hand[0], 'hand', 'enemy'), 'submitted',
  'dragging a staged forced card must finish targeting rather than toggle cancellation')
assert.deepEqual(commits[0].picked, ['defend_ironclad'], 'targeting must preserve the chosen Exhaust cost')
assert.equal(commits[0].enemyUid, 'enemy')
assert.equal(commits[0].energyCharged, 0)
pending = null
assert.equal(createCardPlayCoordinator({ ...options, pending }).confirm(viewer.hand[0], 'hand'), 'submitted')
assert.equal(commits.at(-1).card.uid, 'sever_soul')
assert.equal(commits.at(-1).energyCharged, 0)
state.startTurnProgress = undefined
assert.equal(createCardPlayCoordinator({ ...options, pending }).cancel(), 'cancelled')
assert.equal(pending, null, 'an ordinary uncommitted play remains cancellable')

for (const defId of ['third_eye', 'cut_through_fate', 'secret_technique']) {
  for (const network of [false, true]) {
    commits = []
    pending = null
    viewer.hand = [card(defId)]
    viewer.draw = []
    viewer.discard = [card('defend_ironclad')]
    const before = structuredClone(state)
    const coordinator = createCardPlayCoordinator({ ...options, pending: null,
      onAction: network ? async action => ({
        status: 'accepted',
        snapshot: { cardPreview: { cardUid: action.cardUid, cards: [],
          kind: defId === 'secret_technique' ? 'scryToHand' : 'scry', enemyUid: action.enemyUid } },
      }) : undefined,
    })
    coordinator.confirm(viewer.hand[0], 'hand', 'enemy')
    await Promise.resolve()
    assert.equal(commits.length, 1, `${defId}/${network}: an empty Scry must automatically continue`)
    assert.equal(commits[0].choiceConfirmed, true)
    assert.deepEqual(commits[0].picked, [])
    assert.deepEqual(state, before, 'skipping the choice must not mutate combat before commit')
  }
}
for (const defId of ['third_eye', 'secret_technique']) {
  commits = []
  viewer.hand = [card(defId)]
  viewer.draw = [card('defend_ironclad')]
  createCardPlayCoordinator({ ...options, pending: null }).confirm(viewer.hand[0], 'hand')
  assert.equal(commits.length, 0, 'even one revealed card still needs a Scry choice')
  assert.equal(pending.choiceCards.length, 1)
  assert.equal(pending.choiceConfirmed, false)
}
for (const [label, slimes, upgraded, automatic] of [
  ['sole slime', [bruiserSlime('only')], false, true],
  ['multiple slimes', [bruiserSlime('first'), bruiserSlime('second')], false, false],
  ['optional Command', [bruiserSlime('optional')], true, false],
  ['unavailable slime', [{ ...bruiserSlime('spent'),
    card: card('slime_boss_armored_slime'), commandsThisTurn: 1 }], false, false],
]) {
  commits = []
  pending = null
  viewer.hand = [card('slime_boss_lick', { upgraded })]
  viewer.slimes = slimes
  const before = structuredClone(state)
  createCardPlayCoordinator({ ...options, pending: null,
    downfallChoicesReady: next => !next.slimeChoice || next.slimeChoiceConfirmed,
  }).confirm(viewer.hand[0], 'hand')
  assert.equal(commits.length, Number(automatic), label)
  if (automatic) {
    assert.deepEqual(commits[0].slimeUids, ['only'])
    assert.equal(commits[0].slimeChoiceConfirmed, true)
  } else {
    assert.equal(pending.slimeChoiceConfirmed, false, `${label}: preserve the choice`)
    assert.deepEqual(pending.slimeUids, [])
  }
  assert.deepEqual(state, before, `${label}: automatic selection must not mutate combat`)
}
const firstEnemy = structuredClone(state.enemies[0])
for (const [label, enemies, repeated, automatic] of [
  ['sole enemy', [firstEnemy], false, true],
  ['multiple enemies', [firstEnemy, { ...firstEnemy, uid: 'other' }], false, false],
  ['sole living enemy', [{ ...firstEnemy, dead: true, hp: 0 }, { ...firstEnemy, uid: 'survivor' }], false, true],
  ['repeated Commands', [firstEnemy], true, true],
]) {
  commits = []
  pending = null
  state.enemies = enemies
  viewer.slimes = [bruiserSlime('only')]
  viewer.hand = repeated
    ? [card('slime_boss_ooze_bath'), card('slime_boss_haunting_lick'),
      card('slime_boss_haunting_lick', { uid: 'second-retain' })]
    : [card('slime_boss_lick')]
  const commandTargets = next => slimeCommandEnemyChoiceCount(
    faceOf(cardDef(next.card.defId), next.card.upgraded), state, viewer, next.slimeUids)
  const before = structuredClone(state)
  createCardPlayCoordinator({ ...options, pending: null,
    slimeEnemyChoicesRequired: commandTargets,
    downfallChoicesReady: next => next.slimeChoiceConfirmed &&
      next.slimeEnemyUids.length === commandTargets(next),
  }).confirm(viewer.hand[0], 'hand')
  assert.equal(commits.length, Number(automatic), label)
  if (automatic) {
    assert.deepEqual(commits[0].slimeEnemyUids,
      Array(repeated ? 2 : 1).fill(enemies.find(enemy => !enemy.dead).uid), label)
  } else {
    assert.deepEqual(pending.slimeEnemyUids, [], 'multiple enemies still require a target choice')
  }
  assert.deepEqual(state, before, `${label}: automatic targeting must not mutate combat`)
}
for (const stale of [false, true]) {
  const local = structuredClone(state)
  local.phase = 'player'
  const actor = local.players[0]
  actor.hand = [card('defend_ironclad')]
  actor.powers = []
  actor.slimes = []
  const current = { current: local }
  const queryPending = { current: null }
  const accepted = []
  const busy = []
  let resolveQuery
  let requests = 0
  const query = new Promise(resolve => { resolveQuery = resolve })
  const coordinator = createCardPlayCoordinator({ ...options,
    state: local, viewer: actor, stateRef: current, pending: null,
    cardActionPending: { current: false }, targetQueryPending: queryPending,
    queryTargets: () => { requests++; return query },
    setQueryBusy: value => busy.push(value), commit: next => accepted.push(next),
  })
  assert.equal(coordinator.confirm(actor.hand[0], 'hand'), 'choosing')
  assert.equal(coordinator.confirm(actor.hand[0], 'hand'), 'choosing')
  assert.equal(coordinator.cancel(), 'choosing')
  assert.equal(requests, 1, 'a pending read-only calculation must not be duplicated')
  assert.equal(accepted.length, 0)
  if (stale) current.current = structuredClone(local)
  resolveQuery({ index: 0, options: [], complete: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(accepted.length, stale ? 0 : 1, 'a retired calculation cannot commit a card')
  assert.equal(queryPending.current, null)
  assert.deepEqual(busy, [true, false])
}
console.log('PASS confirmed play coordination, private previews, cancellation, and fenced asynchronous queries')
