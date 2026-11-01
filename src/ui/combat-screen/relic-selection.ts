import { activePowerWindow, canActivateRelic, isPostRollStartTurnRelicChoice, overflowShivCount } from '../../game/combat.ts'
import type { CombatState, RelicContext } from '../../game/combat.ts'
import { relicDef } from '../../game/relics.ts'
import type { VisibleCombat } from '../../multiplayer/useRoomSession.ts'
import { gainedShivs } from './card-play-requirements.ts'

type RelicIdentity = { relicIndex: number; defId: string }
export type RelicSelection =
  | { kind: 'idle' }
  | (RelicIdentity & { kind: 'cards'; picked: string[] })
  | (RelicIdentity & { kind: 'scry'; scryId: number; picked: string[] })
  | (RelicIdentity & { kind: 'overflow'; required: number; targets: string[] })

export function relicUsable(combat: CombatState, viewerId: string, relicIndex: number, postRollLocked = false) {
  const viewer = combat.players.find((player) => player.id === viewerId)
  return Boolean(viewer && canActivateRelic(combat, viewer, relicIndex) &&
    !(postRollLocked && isPostRollStartTurnRelicChoice(combat, viewer, relicIndex)))
}

export function reconcileRelicSelection(
  selection: RelicSelection, combat: CombatState | VisibleCombat, viewerId: string, usable = true,
): RelicSelection {
  const viewer = combat.players.find((player) => player.id === viewerId)
  if (!viewer) return { kind: 'idle' }
  const scry = combat.pendingRelicScry
  if (scry) {
    if (scry.playerId !== viewerId) return { kind: 'idle' }
    const held = viewer.relics[scry.relicIndex]
    if (!held) return { kind: 'idle' }
    const picked = selection.kind === 'scry' && selection.scryId === scry.id ? selection.picked : []
    return { kind: 'scry', relicIndex: scry.relicIndex, defId: held.defId, scryId: scry.id,
      picked: picked.filter((uid) => scry.cards?.some((card) => card.uid === uid)) }
  }
  if (selection.kind === 'idle') return selection
  if (selection.kind === 'scry' || !usable || !activePowerWindow(combat) || combat.startTurnProgress?.forcedCard ||
    viewer.relics[selection.relicIndex]?.defId !== selection.defId ||
    viewer.relics[selection.relicIndex]?.spent) return { kind: 'idle' }
  if (selection.kind === 'cards') return {
    ...selection, picked: selection.picked.filter((uid) => viewer.hand?.some((card) => card.uid === uid)),
  }
  const amount = gainedShivs(relicDef(selection.defId).effects) || 2
  const required = overflowShivCount(combat, amount)
  if (!required) return { kind: 'idle' }
  const alive = new Set(combat.enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.uid))
  return { ...selection, required,
    targets: required === selection.required ? selection.targets.filter((uid) => alive.has(uid)) : [] }
}

export function toggleRelicCard(selection: RelicSelection, uid: string, maximum: number): RelicSelection {
  if (selection.kind !== 'cards' && selection.kind !== 'scry' || maximum < 1) return selection
  return { ...selection, picked: selection.picked.includes(uid)
    ? selection.picked.filter((picked) => picked !== uid)
    : maximum === 1 ? [uid] : selection.picked.length < maximum ? [...selection.picked, uid] : selection.picked }
}

export function restoreRelicSelection(
  selection: RelicSelection, context: RelicContext, combat: CombatState | VisibleCombat, viewerId: string,
  usable = true,
): RelicSelection {
  const restored = selection.kind === 'cards' ? { ...selection, picked: context.cardUids ?? selection.picked }
    : selection.kind === 'scry' ? { ...selection, picked: context.scryDiscardUids ?? selection.picked }
      : selection.kind === 'overflow' ? { ...selection, targets: context.shivEnemyUids ?? selection.targets } : selection
  return reconcileRelicSelection(restored, combat, viewerId, usable)
}
