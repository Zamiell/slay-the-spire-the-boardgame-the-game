type CardPotion = 'liquid_memories' | 'liquid_void' | 'transforming_brew' | 'purity_potion'
export type PotionSelection =
  | { kind: 'idle' }
  | { kind: 'target'; potionId: string }
  | { kind: 'cards'; potionId: CardPotion; picked: string[] }
  | { kind: 'overflow'; potionId: string; required: number; targets: string[] }

export type PotionSelectionEvent =
  | { type: 'stage'; potionId: string; overflow: number }
  | { type: 'cancel' }
  | { type: 'toggleCard'; uid: string }
  | { type: 'targets'; targets: string[] }
  | { type: 'refresh'; usable: boolean; overflow: number; alive: ReadonlySet<string>; cards: ReadonlySet<string> }

function cardPotion(id: string): id is CardPotion {
  return ['liquid_memories', 'liquid_void', 'transforming_brew', 'purity_potion'].includes(id)
}

export function transitionPotionSelection(state: PotionSelection, event: PotionSelectionEvent): PotionSelection {
  if (event.type === 'cancel') return { kind: 'idle' }
  if (event.type === 'stage') {
    if (cardPotion(event.potionId)) return { kind: 'cards', potionId: event.potionId, picked: [] }
    if (event.overflow > 0) return { kind: 'overflow', potionId: event.potionId, required: event.overflow, targets: [] }
    return { kind: 'target', potionId: event.potionId }
  }
  if (state.kind === 'idle') return state
  if (event.type === 'toggleCard') {
    if (state.kind !== 'cards' || state.potionId !== 'purity_potion') return state
    const picked = state.picked.includes(event.uid) ? state.picked.filter((uid) => uid !== event.uid)
      : state.picked.length < 3 ? [...state.picked, event.uid] : state.picked
    return picked === state.picked ? state : { ...state, picked }
  }
  if (event.type === 'targets') return state.kind === 'overflow'
    ? { ...state, targets: event.targets.slice(0, state.required) } : state
  if (!event.usable) return { kind: 'idle' }
  if (state.kind === 'cards') {
    const picked = state.picked.filter((uid) => event.cards.has(uid))
    return picked.length === state.picked.length ? state : { ...state, picked }
  }
  if (state.kind === 'overflow') {
    if (event.overflow === 0) return { kind: 'idle' }
    if (event.overflow !== state.required) return { ...state, required: event.overflow, targets: [] }
    const targets = state.targets.filter((uid) => event.alive.has(uid))
    return targets.length === state.targets.length ? state : { ...state, targets }
  }
  return event.overflow > 0 ? {
    kind: 'overflow', potionId: state.potionId, required: event.overflow, targets: [],
  } : state
}
