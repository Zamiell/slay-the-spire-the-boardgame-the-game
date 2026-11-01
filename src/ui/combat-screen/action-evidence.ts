import type { CombatState } from '../../game/combat.ts'
import { powerAbilityKey } from '../../game/combat.ts'
import type { VisibleCombat } from '../../multiplayer/useRoomSession.ts'

export type CardSubmissionSource = {
  cardUid: string
  source: 'hand' | 'chamber' | 'copy'
  copyId?: number
}

export function potionSubmissionCommitted(
  submitted: { potionId: string; countBefore: number }, combat: CombatState | VisibleCombat, viewerId: string,
) {
  const player = combat.players.find((player) => player.id === viewerId)
  return Boolean(player && player.potions.filter((id) => id === submitted.potionId).length < submitted.countBefore)
}

export function powerSubmissionCommitted(
  submitted: { powerUid: string }, combat: CombatState | VisibleCombat, viewerId: string,
) {
  return combat.powerTriggersUsedThisTurn.includes(powerAbilityKey(viewerId, submitted.powerUid))
}

export type RelicSubmissionEvidence = {
  relicIndex: number
  defId: string
  spentBefore: boolean
  cubesBefore?: number
  scryId?: number
}

export function relicSubmissionCommitted(
  submitted: RelicSubmissionEvidence, combat: CombatState | VisibleCombat, viewerId: string,
) {
  const held = combat.players.find((player) => player.id === viewerId)?.relics[submitted.relicIndex]
  if (!held || held.defId !== submitted.defId) return false
  if (!submitted.spentBefore && held.spent) return true
  if (submitted.cubesBefore !== undefined && held.cubes !== undefined && held.cubes < submitted.cubesBefore) return true
  const scry = combat.pendingRelicScry
  return submitted.defId.replace(/^downfall_/, '') === 'golden_eye' && submitted.scryId === undefined &&
    scry?.playerId === viewerId && scry.relicIndex === submitted.relicIndex
}

export function cardSubmissionCommitted(
  submitted: CardSubmissionSource, combat: CombatState | VisibleCombat, viewerId: string,
) {
  if (submitted.source === 'copy') return combat.pendingCardCopy?.card.uid !== submitted.cardUid ||
    combat.pendingCardCopy.id !== submitted.copyId
  const player = combat.players.find((player) => player.id === viewerId)
  const cards = submitted.source === 'chamber' ? player?.chamber : player?.hand
  return Boolean(cards && !cards.some((card) => card.uid === submitted.cardUid))
}
