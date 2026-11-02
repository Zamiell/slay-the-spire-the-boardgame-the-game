import { availableTransformRewards } from '../game/acquisition.ts'
import type { CardInstance, Player } from '../game/types.ts'

export type NoncombatPlayerView = Readonly<Pick<Player,
  'id' | 'name' | 'character' | 'skin' | 'row' | 'hp' | 'maxHp' | 'gold' | 'dead' | 'relics' | 'potions'
>> & {
  readonly deck: CardInstance[] | null
  readonly cardRewardCount: number
  readonly tradableDeckCount: number
  readonly transformAvailable?: boolean
}

export type NoncombatActor = NoncombatPlayerView & { readonly deck: CardInstance[] }

export function hasKnownDeck<T extends { readonly deck: CardInstance[] | null }>(
  player: T,
): player is T & { readonly deck: CardInstance[] } {
  return player.deck !== null
}

/** Project local supplies into the same capabilities the room publishes. */
export function noncombatPlayerView(player: Player): NoncombatActor {
  const { id, name, character, skin, row, hp, maxHp, gold, dead, relics, potions, deck } = player
  return {
    id, name, character, skin, row, hp, maxHp, gold, dead, relics, potions, deck,
    cardRewardCount: player.cardRewards.length,
    tradableDeckCount: deck.filter(card => card.defId !== 'ascenders_bane').length,
    transformAvailable: availableTransformRewards(player) > 0,
  }
}
