import { cardDef, faceOf } from '../cards.ts'
import type { CardInstance } from '../types.ts'
import { clone, findPlayer } from './board.ts'
import { previewIncomingDamage, type IncomingDamagePreview } from './enemy-turn.ts'
import { evokeTargetProgress, scryPlayCardPlayable } from './effects.ts'
import { previewCardBlock, previewCardDamage, type CardBlockPreview, type CardDamagePreview } from './preview.ts'
import { previewCardShivTargets } from './play.ts'
import { effectiveCombatCardDef, stageChamberCard } from './queries.ts'
import { startTurnAbilities } from './start-turn.ts'
import type { CombatState, PlayContext, StartTurnAbility, StartTurnChoice } from './types.ts'
import { UnknownCombatInformation } from './view.ts'

export type CombatCardSource = 'hand' | 'chamber' | 'copy'
export type CombatTargetProgress = { index: number; options: { uid: string; label: string }[]; complete: boolean }
type CardQuery = {
  cardUid: string
  source: CombatCardSource
  context: Omit<PlayContext, 'previewShivTarget'>
}

export type CombatQuery =
  | { kind: 'hud'; enemyUid?: string | null }
  | { kind: 'startTurn'; order: string[]; choices: StartTurnChoice[] }
  | (CardQuery & { kind: 'evoke' | 'shivs' })
  | (CardQuery & { kind: 'scryPlay'; discarded: string[] })

export type CombatQueryResult =
  | { kind: 'hud'; incoming: [string, IncomingDamagePreview][]; cards: {
    uid: string
    block: CardBlockPreview | null
    damage: { enemyUid: string | null; value: CardDamagePreview | null }[]
  }[] }
  | { kind: 'startTurn'; abilities: StartTurnAbility[] }
  | { kind: 'evoke' | 'shivs'; progress: CombatTargetProgress | null }
  | { kind: 'scryPlay'; eligible: string[] | null }

/** Evaluated only by a local authority or the room server, never from a presentation view. */
export function evaluateCombatQuery(
  state: CombatState, viewerId: string, query: CombatQuery,
  options: { publicOnly?: boolean; revealedCards?: readonly CardInstance[] } = {},
): CombatQueryResult {
  const actor = findPlayer(state, viewerId)
  if (!actor) throw new Error('The combat query has no owning player.')
  if (query.kind === 'hud') {
    const incoming = [...(previewIncomingDamage(state, options.publicOnly ? viewerId : undefined) ?? [])]
      .filter(([id]) => !options.publicOnly || id === viewerId)
    return {
      kind: query.kind, incoming,
      cards: actor.hand.map(card => ({
        uid: card.uid,
        block: previewCardBlock(state, viewerId, card.uid, options.publicOnly),
        damage: [{ enemyUid: query.enemyUid ?? null,
          value: previewCardDamage(state, viewerId, card.uid, query.enemyUid ?? null, options.publicOnly) }],
      })),
    }
  }
  if (query.kind === 'startTurn') {
    const abilities = startTurnAbilities(state, query.order, query.choices, options.publicOnly)
    return { kind: query.kind, abilities: options.publicOnly ? abilities.map(ability => ({
      ...ability,
      exhaustCards: ability.playerId === viewerId ? ability.exhaustCards : undefined,
    })) : abilities }
  }
  const held = query.source === 'copy'
    ? state.pendingCardCopy?.playerId === viewerId && state.pendingCardCopy.card.uid === query.cardUid
      ? state.pendingCardCopy.card : undefined
    : (query.source === 'chamber' ? actor.chamber : actor.hand)
      .find(card => card.uid === query.cardUid)
  if (!held) throw new Error('The queried card is not available to its owner.')
  if (query.kind === 'scryPlay') {
    if (!options.revealedCards) throw new Error('A Scry query requires an authorized reveal.')
    const judged = clone(state)
    const player = findPlayer(judged, viewerId)!
    player.hand = player.hand.filter(card => card.uid !== held.uid)
    player.cardsPlayedThisTurn = (player.cardsPlayedThisTurn ?? 0) + 1
    const cards = [...options.revealedCards]
    try {
      return { kind: query.kind, eligible: cards.filter(card =>
        scryPlayCardPlayable(judged, viewerId, cards, card.uid, query.discarded.filter(uid => uid !== card.uid), options.publicOnly))
        .map(card => card.uid) }
    } catch (error) {
      if (error instanceof UnknownCombatInformation) return { kind: query.kind, eligible: null }
      throw error
    }
  }
  if (query.kind === 'shivs') {
    return { kind: query.kind, progress: previewCardShivTargets(state, viewerId, held.uid, query.context, query.source, options.publicOnly) }
  }
  const def = effectiveCombatCardDef(faceOf(cardDef(held.defId), held.upgraded),
    query.context.corruptedShardMode ?? actor.guardianMode)
  const required = state.pendingHermitChamberPlays?.[0]
  const staged = query.source === 'chamber' ? stageChamberCard(actor, held,
    required?.playerId === viewerId && required.cardUids[0] === held.uid && required.free).player : actor
  try {
    return { kind: query.kind, progress: evokeTargetProgress(def, state, staged,
      query.context.evokeSlots ?? [], query.context.evokeEnemyUids ?? [], query.context.mode, query.context.energySpent ?? 0,
      options.publicOnly) }
  } catch (error) {
    if (error instanceof UnknownCombatInformation) return { kind: query.kind, progress: null }
    throw error
  }
}
