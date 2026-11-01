import type { CombatView } from '../../game/combat/view.ts'
import type { VisibleCombat } from '../../protocol/room.ts'

export function independentPlayerTurn(combat: VisibleCombat | null | undefined) {
  return combat?.phase === 'player' || combat?.phase === 'copy' && combat.pendingCardCopy?.resumePhase === 'player'
}

export function onlineCombatView(visibleCombat: VisibleCombat, viewerId: string) {
  const asyncPlayerTurn = independentPlayerTurn(visibleCombat)
  const visibleProgress = visibleCombat.startTurnProgress
  return {
    ...visibleCombat,
    startTurnProgress: visibleProgress ? {
      ...visibleProgress,
      forcedCard: asyncPlayerTurn && visibleProgress.forcedCard?.playerId !== viewerId
        ? undefined : visibleProgress.forcedCard,
    } : undefined,
    pendingCardCopy: asyncPlayerTurn && visibleCombat.pendingCardCopy?.playerId !== viewerId
      ? undefined : visibleCombat.pendingCardCopy,
    pendingTriggers: asyncPlayerTurn || visibleCombat.phase === 'start'
      ? visibleCombat.pendingTriggers.filter((trigger) => trigger.playerId === viewerId)
      : visibleCombat.pendingTriggers,
    pendingPlunderSwitches: asyncPlayerTurn
      ? visibleCombat.pendingPlunderSwitches?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingPlunderSwitches,
    pendingDieRelicChoices: asyncPlayerTurn
      ? visibleCombat.pendingDieRelicChoices?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingDieRelicChoices,
    pendingHermitSetupLoads: asyncPlayerTurn
      ? visibleCombat.pendingHermitSetupLoads?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingHermitSetupLoads,
    pendingHermitChamberPlays: asyncPlayerTurn
      ? visibleCombat.pendingHermitChamberPlays?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingHermitChamberPlays,
    pendingHermitStrengthRewards: asyncPlayerTurn
      ? visibleCombat.pendingHermitStrengthRewards?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingHermitStrengthRewards,
    // Slayer Pack: another seat's card choice never blocks this seat's Player Turn.
    pendingPlayerChoices: asyncPlayerTurn
      ? visibleCombat.pendingPlayerChoices?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingPlayerChoices,
    pendingSlayerChoices: asyncPlayerTurn
      ? visibleCombat.pendingSlayerChoices?.filter((choice) => choice.playerId === viewerId)
      : visibleCombat.pendingSlayerChoices,
    knowledge: {
      viewerId,
      drawOrder: 'unknown',
      stanceChangedThisTurn: visibleCombat.viewerStanceChangedThisTurn,
      discardedThisTurn: visibleCombat.viewerDiscardedThisTurn,
    },
    pendingDistilled: visibleCombat.pendingDistilled &&
    (!asyncPlayerTurn || visibleCombat.pendingDistilled.playerId === viewerId)
      ? visibleCombat.pendingDistilled : undefined,
    pendingRelicScry: visibleCombat.pendingRelicScry &&
    (!asyncPlayerTurn || visibleCombat.pendingRelicScry.playerId === viewerId)
      ? visibleCombat.pendingRelicScry : undefined,
  } satisfies CombatView
}
