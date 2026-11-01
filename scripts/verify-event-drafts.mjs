import assert from 'node:assert/strict'
import { clearEventChoice, createEventDraft, initializeEventItems, reconcileEventDraft, updateEventField } from '../src/ui/event-draft.ts'

const scopes = { event: 'p1/event-1', items: 'items-1', rewards: 'rewards-1', cardSources: 'cards-1',
  rareSources: 'rares-1', trade: 'trade-1', prepared: 'combat-1/scry-1' }
const sizes = { rewards: 2, potions: 1 }
let state = createEventDraft(scopes, sizes)
state = updateEventField(state, scopes, 'cards', ['payment-card'])
state = updateEventField(state, scopes, 'goldPaymentSelected', true)
state = updateEventField(state, scopes, 'rewardIndexes', [1, -2])
state = updateEventField(state, scopes, 'preparedScryPicked', ['scry-card'])
assert.deepEqual(state.value.cards, ['payment-card'])
assert(state.value.goldPaymentSelected, 'independent payment fields must coexist')
assert.equal(reconcileEventDraft(state, { ...scopes }, sizes), state, 'overlay replay or an unrelated refresh must preserve drafts')
state = initializeEventItems(state, scopes, ['take'])
state = updateEventField(state, scopes, 'rewardItemChoices', ['skip'])
assert.equal(initializeEventItems(state, scopes, ['take']), state, 'replayed layout initialization cannot undo an explicit Skip')

const items = { ...scopes, items: 'items-2' }
const nextItems = reconcileEventDraft(state, items, { ...sizes, potions: 2 })
assert.deepEqual(nextItems.value.cards, ['payment-card'])
assert.deepEqual(nextItems.value.rewardIndexes, [1, -2])
assert.deepEqual(nextItems.value.potionRecipientIds, ['', ''])
assert.deepEqual(nextItems.value.rewardItemChoices, [])
assert.equal(updateEventField(nextItems, scopes, 'rewardItemChoices', ['take']), nextItems,
  'an old item callback cannot answer the next reveal')

const rewards = { ...items, rewards: 'rewards-2' }
const nextRewards = reconcileEventDraft(nextItems, rewards, { rewards: 1, potions: 2 })
assert.deepEqual(nextRewards.value.rewardIndexes, [-2])
assert.deepEqual(nextRewards.value.cards, ['payment-card'])
const changedPlayer = reconcileEventDraft(nextRewards, { ...rewards, event: 'p2/event-1' }, sizes)
assert.deepEqual(changedPlayer.value.cards, [])
assert.equal(changedPlayer.value.goldPaymentSelected, false)
assert.deepEqual(changedPlayer.value.preparedScryPicked, [])
assert.equal(updateEventField(changedPlayer, scopes, 'cards', ['private-old-card']), changedPlayer)
assert.equal(clearEventChoice(changedPlayer, scopes), changedPlayer, 'late cancellation cannot clear another player')

const prepared = { ...scopes, prepared: 'combat-1/scry-2' }
const nextPrepared = reconcileEventDraft(state, prepared, sizes)
assert.deepEqual(nextPrepared.value.preparedScryPicked, [])
assert.deepEqual(nextPrepared.value.rewardItemChoices, ['skip'])
assert.equal(updateEventField(nextPrepared, scopes, 'preparedScryPicked', ['scry-card']), nextPrepared)
const cancelled = clearEventChoice(state, scopes)
assert.deepEqual(cancelled.value.cards, [])
assert.deepEqual(cancelled.value.pickerCardUids, [])
assert.deepEqual(cancelled.value.rewardItemChoices, ['skip'], 'canceling a payment must not erase a separate item decision')
assert.deepEqual(state.value.cards, ['payment-card'], 'draft transitions must not mutate previous frames')
console.log('PASS event drafts: scoped payments, reveals, cancellation, stale callbacks, and prepared choices')
