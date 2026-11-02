import { cardHasRetain, type CombatPhase, type DiscardOrders } from '../../game/combat.ts'
import type { CombatActor } from '../../game/combat/view.ts'

export type EndTurnDraft = {
  discardTops: Record<string, string>
  retainedCards: Record<string, string[]>
  retainChoiceOpen: boolean | 'auto'
  discardChoiceOpen: boolean | 'auto'
  discardOrders: DiscardOrders
  armedAbilityId: string | null
  selfExhaust: boolean
}
export type EndTurnDraftInput = {
  scope: string
  viewer: CombatActor
  online: boolean
  phase: CombatPhase
  savedOrder?: readonly string[]
  effectId?: string
}
type Scopes = { table: string; viewer: string; saved: string; effect: string | undefined }
export type EndTurnDraftState = { scopes: Scopes; value: EndTurnDraft }
export type EndTurnFieldUpdate<Key extends keyof EndTurnDraft> =
  EndTurnDraft[Key] | ((previous: EndTurnDraft[Key]) => EndTurnDraft[Key])

function scopesFor(input: EndTurnDraftInput): Scopes {
  return { table: input.scope, viewer: input.viewer.id,
    saved: JSON.stringify(input.savedOrder) ?? '', effect: input.effectId }
}

function restoreOrder(value: EndTurnDraft, { viewer, phase, savedOrder }: EndTurnDraftInput): EndTurnDraft {
  if (phase !== 'discard' || !savedOrder) return value
  const ordered = new Set(savedOrder)
  const top = savedOrder.at(-1)
  return { ...value,
    discardOrders: { [viewer.id]: [...savedOrder] },
    retainedCards: { [viewer.id]: viewer.hand.filter(card => !ordered.has(card.uid) &&
      !card.endTurnProtected && !card.retainThisTurn && !cardHasRetain(viewer, card)).map(card => card.uid) },
    discardTops: top ? { [viewer.id]: top } : {},
  }
}

export function createEndTurnDraft(input: EndTurnDraftInput): EndTurnDraftState {
  return { scopes: scopesFor(input), value: restoreOrder({
    discardTops: {}, retainedCards: {}, retainChoiceOpen: 'auto', discardChoiceOpen: 'auto',
    discardOrders: {}, armedAbilityId: null, selfExhaust: false,
  }, input) }
}

export function reconcileEndTurnDraft(state: EndTurnDraftState, input: EndTurnDraftInput): EndTurnDraftState {
  const scopes = scopesFor(input)
  if (state.scopes.table !== scopes.table || input.online && state.scopes.viewer !== scopes.viewer)
    return createEndTurnDraft(input)
  let value = state.value
  if (state.scopes.viewer !== scopes.viewer) value = { ...value,
    retainChoiceOpen: 'auto', discardChoiceOpen: 'auto', armedAbilityId: null, selfExhaust: false }
  if (state.scopes.saved !== scopes.saved || state.scopes.viewer !== scopes.viewer) value = restoreOrder(value, input)
  if (state.scopes.effect !== scopes.effect) value = { ...value, armedAbilityId: null, selfExhaust: false }
  return value === state.value && state.scopes.saved === scopes.saved ? state : { scopes, value }
}

export function updateEndTurnField<Key extends keyof EndTurnDraft>(
  state: EndTurnDraftState, scopes: Scopes, field: Key, update: EndTurnFieldUpdate<Key>,
): EndTurnDraftState {
  if (state.scopes.table !== scopes.table || state.scopes.viewer !== scopes.viewer ||
    state.scopes.saved !== scopes.saved ||
    (field === 'armedAbilityId' || field === 'selfExhaust') && state.scopes.effect !== scopes.effect) return state
  const previous = state.value[field]
  const value = typeof update === 'function' ? update(previous) : update
  return Object.is(previous, value) ? state : { ...state, value: { ...state.value, [field]: value } }
}
