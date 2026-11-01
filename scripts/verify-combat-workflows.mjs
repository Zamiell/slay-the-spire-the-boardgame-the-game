import assert from 'node:assert/strict'
import { completedActionOutcome, transitionAction, unknownActionDecision } from '../src/ui/actions/action-lifecycle.ts'
import { resyncCombatOnSuccess } from '../src/ui/combat-screen/combat-resync.ts'
import { deliverAction } from '../src/ui/actions/action-delivery.ts'
import { cardSubmissionCommitted, potionSubmissionCommitted, powerSubmissionCommitted, relicSubmissionCommitted } from '../src/ui/combat-screen/action-evidence.ts'
import { transitionPotionSelection } from '../src/ui/combat-screen/potion-selection.ts'
import { powerActivationChoice, powerSelectionValues, reconcilePowerSelection, restorePowerSelection, transitionPowerSelection } from '../src/ui/combat-screen/power-selection.ts'
import { reconcileRelicSelection, relicUsable, restoreRelicSelection, toggleRelicCard } from '../src/ui/combat-screen/relic-selection.ts'
import { selectionForScope, updateScopedSelection } from '../src/ui/combat-screen/selection-scope.ts'
import { activateRelic, createCombat, powerAbilityKey } from '../src/game/combat.ts'
import { createPlayer } from '../src/game/run.ts'
import { createRng } from '../src/game/rng.ts'
import { relicDef } from '../src/game/relics.ts'

const idle = { kind: 'idle' }
const board = { revision: 1 }
const payload = { potionId: 'fire_potion', countBefore: 2 }
const start = (id = 1, mode = 'online') => transitionAction(idle, {
  type: 'start', id, mode, board, payload,
}).state
const observe = (state, latestRefresh, committed = false, rendered = board) =>
  transitionAction(state, { type: 'observe', board: rendered, latestRefresh, committed })
const reply = (state, outcome, id = 1, latestRefresh = 5) =>
  transitionAction(state, { type: 'reply', id, outcome, latestRefresh })

const pending = start()
assert.equal(transitionAction(pending, { type: 'start', id: 2, mode: 'online', board, payload }).state, pending)
assert.equal(reply(pending, { status: 'accepted' }, 99).state, pending, 'stale replies cannot release a newer lock')
assert.equal(observe(pending, 9, true).state, pending, 'online requests must still receive their outcome')
for (const status of ['accepted', 'refused', 'reconciled']) {
  const result = reply(pending, { status })
  assert.equal(result.state.kind, 'idle')
  assert.deepEqual(result.resolution, { kind: 'outcome', payload, outcome: { status } })
  assert.equal(reply(result.state, { status }).resolution, undefined, 'settle only once')
}

const fulfilledVoid = reply(pending, completedActionOutcome(undefined))
assert.equal(fulfilledVoid.state.kind, 'idle', 'legacy successful fire-and-forget callbacks acknowledge completion')
assert.equal(fulfilledVoid.resolution.outcome.status, 'accepted')
const acceptedWithSnapshot = { status: 'accepted', snapshot: { version: 3 } }
assert.equal(completedActionOutcome(acceptedWithSnapshot), acceptedWithSnapshot)
const failed = transitionAction(pending, { type: 'failed', id: 1, latestRefresh: 5 })
assert.equal(failed.resolution, undefined, 'a rejected callback is not a successful void completion')
let delivered
let failedDeliveries = 0
const receiveDelivery = outcome => { delivered = reply(pending, outcome) }
const failDelivery = () => {
  failedDeliveries++
  delivered = transitionAction(pending, { type: 'failed', id: 1, latestRefresh: 5 })
}
await deliverAction(() => {}, receiveDelivery, failDelivery)
assert.equal(delivered.resolution.outcome.status, 'accepted', 'synchronous void remains successful')
await deliverAction(async () => {}, receiveDelivery, failDelivery)
assert.equal(delivered.resolution.outcome.status, 'accepted', 'fulfilled Promise<void> remains successful')
assert.equal(failedDeliveries, 0)
await deliverAction(() => Promise.reject(new Error('offline')), receiveDelivery, failDelivery)
assert.equal(failedDeliveries, 1)
assert.equal(delivered.state.kind, 'unknown', 'rejected Promise<void> does not acknowledge success')
const synchronousError = new Error('send threw after possible delivery')
assert.throws(() => deliverAction(() => { throw synchronousError }, receiveDelivery, failDelivery),
  error => error === synchronousError, 'synchronous exceptions must remain visible to the caller')
assert.equal(failedDeliveries, 2)
assert.equal(delivered.state.kind, 'unknown', 'surfacing the error must not permit retry of an uncertain action')
for (const unknown of [failed.state, reply(pending, { status: 'unknown' }).state]) {
  assert.equal(unknown.kind, 'unknown')
  for (const refresh of [undefined, 4, 5]) assert.equal(observe(unknown, refresh).state, unknown)
  assert.deepEqual(observe(unknown, 6).resolution, { kind: 'reconciled', payload, committed: false })
  assert.deepEqual(observe(unknown, 5, true).resolution, { kind: 'reconciled', payload, committed: true })
  assert.equal(reply(unknown, { status: 'accepted' }).state, unknown, 'late duplicate replies do not decide delivery')
}
const earlyRefresh = reply(pending, { status: 'unknown', refreshAttempt: 4 }, 1, 5).state
assert.equal(observe(earlyRefresh, 5).resolution.committed, false, 'refresh-before-callback also restores immediately')
const noRefresh = transitionAction(pending, {
  type: 'reply', id: 1, outcome: { status: 'unknown' },
}).state
assert.equal(observe(noRefresh, 100).state, noRefresh, 'without a causal baseline refresh alone proves nothing')
assert.equal(observe(noRefresh, undefined, true).resolution.committed, true)
assert.equal(unknownActionDecision(false, undefined, 100), 'wait')

const local = start(1, 'local')
assert.equal(observe(local, undefined).state, local, 'local lock survives React state updates on the old board')
assert.equal(reply(local, { status: 'accepted' }).state, local)
assert.deepEqual(observe(local, undefined, false, { revision: 2 }).resolution, { kind: 'local', payload })
const reset = transitionAction(pending, { type: 'reset' }).state
assert.equal(reply(reset, { status: 'accepted' }).resolution, undefined)
assert.equal(reply(start(2), { status: 'refused' }).resolution, undefined, 'old scope reply cannot restore a new draft')
assert.equal(transitionAction(start(2), { type: 'failed', id: 1 }).resolution, undefined)

let remountGeneration = 0
let lockedAction = failed.state
const resetAfterResync = () => {
  remountGeneration++
  lockedAction = transitionAction(lockedAction, { type: 'reset' }).state
}
await resyncCombatOnSuccess(async () => false, resetAfterResync)
assert.equal(remountGeneration, 0, 'failed or superseded resync must not remount CombatScreen')
assert.equal(lockedAction, failed.state, 'failed refresh keeps the exact unknown action locked')
await assert.rejects(resyncCombatOnSuccess(async () => { throw new Error('offline') }, resetAfterResync), /offline/)
assert.equal(remountGeneration, 0)
assert.equal(lockedAction, failed.state)
let completeRefresh
const refreshInFlight = resyncCombatOnSuccess(() => new Promise(resolve => { completeRefresh = resolve }), resetAfterResync)
assert.equal(remountGeneration, 0, 'requesting a reset does not unlock before refresh succeeds')
completeRefresh(true)
await refreshInFlight
assert.equal(remountGeneration, 1)
assert.equal(lockedAction.kind, 'idle')

const combat = {
  players: [{ id: 'me', potions: ['fire_potion', 'fire_potion', 'block_potion'],
    hand: [{ uid: 'hand' }], chamber: [{ uid: 'chamber' }] }],
  powerTriggersUsedThisTurn: [powerAbilityKey('other', 'power')],
  pendingCardCopy: { id: 2, card: { uid: 'copy' } },
}
assert.equal(potionSubmissionCommitted(payload, combat, 'me'), false)
const lostOtherPotion = { ...combat, players: [{ ...combat.players[0], potions: ['fire_potion', 'fire_potion'] }] }
assert.equal(potionSubmissionCommitted(payload, lostOtherPotion, 'me'), false, 'total inventory size is not commit evidence')
assert.equal(potionSubmissionCommitted(payload, {
  ...combat, players: [{ ...combat.players[0], potions: ['fire_potion', 'block_potion'] }],
}, 'me'), true, 'one of two identical potions was consumed')
assert.equal(potionSubmissionCommitted(payload, combat, 'missing'), false)
assert.equal(powerSubmissionCommitted({ powerUid: 'power' }, combat, 'me'), false)
assert.equal(powerSubmissionCommitted({ powerUid: 'power' }, {
  ...combat, powerTriggersUsedThisTurn: [powerAbilityKey('me', 'power')],
}, 'me'), true)
for (const source of ['hand', 'chamber']) {
  assert.equal(cardSubmissionCommitted({ source, cardUid: source }, combat, 'me'), false)
  assert.equal(cardSubmissionCommitted({ source, cardUid: 'removed' }, combat, 'me'), true)
  assert.equal(cardSubmissionCommitted({ source, cardUid: source }, combat, 'missing'), false)
}
assert.equal(cardSubmissionCommitted({ source: 'copy', cardUid: 'copy', copyId: 2 }, combat, 'me'), false)
assert.equal(cardSubmissionCommitted({ source: 'copy', cardUid: 'copy', copyId: 1 }, combat, 'me'), true,
  'another copy of the same card is a different operation')

const stage = (potionId, overflow = 0) => transitionPotionSelection(idle, { type: 'stage', potionId, overflow })
let potion = stage('purity_potion')
for (const uid of ['a', 'b', 'c', 'd']) potion = transitionPotionSelection(potion, { type: 'toggleCard', uid })
assert.deepEqual(potion.picked, ['a', 'b', 'c'])
potion = transitionPotionSelection(potion, { type: 'toggleCard', uid: 'b' })
assert.deepEqual(potion.picked, ['a', 'c'])
const refreshPotion = (state, overflow, usable = true) => transitionPotionSelection(state, {
  type: 'refresh', usable, overflow, alive: new Set(['live']), cards: new Set(['c']),
})
assert.deepEqual(refreshPotion(potion, 0).picked, ['c'], 'remove cards taken by another action')
assert.deepEqual(transitionPotionSelection(potion, { type: 'cancel' }), idle)
assert.deepEqual(stage('fire_potion'), { kind: 'target', potionId: 'fire_potion' })
assert.equal(transitionPotionSelection(idle, { type: 'toggleCard', uid: 'a' }), idle)
let overflow = stage('cunning_potion', 3)
overflow = transitionPotionSelection(overflow, { type: 'targets', targets: ['dead', 'live', 'live'] })
assert.deepEqual(refreshPotion(overflow, 3).targets, ['live', 'live'], 'repeated living targets remain valid')
assert.deepEqual(refreshPotion(overflow, 2).targets, [], 'overflow count change restarts the entire sequence')
assert.deepEqual(refreshPotion(overflow, 0), idle)
assert.deepEqual(refreshPotion(overflow, 3, false), idle)
assert.equal(transitionPotionSelection(potion, { type: 'stage', potionId: 'fire_potion', overflow: 0 }).picked, undefined)

let power = transitionPowerSelection(idle, { type: 'select', powerUid: 'gem-finder' })
assert.equal(transitionPowerSelection(power, { type: 'confirmScry', confirmed: true }).scry.kind, 'none')
power = transitionPowerSelection(power, { type: 'preview', powerUid: 'gem-finder', cards: [{ uid: 'a' }, { uid: 'b' }] })
power = transitionPowerSelection(power, { type: 'toggleScry', uid: 'a' })
power = transitionPowerSelection(power, { type: 'gemContext', context: { enemyUid: 'enemy' } })
power = transitionPowerSelection(power, { type: 'confirmScry', confirmed: true })
assert.equal(powerSelectionValues(power).powerScryConfirmed, true)
assert.equal(transitionPowerSelection(power, { type: 'toggleScry', uid: 'missing' }), power)
assert.deepEqual(transitionPowerSelection(power, { type: 'cancel' }), idle)
assert.equal(transitionPowerSelection(idle, { type: 'gemContext', context: {} }), idle)
const different = transitionPowerSelection(power, { type: 'select', powerUid: 'another' })
assert.equal(powerSelectionValues(different).powerChoiceCards, null, 'switching powers clears all private choices')
assert.equal(powerSelectionValues(different).powerGemContext, null)
const restored = transitionPowerSelection(idle, {
  type: 'restore', powerUid: 'gem-finder', context: {
    chamberUids: ['held', 'gone'], loadUids: ['hand', 'gone'], scryDiscardUids: ['a', 'gone'],
  }, chamber: ['held'], hand: ['hand'], cards: [{ uid: 'a' }], confirmed: true,
})
assert.deepEqual(restored.chamber, ['held'])
assert.deepEqual(restored.load, [], 'a missing Chamber choice invalidates the dependent Load choice')
assert.deepEqual(restored.scry.discarded, ['a'])
assert.equal(restored.scry.kind, 'confirmed')
const withoutPreview = transitionPowerSelection(idle, {
  type: 'restore', powerUid: 'gem-finder', context: {}, chamber: [], hand: [], confirmed: true,
})
assert.equal(withoutPreview.scry.kind, 'none', 'missing or mismatched private preview is never fabricated')

const rng = createRng(37)
const workflowBoard = createCombat(rng, [createPlayer(rng, 'me', 'Guardian', 'guardian', 0)], [{
  uid: 'enemy', defId: 'jaw_worm', row: 0, hp: 30, maxHp: 30, block: 0,
  strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false, dead: false,
}])
workflowBoard.phase = 'player'
const actor = workflowBoard.players[0]
const instance = (defId, extra = {}) => ({ uid: defId, defId, upgraded: false, ...extra })
actor.hand = [instance('guardian_strike', { uid: 'strike_guardian' }), instance('guardian_defend', { uid: 'defend_guardian' })]
actor.chamber = [instance('hermit_grudge')]
actor.powers = [instance('guardian_gem_finder', { attachedGemId: 'guardian_jasper' }),
  instance('hermit_black_wind'), instance('slayer_creative_ai'), instance('slayer_master_reality')]
actor.orbs = ['lightning', null, 'frost']
actor.discard = [instance('strike_ironclad')]
actor.relics = [{ defId: 'blue_candle' }, { defId: 'golden_eye' }, { defId: 'ninja_scroll' }, { defId: 'holy_water', cubes: 2 },
  { defId: 'fuel_canister' }]
actor.draw = [instance('guardian_ruby'), instance('guardian_defend', { uid: 'revealed' })]
assert.equal(powerActivationChoice(workflowBoard, 'me', 'guardian_gem_finder'), 'preview')
assert.equal(powerActivationChoice(workflowBoard, 'me', 'hermit_black_wind'), 'select')
assert.equal(powerActivationChoice(workflowBoard, 'me', 'slayer_creative_ai'), 'select')
assert.equal(powerActivationChoice(workflowBoard, 'me', 'slayer_master_reality'), 'submit')
assert.equal(powerActivationChoice({
  ...workflowBoard, players: [{ ...actor, discard: [] }],
}, 'me', 'slayer_creative_ai'), 'blocked')
assert.equal(powerActivationChoice({
  ...workflowBoard, players: [{ ...actor, orbs: [null, null, null] }],
}, 'me', 'slayer_creative_ai'), 'blocked')

const reveal = { id: 8, powerUid: 'guardian_gem_finder', kind: 'scry', cards: actor.draw }
const gemSubmission = { powerUid: reveal.powerUid, powerPreviewId: reveal.id, context: {
  enemyUid: 'gone', exhaustUids: ['strike_guardian', 'gone'], scryDiscardUids: ['revealed', 'unseen'],
} }
const restoredGem = restorePowerSelection(gemSubmission, workflowBoard, 'me', reveal, true)
assert.deepEqual(restoredGem.exhaust, ['strike_guardian'])
assert.deepEqual(restoredGem.scry.discarded, ['revealed'])
assert.equal(restoredGem.scry.context, null, 'dead targets and lost Jasper cards must be chosen again')
assert.equal(restoredGem.scry.kind, 'confirmed', 'the already confirmed reveal remains confirmed while reselecting a Gem effect')
for (const preview of [undefined, { ...reveal, id: 7 }, { ...reveal, powerUid: 'other' }]) {
  assert.equal(restorePowerSelection(gemSubmission, workflowBoard, 'me', preview, true).scry.kind, 'none',
    'a draw pile in memory is never a substitute for the matching private preview')
}
assert.deepEqual(restorePowerSelection(gemSubmission, {
  ...workflowBoard, powerTriggersUsedThisTurn: [powerAbilityKey('me', reveal.powerUid)],
}, 'me', reveal, true), idle, 'committed powers must not reopen')
assert.deepEqual(restorePowerSelection(gemSubmission, {
  ...workflowBoard, startTurnProgress: { forcedCard: { cardUid: 'forced', playerId: 'me' } },
}, 'me', reveal, true), idle, 'mandatory forced plays supersede a refused power')
const restoredOrbs = restorePowerSelection({
  powerUid: 'slayer_creative_ai', context: { orbSlots: [0, 1, 2, 9] },
}, workflowBoard, 'me', undefined, false)
assert.deepEqual(restoredOrbs.orbs, [0, 2], 'restoration keeps only still-occupied Orb slots')
assert.deepEqual(reconcilePowerSelection(restoredOrbs, {
  ...workflowBoard, players: [{ ...actor, orbs: [null, null, 'frost'] }],
}, 'me').orbs, [2])
let stagedWind = transitionPowerSelection(idle, { type: 'select', powerUid: 'hermit_black_wind' })
stagedWind = transitionPowerSelection(stagedWind, { type: 'chamber', uids: ['hermit_grudge'] })
stagedWind = transitionPowerSelection(stagedWind, { type: 'load', uids: ['strike_guardian'] })
const changedChamber = reconcilePowerSelection(stagedWind, {
  ...workflowBoard, players: [{ ...actor, chamber: [] }],
}, 'me')
assert.deepEqual(changedChamber.chamber, [])
assert.deepEqual(changedChamber.load, [], 'snapshot changes cannot leave a later Hermit step without its prerequisite')

let relicCards = { kind: 'cards', relicIndex: 0, defId: 'blue_candle', picked: [] }
relicCards = toggleRelicCard(relicCards, 'strike_guardian', 2)
relicCards = toggleRelicCard(relicCards, 'defend_guardian', 2)
assert.deepEqual(toggleRelicCard(relicCards, 'third', 2).picked, relicCards.picked)
assert.deepEqual(toggleRelicCard(relicCards, 'strike_guardian', 2).picked, ['defend_guardian'])
assert.deepEqual(toggleRelicCard(relicCards, 'replacement', 1).picked, ['replacement'])
assert.deepEqual(reconcileRelicSelection(relicCards, {
  ...workflowBoard, players: [{ ...actor, hand: [actor.hand[1]] }],
}, 'me').picked, ['defend_guardian'])
assert.deepEqual(reconcileRelicSelection(relicCards, workflowBoard, 'me', false), idle,
  'post-roll locking cancels the entire choice, not only its selected cards')
assert.deepEqual(reconcileRelicSelection(relicCards, {
  ...workflowBoard, players: [{ ...actor, relics: [{ defId: 'runic_pyramid' }] }],
}, 'me'), idle, 'an index reused for another relic cannot inherit choices')

const goldenEye = activateRelic(workflowBoard, 'me', 1)
assert.notEqual(goldenEye, workflowBoard)
const scryDraft = reconcileRelicSelection(relicCards, goldenEye, 'me')
assert.equal(scryDraft.kind, 'scry')
assert.deepEqual(scryDraft.picked, [], 'Golden Eye never inherits unrelated hand choices')
const pickedScry = toggleRelicCard(scryDraft, 'revealed', 3)
assert.deepEqual(restoreRelicSelection(pickedScry, { scryDiscardUids: ['revealed', 'unseen'] },
  goldenEye, 'me').picked, ['revealed'])
assert.deepEqual(reconcileRelicSelection(pickedScry, {
  ...goldenEye, pendingRelicScry: { ...goldenEye.pendingRelicScry, id: 900 },
}, 'me').picked, [], 'a new reveal cannot inherit a prior reveal draft')
assert.deepEqual(reconcileRelicSelection(pickedScry, {
  ...goldenEye, pendingRelicScry: { ...goldenEye.pendingRelicScry, playerId: 'other', cards: null },
}, 'me'), idle, 'another seat never receives private Scry selections')

actor.shivs = 5
const ninjaDraft = { kind: 'overflow', relicIndex: 2, defId: 'ninja_scroll', required: 2,
  targets: ['gone', 'enemy', 'enemy'] }
assert.deepEqual(reconcileRelicSelection(ninjaDraft, workflowBoard, 'me').targets, ['enemy', 'enemy'])
assert.deepEqual(reconcileRelicSelection(ninjaDraft, {
  ...workflowBoard, players: [{ ...actor, shivs: 4 }],
}, 'me').targets, [], 'a changed shared Shiv capacity restarts the required sequence')
assert.deepEqual(reconcileRelicSelection(ninjaDraft, {
  ...workflowBoard, players: [{ ...actor, shivs: 0 }],
}, 'me'), idle)
const scroll = relicDef('ninja_scroll')
const printedScrollEffects = scroll.effects
try {
  for (const effects of [[{ kind: 'gainShiv', amount: 0 }],
    [{ kind: 'gainShiv', amount: 1 }, { kind: 'gainShiv', amount: 1 }]]) {
    scroll.effects = effects
    assert.deepEqual(reconcileRelicSelection(ninjaDraft, workflowBoard, 'me').targets, ['enemy', 'enemy'],
      'the shared gain calculation sums effects and preserves the original two-Shiv zero fallback')
  }
} finally {
  scroll.effects = printedScrollEffects
}

const relicSubmission = { relicIndex: 0, defId: 'blue_candle', spentBefore: false }
assert.equal(relicSubmissionCommitted(relicSubmission, workflowBoard, 'me'), false)
const candleUsed = activateRelic(workflowBoard, 'me', 0, { cardUids: ['strike_guardian'] })
assert.equal(relicSubmissionCommitted(relicSubmission, candleUsed, 'me'), true)
assert.equal(relicSubmissionCommitted({ ...relicSubmission, defId: 'fuel_canister' }, candleUsed, 'me'), false)
assert.equal(relicSubmissionCommitted({ ...relicSubmission, spentBefore: true }, candleUsed, 'me'), false)
const eyeSubmission = { relicIndex: 1, defId: 'golden_eye', spentBefore: false }
assert.equal(relicSubmissionCommitted(eyeSubmission, goldenEye, 'me'), true, 'opening Golden Eye is itself a committed action')
assert.equal(relicSubmissionCommitted({ ...eyeSubmission, scryId: goldenEye.pendingRelicScry.id }, goldenEye, 'me'), false,
  'the same open reveal does not prove its resolution')
const eyeUsed = activateRelic(goldenEye, 'me', 1, { scryDiscardUids: ['revealed'] })
assert.equal(relicSubmissionCommitted({ ...eyeSubmission, scryId: goldenEye.pendingRelicScry.id }, eyeUsed, 'me'), true)
assert.equal(relicSubmissionCommitted(eyeSubmission, {
  ...goldenEye, pendingRelicScry: { ...goldenEye.pendingRelicScry, playerId: 'other' },
}, 'me'), false)
const waterSubmission = { relicIndex: 3, defId: 'holy_water', cubesBefore: 2, spentBefore: false }
assert.equal(relicSubmissionCommitted(waterSubmission, activateRelic(workflowBoard, 'me', 3), 'me'), true,
  'repeatable Holy Water commits by cube decrement, not a spent flag')
const startBoard = { ...workflowBoard, phase: 'start', die: 1 }
assert.equal(relicUsable(startBoard, 'me', 4, false), true)
assert.equal(relicUsable(startBoard, 'me', 4, true), false)
for (const draft of [restoredGem, relicCards, stage('purity_potion')]) {
  const originalScope = 'combat-1:me'
  const stored = { scope: originalScope, value: draft }
  const uncertain = reply(start(), { status: 'unknown', refreshAttempt: 5 }).state
  assert.equal(selectionForScope(stored, originalScope, idle), stored,
    'same-scope rerenders and reconnects preserve the exact draft')
  const cancelledDraft = updateScopedSelection(stored, originalScope, () => idle)
  assert.deepEqual(cancelledDraft.value, idle)
  assert.equal(observe(uncertain, 5).state, uncertain,
    'clearing a visible draft must not release its uncertain action')
  for (const nextScope of ['combat-1:other', 'combat-2:me']) {
    const switched = selectionForScope(stored, nextScope, idle)
    assert.deepEqual(switched, { scope: nextScope, value: idle },
      'the first render of another seat or combat cannot expose private cards or reuse a relic index/potion')
    assert.equal(updateScopedSelection(switched, originalScope, () => draft), switched,
      'a previous owner cannot restore a draft into the new scope')
    const returned = selectionForScope(switched, originalScope, idle)
    assert.deepEqual(returned.value, idle, 'returning to a seat cannot resurrect its discarded draft')
    const resetAction = transitionAction(uncertain, { type: 'reset' }).state
    const nextAction = transitionAction(resetAction, {
      type: 'start', id: 2, mode: 'online', board, payload,
    }).state
    assert.equal(reply(nextAction, { status: 'refused' }, 1).state, nextAction,
      'even after returning to the same seat, an old reply cannot unlock the new operation')
  }
  assert.equal(observe(uncertain, 5, true).resolution.committed, true)
  assert.equal(observe(uncertain, 6).resolution.committed, false,
    'draft scoping does not replace causal refresh reconciliation')
}
console.log('✓ combat workflows: complete Power/relic choices, private reveals, stale drafts, causal reconciliation and exact evidence')
