import type { CombatState } from '../../game/combat/types.ts'

const RESOURCES = ['shivs', 'miracles', 'vigor', 'soulburn', 'clawCubesGainedThisCombat'] as const
export type CombatResource = typeof RESOURCES[number]
export type ResourceVisibility = {
  combatId: string
  byPlayer: ReadonlyMap<string, ReadonlySet<CombatResource>>
}

/** Remember acquisition, not the current balance; keep each seat's history separate. */
export function trackCombatResources(
  previous: ResourceVisibility | undefined,
  state: Pick<CombatState, 'combatId' | 'players'>,
): ResourceVisibility {
  let next = previous?.combatId === state.combatId ? previous
    : { combatId: state.combatId, byPlayer: new Map<string, ReadonlySet<CombatResource>>() }
  for (const player of state.players) {
    const seen = next.byPlayer.get(player.id)
    const gained = RESOURCES.filter(resource => (player[resource] ?? 0) > 0 && !seen?.has(resource))
    if (gained.length === 0) continue
    const byPlayer = new Map(next.byPlayer)
    byPlayer.set(player.id, new Set([...seen ?? [], ...gained]))
    next = { combatId: state.combatId, byPlayer }
  }
  return next
}
