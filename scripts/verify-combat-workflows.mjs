import assert from 'node:assert/strict'
import { completedActionOutcome, transitionAction, unknownActionDecision } from '../src/ui/combat-screen/action-lifecycle.ts'
import { resyncCombatOnSuccess } from '../src/ui/combat-screen/combat-resync.ts'
import { deliverAction } from '../src/ui/combat-screen/action-delivery.ts'
import { cardSubmissionCommitted, potionSubmissionCommitted, powerSubmissionCommitted } from '../src/ui/combat-screen/action-evidence.ts'
import { transitionPotionSelection } from '../src/ui/combat-screen/potion-selection.ts'
import { powerSelectionValues, transitionPowerSelection } from '../src/ui/combat-screen/power-selection.ts'
import { powerAbilityKey } from '../src/game/combat.ts'

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
assert.deepEqual(restored.load, ['hand'])
assert.deepEqual(restored.scry.discarded, ['a'])
assert.equal(restored.scry.kind, 'confirmed')
const withoutPreview = transitionPowerSelection(idle, {
  type: 'restore', powerUid: 'gem-finder', context: {}, chamber: [], hand: [], confirmed: true,
})
assert.equal(withoutPreview.scry.kind, 'none', 'missing or mismatched private preview is never fabricated')
console.log('✓ combat workflows: selection/reset, stale replies, local render locks, causal unknown reconciliation and exact evidence')
