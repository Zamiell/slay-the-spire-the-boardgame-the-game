import { campfireNeedsDecision, campfireRestAvailable, canUpgradeCard } from '../game/run.ts'
import type { CampfireDecision } from '../game/run.ts'
import type { CardInstance } from '../game/types.ts'
import type { RuleSet } from '../game/meta.ts'
import { cardIsCurse } from '../game/cards.ts'

export type CampfirePicker = 'remove' | 'transform' | 'upgrade'
type CampfirePlayer = Parameters<typeof campfireNeedsDecision>[0] & { deck: readonly CardInstance[] | null }

export function campfireOptions(player: CampfirePlayer, rubyAvailable: boolean, restAllowed: boolean, ruleset: RuleSet) {
  const has = (id: string) => player.relics.some(relic => relic.defId === id)
  const upgradable = (player.deck ?? []).filter(canUpgradeCard)
  return {
    coffee: has('coffee_dripper'),
    hammer: has('fusion_hammer'),
    peacePipe: has('peace_pipe'),
    straightRazor: has('straight_razor'),
    restHeal: 3 + (has('regal_pillow') ? 3 : 0),
    upgradable,
    restAvailable: campfireRestAvailable(player, restAllowed, ruleset),
    needsDecision: campfireNeedsDecision(player, rubyAvailable, restAllowed, ruleset),
    rubyDeclineOnly: rubyAvailable && !campfireNeedsDecision(player, false, restAllowed, ruleset),
  }
}

export function campfireChoiceLabel(choice: CampfireDecision['choice']) {
  return choice === 'ruby' ? 'Get Ruby Key' : choice[0]!.toUpperCase() + choice.slice(1)
}

export function campfireCards(deck: readonly CardInstance[], picker: CampfirePicker, decision: CampfireDecision) {
  return deck.filter(card => picker === 'upgrade' ? canUpgradeCard(card) : picker === 'remove'
    ? card.defId !== 'ascenders_bane' : !cardIsCurse(card.defId) && card.uid !== decision.removeCardUid)
}

export function campfireSelection(decision: CampfireDecision, picker: CampfirePicker) {
  return picker === 'upgrade' ? decision.cardUid : picker === 'remove' ? decision.removeCardUid : decision.transformCardUid
}

export function selectCampfireCard(decision: CampfireDecision, picker: CampfirePicker, uid?: string): CampfireDecision {
  const selected = campfireSelection(decision, picker) === uid ? undefined : uid
  if (picker === 'upgrade') return { choice: 'smith', ...(selected ? { cardUid: selected } : {}) }
  return { ...decision, [picker === 'remove' ? 'removeCardUid' : 'transformCardUid']: selected,
    ...(picker === 'remove' && selected !== undefined && decision.transformCardUid === selected
      ? { transformCardUid: undefined } : {}) }
}
