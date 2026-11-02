import type { Pending } from './types.ts'
import { cardDef, faceOf } from '../../game/cards.ts'
import { effectiveCombatCardDef, guardianPowerBeamCards, playCost, slimeCommandEnemyChoiceLabels, adjacentDamageChoiceCount, cardDefForTarget } from '../../game/combat.ts'
import { chosenDieRelicAbilities, relicDef } from '../../game/relics.ts'
import type { Enemy } from '../../game/types.ts'
import { type CombatActor, type CombatView } from '../../game/combat/view.ts'
export function createCardChoiceRules(state: CombatView, viewer: CombatActor, miracleOnCard: boolean) {
  const forcedCardUid = state.startTurnProgress?.forcedCard?.playerId === viewer.id
    ? state.startTurnProgress.forcedCard.cardUid : null
  const withAdjacentChoices = (next: Pending): Pending => {
    const effects = faceOf(cardDef(next.card.defId), next.card.upgraded).effects
    if (!effects.some((effect) => effect.kind === 'damageAdjacent')) return next
    const enemyChoices = adjacentDamageChoiceCount(effects, state, next.enemyUid)
    return enemyChoices === next.enemyChoices ? next : { ...next, enemyChoices, enemyUids: [] }
  }
  const slayerTargetAffordable = (next: Pending, enemy: Enemy | undefined): boolean => {
    const def = effectiveCombatCardDef(faceOf(cardDef(next.card.defId), next.card.upgraded), viewer.guardianMode)
    if (def.bossTargetCost === undefined || !enemy?.isBoss || !next.cardInHand || next.card.uid === forcedCardUid) return true
    const cost = playCost(cardDefForTarget(def, state, enemy.uid), viewer, next.card)
    return cost === 'X' || cost <= viewer.energy + (miracleOnCard ? 1 : 0)
  }
  const loadedTargetCount = (next: Pending) => next.picked.filter((uid) => {
    const loaded = next.choiceCards?.find((card) => card.uid === uid) ??
      viewer.hand.find((card) => card.uid === uid) ?? viewer.discard.find((card) => card.uid === uid)
    return loaded && ['hermit_grudge', 'hermit_malice', 'hermit_horror'].includes(loaded.defId)
  }).length
  const hermitDieRelicSelectionsReady = (next: Pending) => next.hermitDieRelics.every((choice) => {
    const owner = state.players.find((player) => player.id === choice.playerId && !player.dead)
    const held = owner?.relics[choice.relicIndex]
    const ability = held && chosenDieRelicAbilities(relicDef(held.defId))[choice.abilityIndex]
    if (!owner || !ability || ability.trigger.kind !== 'dieRelic') return false
    if (ability.supportTarget === 'anyPlayer' &&
      !state.players.some((player) => !player.dead && player.id === choice.targetPlayerId)) return false
    return true
  })
  const chamberChoiceRequired = (next: Pending) => {
    const choice = next.chamberChoice
    if (!choice || choice.baseAmount === undefined || choice.openAfterBase === undefined) return choice?.minimum ?? 0
    const loaded = (next.choice?.kind === 'load' || next.choice?.kind === 'loadAny' ? next.picked.length : 0) +
      Number(choice.loadSelf && next.chooseLoadSelf === true)
    return Math.min(choice.amount, choice.baseAmount + Math.max(0, loaded - choice.openAfterBase))
  }
  const chamberReplacementOptions = (next: Pending): string[] => {
    const choice = next.chamberChoice
    if (!choice || choice.baseAmount === undefined || choice.openAfterBase === undefined) return []
    const base = next.chamberUids.slice(0, choice.baseAmount)
    const baseSet = new Set(base)
    const chamber = viewer.chamber.filter((card) => !baseSet.has(card.uid) &&
      (!next.chamberPlay || card.uid !== next.card.uid)).map((card) => card.uid)
    const capacity = chamber.length + choice.openAfterBase
    const loads = [
      ...(next.choice?.kind === 'load' || next.choice?.kind === 'loadAny' ? next.picked : []),
      ...(choice.loadSelf && next.chooseLoadSelf === true ? [next.card.uid] : []),
    ]
    let replacementAt = 0
    for (const uid of loads) {
      if (chamber.length < capacity) chamber.push(uid)
      else {
        const selected = next.chamberUids[choice.baseAmount + replacementAt++]
        if (!selected) return chamber
        const at = chamber.indexOf(selected)
        if (at < 0) return []
        chamber[at] = uid
      }
    }
    return []
  }
  const chamberChoicesReady = (next: Pending) => !next.chamberChoice
    ? true
    : next.chamberChoice.baseAmount === undefined
      ? next.chamberChoiceConfirmed && next.chamberUids.length >= next.chamberChoice.minimum &&
      next.chamberUids.length <= next.chamberChoice.amount
      : chamberChoiceRequired(next) === 0 || next.chamberChoiceConfirmed &&
      next.chamberUids.length === chamberChoiceRequired(next)
  const slimeEnemyChoiceLabels = (next: Pending) => {
    const printed = faceOf(cardDef(next.card.defId), next.card.upgraded)
    const effective = effectiveCombatCardDef(printed, next.corruptedShardMode ?? viewer.guardianMode)
    const selected = effective.modes && next.mode !== null
      ? { ...effective, modes: undefined, effects: effective.modes[next.mode]?.effects ?? [] }
      : effective
    return slimeCommandEnemyChoiceLabels(selected, state, viewer, next.slimeUids,
      next.effectEnergy ?? 0, next.energyCharged ?? 0, next.card)
  }
  const slimeEnemyChoicesRequired = (next: Pending) => slimeEnemyChoiceLabels(next).length
  const downfallChoicesReady = (next: Pending) =>
    (!next.slimeChoice || next.slimeChoiceConfirmed && next.slimeUids.length >= next.slimeChoice.minimum &&
      next.slimeUids.length <= next.slimeChoice.amount) &&
    chamberChoicesReady(next) &&
    next.slimeEnemyUids.length === slimeEnemyChoicesRequired(next) &&
    (!next.hermitDieRelicChoice || next.hermitDieRelicChoiceConfirmed &&
      next.hermitDieRelics.length >= next.hermitDieRelicChoice.minimum &&
      next.hermitDieRelics.length <= next.hermitDieRelicChoice.amount && hermitDieRelicSelectionsReady(next)) &&
    next.hermitEnemyUids.length === loadedTargetCount(next) &&
    next.soulburnEnemyUids.length === next.soulburnChoices &&
    next.chooseLoadSelf !== null && next.spendVigor !== null && next.guardianModeShift !== null &&
    next.secondGuardianModeShift !== null && next.guardianBlockSpend !== null &&
    (next.card.defId !== 'guardian_power_beam' ||
      (viewer.guardianMode ?? next.corruptedShardMode) !== 'defense' ||
      guardianPowerBeamCards(viewer, next.card.uid).length === 0 || next.guardianPowerCardUid !== null)
  return { withAdjacentChoices, slayerTargetAffordable, loadedTargetCount, hermitDieRelicSelectionsReady, chamberChoiceRequired, chamberReplacementOptions, chamberChoicesReady, slimeEnemyChoiceLabels, slimeEnemyChoicesRequired, downfallChoicesReady }
}
