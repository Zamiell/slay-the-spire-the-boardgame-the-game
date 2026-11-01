import type { CombatState } from './types.ts'

/** Speculative public results must not depend on consuming hidden random or ordered supplies. */
export function preservesPrivateSupplies(before: CombatState, after: CombatState,
  revealed?: { playerId: string; cardUids: ReadonlySet<string> }): boolean {
  if (before.rng.seed !== after.rng.seed || before.rng.calls !== after.rng.calls ||
    JSON.stringify(before.potionDeck) !== JSON.stringify(after.potionDeck) ||
    JSON.stringify(before.summonSupply) !== JSON.stringify(after.summonSupply)) return false
  return before.players.every(player => {
    const next = after.players.find(candidate => candidate.id === player.id)
    if (!next || JSON.stringify(player.cardRewards) !== JSON.stringify(next.cardRewards) ||
      JSON.stringify(player.rareRewards) !== JSON.stringify(next.rareRewards)) return false
    // Public enemy effects can add Statuses without reading the existing draw order.
    const hidden = player.draw.filter(card => revealed?.playerId !== player.id || !revealed.cardUids.has(card.uid))
    const old = new Set(hidden.map(card => card.uid))
    const retained = next.draw.filter(card => old.has(card.uid))
    return retained.length === hidden.length &&
      retained.every((card, index) => card.uid === hidden[index]?.uid)
  })
}
