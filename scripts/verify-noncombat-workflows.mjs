import assert from 'node:assert/strict'
import { createPlayer } from '../src/game/run.ts'
import { createRng } from '../src/game/rng.ts'
import { campfireCards, campfireOptions, selectCampfireCard } from '../src/ui/campfire-choice.ts'
import { roomActionCommitted, sendRoomActions } from '../src/ui/actions/room-action.ts'
import { transitionAction } from '../src/ui/actions/action-lifecycle.ts'
import { sequenceActions } from '../src/ui/actions/action-delivery.ts'
import { neowDecisionKey } from '../src/ui/actions/neow-choice.ts'
import { setupStepKey } from '../src/ui/actions/setup-choice.ts'

const player = createPlayer(createRng(47), 'p1', 'Ironclad', 'ironclad', 0)
player.hp = 1
player.relics = ['peace_pipe', 'straight_razor', 'regal_pillow'].map(defId => ({ defId, spent: false }))
player.deck = [
  { uid: 'bane', defId: 'ascenders_bane', upgraded: false },
  { uid: 'curse', defId: 'injury', upgraded: false },
  { uid: 'strike', defId: 'strike_ironclad', upgraded: false },
  { uid: 'defend', defId: 'defend_ironclad', upgraded: false },
]
const local = campfireOptions(player, false, true, 'base')
const online = campfireOptions({ ...player, cardRewards: undefined, rareRewards: undefined,
  campfireTransformAvailable: true }, false, true, 'base')
assert.deepEqual(online, local, 'local and projected players must use the same campfire rules')
assert.equal(local.restHeal, 6)
const removed = selectCampfireCard({ choice: 'rest', transformCardUid: 'strike' }, 'remove', 'strike')
assert.equal(removed.transformCardUid, undefined, 'removing a card invalidates its Transform selection')
assert.deepEqual(campfireCards(player.deck, 'remove', removed).map(card => card.uid), ['curse', 'strike', 'defend'])
assert.deepEqual(campfireCards(player.deck, 'transform', removed).map(card => card.uid), ['defend'])
assert.equal(selectCampfireCard(removed, 'remove', 'strike').removeCardUid, undefined)
assert.equal(selectCampfireCard(removed, 'remove').removeCardUid, undefined)
assert.deepEqual(selectCampfireCard({ choice: 'rest', removeCardUid: 'curse' }, 'upgrade', 'strike'),
  { choice: 'smith', cardUid: 'strike' }, 'Smith must not retain an earlier Rest payment')
player.relics = ['coffee_dripper', 'fusion_hammer'].map(defId => ({ defId, spent: false }))
const blocked = campfireOptions(player, true, true, 'base')
assert(blocked.rubyDeclineOnly && blocked.needsDecision && !blocked.restAvailable)
assert.equal(campfireOptions(player, false, true, 'base').needsDecision, false)

const before = { you: { playerId: 'p1' }, campfireDecided: [], run: {
  phase: 'reward', map: { position: 'room-1' },
  rewards: [{ playerId: 'p1', gold: 8, potion: 'weak_potion', potionQueue: ['weak_potion'],
    cardReward: true, choices: null }],
} }
const submission = { before, actions: [{ kind: 'potionReward', choice: 'gain' }] }
assert(!roomActionCommitted(submission, structuredClone(before)), 'unrelated snapshots are not payment evidence')
const nextPotion = structuredClone(before)
nextPotion.run.rewards[0].potionQueue = []
assert(roomActionCommitted(submission, nextPotion), 'a second identical Potion must not strand the first claim')
const batch = { before, actions: [{ kind: 'goldReward', gain: false }, { kind: 'cardReward', choice: null }] }
const partial = structuredClone(before)
partial.run.rewards[0].gold = false
assert(!roomActionCommitted(batch, partial), 'partial batch completion is not full completion')
partial.run.rewards[0].cardReward = false
assert(roomActionCommitted(batch, partial))
const campfireBefore = { ...before, run: { ...before.run, phase: 'room' } }
const campfire = { before: campfireBefore, actions: [{ kind: 'campfire', choices: { p1: { choice: 'rest' } } }] }
assert(!roomActionCommitted(campfire, campfireBefore))
assert(roomActionCommitted(campfire, { ...campfireBefore, campfireDecided: ['p1'] }))

const pending = transitionAction({ kind: 'idle' }, {
  type: 'start', id: 1, mode: 'online', board: before, payload: batch, awaitCommit: true,
}).state
const accepted = transitionAction(pending, {
  type: 'reply', id: 1, outcome: { status: 'accepted' }, latestRefresh: 5,
}).state
assert.equal(accepted.kind, 'accepted', 'acknowledgement must not enable an old rendered offer')
assert.equal(transitionAction(accepted, {
  type: 'observe', board: before, committed: false, latestRefresh: 5,
}).state, accepted)
assert.equal(transitionAction(accepted, {
  type: 'observe', board: partial, committed: true, latestRefresh: 5,
}).state.kind, 'idle')
assert.equal(transitionAction(accepted, {
  type: 'observe', board: before, committed: false, latestRefresh: 6,
}).resolution.committed, false, 'a successful later refresh can resolve an accepted no-op')
const receipt = transitionAction(pending, {
  type: 'reply', id: 1, outcome: { status: 'accepted' }, commitVersion: 12,
}).state
assert.equal(transitionAction(receipt, {
  type: 'observe', board: partial, committed: true, version: 11,
}).state, receipt, 'an earlier frame cannot satisfy the acknowledged transaction version')
assert.equal(transitionAction(receipt, {
  type: 'observe', board: before, committed: false, version: 12,
}).state.kind, 'idle', 'an acknowledged no-op or identical next reward settles once its snapshot is rendered')

for (const status of ['refused', 'reconciled', 'unknown']) {
  const sent = []
  const outcome = await sendRoomActions(batch.actions, async action => {
    sent.push(action)
    return { status }
  }, () => true)
  assert.equal(outcome.status, status)
  assert.equal(sent.length, 1, 'a batch must stop instead of continuing after non-acceptance')
}
let calls = 0
await sendRoomActions(batch.actions, async () => { calls++; return { status: 'accepted' } }, () => calls === 0)
assert.equal(calls, 1, 'scope changes cancel unsent actions, not just stale response handling')
const failure = new Error('delivery uncertain')
await assert.rejects(sendRoomActions(batch.actions, async () => { throw failure }, () => true), error => error === failure)
const localSequence = []
sequenceActions([() => { localSequence.push('choice') }, () => { localSequence.push('resolve') }], () => true)
assert.deepEqual(localSequence, ['choice', 'resolve'], 'local state updaters retain their synchronous ordering')
for (const status of ['unknown', 'refused', 'reconciled']) {
  const steps = []
  await sequenceActions([async () => { steps.push('choice'); return { status } },
    () => { steps.push('resolve') }], () => true)
  assert.deepEqual(steps, ['choice'], 'unconfirmed relic choices must not trigger dependent mutations')
}
assert.throws(() => sequenceActions([() => { throw failure }], () => true), error => error === failure)
const progress = { redRewardPending: true, redReward: null, blueOption: null, pendingEffect: null,
  rewardKind: null, reward: null, done: false }
assert.equal(neowDecisionKey(progress), neowDecisionKey({ ...progress, availableSources: ['silent'] }))
assert.notEqual(neowDecisionKey(progress), neowDecisionKey({ ...progress, redRewardPending: false }))
const setup = { rowIndex: 1, repeatIndex: 0, playerIndex: 0, die: null }
assert.notEqual(setupStepKey(setup), setupStepKey({ ...setup, repeatIndex: 1 }))
console.log('PASS noncombat workflows: campfire parity, accepted/unknown evidence, and partial-batch safety')
