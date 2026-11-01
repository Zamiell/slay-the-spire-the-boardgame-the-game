import type { PowerContext } from '../../game/combat.ts'
import type { CardInstance } from '../../game/types.ts'

type ScrySelection =
  | { kind: 'none' }
  | { kind: 'choosing' | 'confirmed'; cards: CardInstance[]; discarded: string[]; context: PowerContext | null }
export type PowerSelection =
  | { kind: 'idle' }
  | {
    kind: 'selecting'
    powerUid: string
    chamber: string[]
    load: string[]
    exhaust: string[]
    orbs: number[]
    scry: ScrySelection
  }
export type PowerSelectionEvent =
  | { type: 'cancel' }
  | { type: 'select'; powerUid: string }
  | { type: 'preview'; powerUid: string; cards: CardInstance[] }
  | { type: 'clearPreview' }
  | { type: 'chamber' | 'load' | 'exhaust'; uids: string[] }
  | { type: 'toggleOrb'; slot: number; maximum: number }
  | { type: 'toggleScry'; uid: string }
  | { type: 'gemContext'; context: PowerContext }
  | { type: 'confirmScry'; confirmed: boolean }
  | { type: 'restore'; powerUid: string; context: PowerContext; chamber: string[]; hand: string[];
    cards?: CardInstance[]; confirmed: boolean }

function select(powerUid: string): Extract<PowerSelection, { kind: 'selecting' }> {
  return { kind: 'selecting', powerUid, chamber: [], load: [], exhaust: [], orbs: [], scry: { kind: 'none' } }
}

/** A closed/cancelled Power never retains a hidden picker or gem confirmation. */
export function transitionPowerSelection(state: PowerSelection, event: PowerSelectionEvent): PowerSelection {
  if (event.type === 'cancel') return { kind: 'idle' }
  if (event.type === 'select') return select(event.powerUid)
  if (event.type === 'preview') return {
    ...(state.kind === 'selecting' && state.powerUid === event.powerUid ? state : select(event.powerUid)),
    scry: { kind: 'choosing', cards: event.cards, discarded: [], context: null },
  }
  if (event.type === 'restore') {
    const restored = select(event.powerUid)
    restored.chamber = (event.context.chamberUids ?? []).filter((uid) => event.chamber.includes(uid))
    restored.load = (event.context.loadUids ?? []).filter((uid) => event.hand.includes(uid))
    if (event.cards) {
      restored.exhaust = event.context.exhaustUids ?? []
      restored.scry = {
        kind: event.confirmed ? 'confirmed' : 'choosing', cards: event.cards,
        discarded: (event.context.scryDiscardUids ?? []).filter((uid) => event.cards!.some((card) => card.uid === uid)),
        context: event.context,
      }
    }
    return restored
  }
  if (state.kind === 'idle') return state
  if (event.type === 'chamber' || event.type === 'load' || event.type === 'exhaust') {
    return { ...state, [event.type]: event.uids }
  }
  if (event.type === 'clearPreview') return { ...state, scry: { kind: 'none' } }
  if (event.type === 'toggleOrb') return {
    ...state, orbs: state.orbs.includes(event.slot) ? state.orbs.filter((slot) => slot !== event.slot)
      : state.orbs.length < event.maximum ? [...state.orbs, event.slot] : state.orbs,
  }
  if (state.scry.kind === 'none') return state
  if (event.type === 'toggleScry') {
    if (!state.scry.cards.some((card) => card.uid === event.uid)) return state
    return { ...state, scry: { ...state.scry,
      discarded: state.scry.discarded.includes(event.uid)
        ? state.scry.discarded.filter((uid) => uid !== event.uid) : [...state.scry.discarded, event.uid] } }
  }
  if (event.type === 'gemContext') return { ...state, scry: { ...state.scry, context: event.context } }
  if (event.type === 'confirmScry') return {
    ...state, scry: { ...state.scry, kind: event.confirmed ? 'confirmed' : 'choosing' },
  }
  return state
}

export function powerSelectionValues(state: PowerSelection) {
  const active = state.kind === 'selecting' ? state : null
  const scry = active?.scry.kind !== 'none' ? active?.scry : null
  return {
    pendingPowerUid: active?.powerUid ?? null,
    powerChamberUids: active?.chamber ?? [],
    powerLoadUids: active?.load ?? [],
    powerExhaustUids: active?.exhaust ?? [],
    powerOrbSlots: active?.orbs ?? [],
    powerChoiceCards: scry?.cards ?? null,
    powerScryDiscardUids: scry?.discarded ?? [],
    powerGemContext: scry?.context ?? null,
    powerScryConfirmed: scry?.kind === 'confirmed',
  }
}
