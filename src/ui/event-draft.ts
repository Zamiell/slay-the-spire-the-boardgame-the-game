import type { RewardSource } from '../game/run.ts'

export type EventDraft = {
  cards: string[]
  pickerCardUids: string[]
  tradeCardUid: string
  relicId: string
  potionIndexes: number[]
  goldPaymentSelected: boolean
  potionRecipientIds: string[]
  potionReplacementIds: (string | null)[]
  rewardItemChoices: ('take' | 'skip' | '')[]
  targetPlayerId: string
  roomId: string
  selectedOptions: string[]
  rewardSources: RewardSource[]
  rareRewardSources: RewardSource[]
  guardianGemIds: string[]
  preparedScryOrder: string[]
  preparedScryPicked: string[]
  rewardIndexes: number[]
}
export type EventDraftScopes = Record<'event' | 'items' | 'rewards' | 'cardSources' | 'rareSources' | 'trade' | 'prepared', string>
export type EventDraftState = { scopes: EventDraftScopes; value: EventDraft; itemsInitialized: boolean }
export type EventDraftSizes = { rewards: number; potions: number }
export type EventFieldUpdate<Key extends keyof EventDraft> = EventDraft[Key] | ((previous: EventDraft[Key]) => EventDraft[Key])

const choiceDefaults = () => ({
  cards: [], pickerCardUids: [], relicId: '', potionIndexes: [], goldPaymentSelected: false,
  targetPlayerId: '', roomId: '', selectedOptions: [], rewardSources: [], rareRewardSources: [],
})
export function createEventDraft(scopes: EventDraftScopes, sizes: EventDraftSizes): EventDraftState {
  return { scopes, itemsInitialized: false, value: {
    ...choiceDefaults(), tradeCardUid: '', guardianGemIds: [], preparedScryOrder: [], preparedScryPicked: [],
    potionRecipientIds: Array<string>(sizes.potions).fill(''),
    potionReplacementIds: Array<null>(sizes.potions).fill(null), rewardItemChoices: [],
    rewardIndexes: Array<number>(sizes.rewards).fill(-2),
  } }
}

export function reconcileEventDraft(state: EventDraftState, scopes: EventDraftScopes, sizes: EventDraftSizes): EventDraftState {
  if (state.scopes.event !== scopes.event) return createEventDraft(scopes, sizes)
  let value = state.value
  let itemsInitialized = state.itemsInitialized
  if (state.scopes.items !== scopes.items) {
    value = { ...value, rewardItemChoices: [], potionRecipientIds: Array<string>(sizes.potions).fill(''),
      potionReplacementIds: Array<null>(sizes.potions).fill(null) }
    itemsInitialized = false
  }
  if (state.scopes.rewards !== scopes.rewards) value = {
    ...value, rewardIndexes: Array<number>(sizes.rewards).fill(-2), guardianGemIds: [],
  }
  if (state.scopes.cardSources !== scopes.cardSources) value = { ...value, rewardSources: [] }
  if (state.scopes.rareSources !== scopes.rareSources) value = { ...value, rareRewardSources: [] }
  if (state.scopes.trade !== scopes.trade) value = { ...value, tradeCardUid: '' }
  if (state.scopes.prepared !== scopes.prepared) value = { ...value, preparedScryOrder: [], preparedScryPicked: [] }
  return value === state.value ? state : { scopes, value, itemsInitialized }
}

function fieldScope(field: keyof EventDraft): keyof EventDraftScopes {
  switch (field) {
    case 'rewardItemChoices': case 'potionRecipientIds': case 'potionReplacementIds': return 'items'
    case 'rewardIndexes': case 'guardianGemIds': return 'rewards'
    case 'rewardSources': return 'cardSources'
    case 'rareRewardSources': return 'rareSources'
    case 'tradeCardUid': return 'trade'
    case 'preparedScryOrder': case 'preparedScryPicked': return 'prepared'
    default: return 'event'
  }
}

export function updateEventField<Key extends keyof EventDraft>(
  state: EventDraftState, scopes: EventDraftScopes, field: Key, update: EventFieldUpdate<Key>,
): EventDraftState {
  const owner = fieldScope(field)
  if (state.scopes.event !== scopes.event || state.scopes[owner] !== scopes[owner]) return state
  const previous = state.value[field]
  const value = typeof update === 'function' ? update(previous) : update
  return Object.is(previous, value) ? state : { ...state, value: { ...state.value, [field]: value } }
}

export function initializeEventItems(state: EventDraftState, scopes: EventDraftScopes, choices: EventDraft['rewardItemChoices']): EventDraftState {
  if (state.itemsInitialized || state.scopes.event !== scopes.event || state.scopes.items !== scopes.items) return state
  return { ...state, itemsInitialized: true, value: { ...state.value, rewardItemChoices: choices } }
}

export function clearEventChoice(state: EventDraftState, scopes: EventDraftScopes): EventDraftState {
  return state.scopes.event === scopes.event ? { ...state, value: { ...state.value, ...choiceDefaults() } } : state
}
