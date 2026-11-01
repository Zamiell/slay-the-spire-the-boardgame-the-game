import { activePowerWindow, cardNeedsEnemy, guardianCardNeedsAlly, livingEnemies, powerActivationAllowed } from '../../game/combat.ts'
import type { CombatState, PowerContext } from '../../game/combat.ts'
import { cardDef, faceOf } from '../../game/cards.ts'
import type { CardInstance } from '../../game/types.ts'
import type { VisibleCombat } from '../../multiplayer/useRoomSession.ts'
import type { CombatScreenProps, PowerSubmission } from './types.ts'
import { powerSubmissionCommitted } from './action-evidence.ts'

type ScrySelection =
  | { kind: 'none' }
  | { kind: 'choosing' | 'confirmed'; cards: CardInstance[]; discarded: string[]; context: PowerContext | null }
export type PowerSelection =
  | { kind: 'idle' }
  | {
    kind: 'selecting'
    powerUid: string
    chamber: string[]
    load: string[]
    exhaust: string[]
    orbs: number[]
    scry: ScrySelection
  }
export type PowerSelectionEvent =
  | { type: 'cancel' }
  | { type: 'select'; powerUid: string }
  | { type: 'preview'; powerUid: string; cards: CardInstance[] }
  | { type: 'clearPreview' }
  | { type: 'chamber' | 'load' | 'exhaust'; uids: string[] }
  | { type: 'toggleOrb'; slot: number; maximum: number }
  | { type: 'toggleScry'; uid: string }
  | { type: 'gemContext'; context: PowerContext }
  | { type: 'confirmScry'; confirmed: boolean }
  | { type: 'restore'; powerUid: string; context: PowerContext; chamber: string[]; hand: string[];
    cards?: CardInstance[]; confirmed: boolean; orbSlots?: number[]; contextValid?: boolean }

function select(powerUid: string): Extract<PowerSelection, { kind: 'selecting' }> {
  return { kind: 'selecting', powerUid, chamber: [], load: [], exhaust: [], orbs: [], scry: { kind: 'none' } }
}
/** A closed/cancelled Power never retains a hidden picker or gem confirmation. */
export function transitionPowerSelection(state: PowerSelection, event: PowerSelectionEvent): PowerSelection {
  if (event.type === 'cancel') return { kind: 'idle' }
  if (event.type === 'select') return select(event.powerUid)
  if (event.type === 'preview') return {
    ...(state.kind === 'selecting' && state.powerUid === event.powerUid ? state : select(event.powerUid)),
    scry: { kind: 'choosing', cards: event.cards, discarded: [], context: null },
  }
  if (event.type === 'restore') {
    const restored = select(event.powerUid)
    restored.chamber = (event.context.chamberUids ?? []).filter((uid) => event.chamber.includes(uid))
    restored.load = restored.chamber.length === (event.context.chamberUids?.length ?? 0)
      ? (event.context.loadUids ?? []).filter((uid) => event.hand.includes(uid)) : []
    restored.exhaust = (event.context.exhaustUids ?? []).filter((uid) => event.hand.includes(uid))
    restored.orbs = (event.context.orbSlots ?? []).filter((slot) => event.orbSlots?.includes(slot))
    if (event.cards) {
      restored.scry = {
        kind: event.confirmed ? 'confirmed' : 'choosing', cards: event.cards,
        discarded: (event.context.scryDiscardUids ?? []).filter((uid) => event.cards!.some((card) => card.uid === uid)),
        context: event.contextValid === false ? null : {
          ...event.context,
          ...(event.context.chamberUids === undefined ? {} : { chamberUids: restored.chamber }),
          ...(event.context.loadUids === undefined ? {} : { loadUids: restored.load }),
          ...(event.context.exhaustUids === undefined ? {} : { exhaustUids: restored.exhaust }),
          ...(event.context.orbSlots === undefined ? {} : { orbSlots: restored.orbs }),
        },
      }

    }
    return restored
  }
  if (state.kind === 'idle') return state
  if (event.type === 'chamber' || event.type === 'load' || event.type === 'exhaust') {
    return { ...state, [event.type]: event.uids }
  }
  if (event.type === 'clearPreview') return { ...state, scry: { kind: 'none' } }
  if (event.type === 'toggleOrb') return {
    ...state, orbs: state.orbs.includes(event.slot) ? state.orbs.filter((slot) => slot !== event.slot)
      : state.orbs.length < event.maximum ? [...state.orbs, event.slot] : state.orbs,
  }
  if (state.scry.kind === 'none') return state
  if (event.type === 'toggleScry') {
    if (!state.scry.cards.some((card) => card.uid === event.uid)) return state
    return { ...state, scry: { ...state.scry,
      discarded: state.scry.discarded.includes(event.uid)
        ? state.scry.discarded.filter((uid) => uid !== event.uid) : [...state.scry.discarded, event.uid] } }
  }
  if (event.type === 'gemContext') return { ...state, scry: { ...state.scry, context: event.context } }
  if (event.type === 'confirmScry') return {
    ...state, scry: { ...state.scry, kind: event.confirmed ? 'confirmed' : 'choosing' },
  }
  return state
}

export function powerSelectionValues(state: PowerSelection) {
  const active = state.kind === 'selecting' ? state : null
  const scry = active?.scry.kind !== 'none' ? active?.scry : null
  return {
    pendingPowerUid: active?.powerUid ?? null,
    powerChamberUids: active?.chamber ?? [],
    powerLoadUids: active?.load ?? [],
    powerExhaustUids: active?.exhaust ?? [],
    powerOrbSlots: active?.orbs ?? [],
    powerChoiceCards: scry?.cards ?? null,
    powerScryDiscardUids: scry?.discarded ?? [],
    powerGemContext: scry?.context ?? null,
    powerScryConfirmed: scry?.kind === 'confirmed',
  }
}

export function powerRequirements(combat: CombatState, viewerId: string, powerUid: string | null) {
  const viewer = combat.players.find((player) => player.id === viewerId)
  const power = viewer?.powers.find((power) => power.uid === powerUid)
  const def = power ? faceOf(cardDef(power.defId), power.upgraded) : null
  const needsEnemy = Boolean(viewer && power && def &&
    cardNeedsEnemy(def, viewer, true, undefined, true, power.attachedGemId))
  const needsAlly = Boolean(viewer && power && def &&
    guardianCardNeedsAlly(def, viewer, power.attachedGemId) &&
    combat.players.filter((player) => !player.dead).length > 1)
  return {
    pendingPower: power, pendingPowerDef: def,
    creativeAiEffect: def?.effects.find((effect) => effect.kind === 'removeOrbsForDiscardTop'),
    pendingPowerNeedsEnemy: needsEnemy, pendingPowerNeedsAlly: needsAlly,
    pendingPowerNeedsGemChoice: Boolean(power?.attachedGemId && (
      needsEnemy || needsAlly || def?.target === 'row' ||
      power.attachedGemId === 'guardian_jasper' || power.attachedGemId === 'guardian_amethyst'
    )),
  }
}

export function powerActivationChoice(combat: CombatState, viewerId: string, powerUid: string) {
  const viewer = combat.players.find((player) => player.id === viewerId)
  const requirements = powerRequirements(combat, viewerId, powerUid)
  const { pendingPower: power, pendingPowerDef: def, pendingPowerNeedsEnemy, pendingPowerNeedsAlly } = requirements
  if (!viewer || !power || !def?.activeAbility || powerSubmissionCommitted({ powerUid }, combat, viewerId) ||
    !powerActivationAllowed(def, combat, viewer) ||
    def.id === 'hermit_shadow_cloak' && ![...viewer.hand, ...viewer.chamber].some((card) =>
      faceOf(cardDef(card.defId), card.upgraded).type === 'curse') ||
    def.id === 'hermit_black_wind' && (viewer.chamber.length === 0 || viewer.hand.length === 0) ||
    def.effects.some((effect) => effect.kind === 'returnDiscardTop' || effect.kind === 'removeOrbsForDiscardTop') &&
      viewer.discard.length === 0 ||
    requirements.creativeAiEffect && viewer.orbs.every((orb) => orb == null)) return 'blocked'
  if (def.id === 'guardian_gem_finder') return 'preview'
  const needsTarget = def.target === 'row' || pendingPowerNeedsEnemy
  const needsGemChoice = pendingPowerNeedsAlly ||
    power.attachedGemId === 'guardian_jasper' || power.attachedGemId === 'guardian_amethyst'
  return (!needsTarget || livingEnemies(combat).length === 1) && !needsGemChoice &&
    def.id !== 'hermit_shadow_cloak' && def.id !== 'hermit_black_wind' &&
    !requirements.creativeAiEffect && def.id !== 'guardian_revenge_protocol' ? 'submit' : 'select'
}

/** Rebuild only from the owner's authoritative reveal, never from their hidden draw pile. */
export function restorePowerSelection(
  submitted: PowerSubmission, combat: CombatState | VisibleCombat, viewerId: string,
  preview: CombatScreenProps['powerPreview'], confirmed: boolean,
): PowerSelection {
  const viewer = combat.players.find((player) => player.id === viewerId)
  if (!viewer || !activePowerWindow(combat) || combat.startTurnProgress?.forcedCard ||
    !viewer.powers.some((power) => power.uid === submitted.powerUid) ||
    powerSubmissionCommitted(submitted, combat, viewerId)) return { kind: 'idle' }
  const context = submitted.context
  return transitionPowerSelection({ kind: 'idle' }, {
    type: 'restore', powerUid: submitted.powerUid, context, confirmed,
    contextValid: powerContextSurvives(context, combat, viewerId),
    chamber: viewer.chamber?.map((card) => card.uid) ?? [], hand: viewer.hand?.map((card) => card.uid) ?? [],
    orbSlots: viewer.orbs.flatMap((orb, slot) => orb ? [slot] : []),
    cards: preview?.powerUid === submitted.powerUid && preview.id === submitted.powerPreviewId ? preview.cards : undefined,
  })
}

function powerContextSurvives(context: PowerContext, combat: CombatState | VisibleCombat, viewerId: string) {
  const viewer = combat.players.find((player) => player.id === viewerId)
  const alive = combat.enemies.filter((enemy) => !enemy.dead)
  return (!context.enemyUid || alive.some((enemy) => enemy.uid === context.enemyUid)) &&
    (context.enemyRow === undefined || alive.some((enemy) => enemy.row === context.enemyRow)) &&
    (!context.playerId || combat.players.some((player) => player.id === context.playerId && !player.dead)) &&
    (context.exhaustUids ?? []).every((uid) => viewer?.hand?.some((card) => card.uid === uid))
}

export function reconcilePowerSelection(selection: PowerSelection, combat: CombatState, viewerId: string): PowerSelection {
  if (selection.kind === 'idle') return selection
  const viewer = combat.players.find((player) => player.id === viewerId)
  if (!viewer || !activePowerWindow(combat) || combat.startTurnProgress?.forcedCard ||
    !viewer.powers.some((power) => power.uid === selection.powerUid) ||
    powerSubmissionCommitted(selection, combat, viewerId)) return { kind: 'idle' }
  const chamber = selection.chamber.filter((uid) => viewer.chamber.some((card) => card.uid === uid))
  const scry = selection.scry
  return {
    ...selection, chamber,
    load: chamber.length === selection.chamber.length
      ? selection.load.filter((uid) => viewer.hand.some((card) => card.uid === uid)) : [],
    exhaust: selection.exhaust.filter((uid) => viewer.hand.some((card) => card.uid === uid)),
    orbs: selection.orbs.filter((slot) => viewer.orbs[slot] != null),
    scry: scry.kind !== 'none' && scry.context && !powerContextSurvives(scry.context, combat, viewerId)
      ? { ...scry, context: null } : scry,
  }
}
