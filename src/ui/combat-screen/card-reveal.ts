import { combatActor, type CombatView } from '../../game/combat/view.ts'
import { stageChamberCard } from '../../game/combat/queries.ts'
import type { RoomSnapshot } from '../../protocol/room.ts'
import { pendingFor } from './card-play-requirements.ts'
import type { Pending } from './types.ts'
import type { CardRevealAction } from '../../protocol/combat-actions.ts'
export type { CardRevealAction } from '../../protocol/combat-actions.ts'

export type CardRevealAttempt = {
  combatId: string
  playerId: string
  action: CardRevealAction
  selection?: Pending
}
type Preview = RoomSnapshot['cardPreview']

export function matchingCardReveal(attempt: CardRevealAttempt, state: CombatView, preview: Preview): boolean {
  const { action, playerId } = attempt
  if (state.combatId !== attempt.combatId || !preview || preview.cardUid !== action.cardUid ||
    (preview.copy === true) !== (action.kind === 'previewCardCopy') ||
    (preview.chamber === true) !== (action.kind === 'previewHermitChamberCard')) return false
  if (action.kind === 'previewCardCopy' && (state.phase !== 'copy' || state.pendingCardCopy?.id !== action.copyId ||
    state.pendingCardCopy.playerId !== playerId || state.pendingCardCopy.card.uid !== action.cardUid)) return false
  return preview.enemyUid === action.enemyUid &&
    (action.kind !== 'previewCard' || preview.spendMiracle === action.spendMiracle) &&
    (action.kind !== 'previewHermitChamberCard' || action.energySpent === undefined || preview.energySpent === action.energySpent) &&
    JSON.stringify(preview.slimeUids ?? []) === JSON.stringify(action.slimeUids ?? []) &&
    JSON.stringify(preview.slimeEnemyUids ?? []) === JSON.stringify(action.slimeEnemyUids ?? [])
}

/** Rebuild only the exact reveal this operation owns, never a later card/copy's private choices. */
export function revealedCardDraft(attempt: CardRevealAttempt, state: CombatView, preview: Preview): Pending | null {
  if (!matchingCardReveal(attempt, state, preview) || !preview) return null
  const player = combatActor(state, attempt.playerId)
  if (!player) return null
  const { action } = attempt
  const copied = action.kind === 'previewCardCopy'
  const chamber = action.kind === 'previewHermitChamberCard'
  const held = copied ? state.pendingCardCopy?.card
    : player[chamber ? 'chamber' : 'hand'].find(card => card.uid === action.cardUid)
  if (!held) return null
  const required = state.pendingHermitChamberPlays?.[0]
  const staged = chamber ? stageChamberCard(player, held,
    required?.playerId === player.id && required.cardUids[0] === held.uid && required.free) : undefined
  const next = {
    ...pendingFor(staged?.card ?? held, preview.cards, state, staged?.player ?? player,
      !copied && !chamber, copied ? state.pendingCardCopy?.energySpent : undefined, chamber),
    chamberPlay: chamber, enemyUid: preview.enemyUid,
    ...(chamber && preview.energySpent !== undefined ? {
      energySpent: preview.energySpent, effectEnergy: preview.energySpent, energyCharged: preview.energySpent,
    } : {}),
    slimeUids: preview.slimeUids ?? [], slimeEnemyUids: preview.slimeEnemyUids ?? [],
  }
  if (next.choice?.kind !== preview.kind) return null
  const previous = attempt.selection
  const unchanged = previous?.choiceCards && next.choice.kind === previous.choice?.kind &&
    next.choiceCards?.length === previous.choiceCards.length &&
    next.choiceCards.every((card, index) => card.uid === previous.choiceCards?.[index]?.uid)
  return unchanged ? { ...next, picked: previous.picked, choiceConfirmed: previous.choiceConfirmed,
    scryToHandUid: previous.scryToHandUid } : next
}
