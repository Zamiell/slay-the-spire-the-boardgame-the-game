import type { CardInstance, Player } from '../types.ts'
import type { CombatState } from './types.ts'

/** An actor's known cards are sufficient for choices, but not for running the engine. */
export type CombatActor = Readonly<Omit<Player, 'cardRewards' | 'rareRewards'>> & {
  /** Availability does not disclose the ordered reward supply. */
  readonly transformAvailable?: boolean
}

export type CombatPlayerView = Readonly<Omit<CombatActor, 'deck' | 'draw' | 'hand' | 'chamber'>> & {
  readonly deck: CardInstance[] | null
  readonly draw: CardInstance[] | null
  readonly hand: CardInstance[] | null
  readonly chamber: CardInstance[] | null
  readonly deckCount?: number
  readonly drawCount?: number
  readonly handCount?: number
  readonly chamberCount?: number
}

/** Unknown piles remain null. A visible draw set is not permission to simulate its order. */
export type CombatView = Readonly<Omit<CombatState,
  'rng' | 'potionDeck' | 'summonSupply' | 'discardedThisTurn' | 'stanceChangedThisTurn' |
  'players' | 'pendingDistilled' | 'pendingRelicScry'
>> & {
  readonly players: readonly CombatPlayerView[]
  readonly pendingDistilled?: { playerId: string; cards: CardInstance[] | null }
  readonly pendingRelicScry?: { id: number; playerId: string; relicIndex: number; cards: CardInstance[] | null }
  readonly knowledge?: {
    viewerId: string
    drawOrder: 'unknown'
    discardedThisTurn?: boolean
    stanceChangedThisTurn?: boolean
  }
}

export function isCombatActor(player: CombatPlayerView): player is CombatActor {
  return player.deck !== null && player.draw !== null && player.hand !== null && player.chamber !== null
}

export function combatActor(state: CombatView, playerId: string): CombatActor | undefined {
  return state.players.find((player): player is CombatActor => player.id === playerId && isCombatActor(player))
}

export function hasCombatSimulation(state: CombatView): state is CombatState {
  return state.knowledge === undefined && 'rng' in state
}

/** Mutation and private previews must explicitly acquire the local simulation capability. */
export function localCombat(state: CombatView): CombatState {
  if (!hasCombatSimulation(state)) throw new Error('This combat view does not have local simulation authority.')
  return state
}

export class UnknownCombatInformation extends Error {}

export function combatTurnFact(
  state: CombatView, playerId: string, fact: 'discardedThisTurn' | 'stanceChangedThisTurn',
): boolean {
  if (hasCombatSimulation(state)) return state[fact].includes(playerId)
  const known = state.knowledge?.viewerId === playerId ? state.knowledge[fact] : undefined
  if (known === undefined) throw new UnknownCombatInformation(`The combat view does not reveal ${fact} for this player.`)
  return known
}
