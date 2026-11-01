import type { RunState } from '../game/run.ts'
import { CHARACTER_IDS } from '../game/types.ts'

const RUN_PHASES = new Set(['neow', 'map', 'combat', 'reward', 'betweenCombat', 'room', 'setup', 'victory', 'defeat'])

function resumablePhase(run: Partial<RunState>): boolean {
  if (run.phase === 'combat') return run.combat !== null && typeof run.combat === 'object' &&
    Array.isArray(run.combat.players) && Array.isArray(run.combat.enemies) && Array.isArray(run.combat.pendingSummons)
  if (run.phase === 'neow') return run.neow !== null && typeof run.neow === 'object' &&
    Array.isArray(run.neow.deck) && run.neow.players !== null && typeof run.neow.players === 'object'
  if (run.phase === 'setup') return run.setup !== null && typeof run.setup === 'object' && Array.isArray(run.setup.playerIds)
  if (run.phase === 'reward') return Boolean(run.rewards?.length || run.pendingGuardianSockets?.length ||
    run.players?.some((player) => player.relics.some((relic) => relic.pending)))
  if (run.phase === 'betweenCombat') return typeof run.pendingBossDefId === 'string'
  if (run.phase === 'room') return (typeof run.map?.position === 'string' && Boolean(run.map.rooms?.[run.map.position])) ||
    (run.setup !== null && typeof run.setup === 'object' && run.roomState?.kind === 'merchant')
  return true
}

/** Recoverable local saves deliberately allow more legacy state than imported recordings. */
export function validSoloRun(run: Partial<RunState> | undefined): run is RunState {
  return run?.players?.length === 1 &&
    isRunPhase(run.phase) && typeof run.seed === 'number' &&
    typeof run.rng?.seed === 'number' && typeof run.rng.calls === 'number' && run.campaignProgress !== null &&
    typeof run.campaignProgress === 'object' && run.map?.rooms !== null && typeof run.map?.rooms === 'object' &&
    Array.isArray(run.map.rows) && run.enemyDecks !== null && typeof run.enemyDecks === 'object' &&
    Array.isArray(run.potionDeck) && Array.isArray(run.relicDeck) && Array.isArray(run.bossRelicDeck) &&
    Array.isArray(run.guardianGemDeck) && Array.isArray(run.pendingGuardianSockets) && Array.isArray(run.rewards) &&
    run.itemDecks !== null && typeof run.itemDecks === 'object' && Array.isArray(run.eventDeck) &&
    run.courier !== null && typeof run.courier === 'object' && run.meta !== null &&
    typeof run.meta === 'object' && Array.isArray(run.meta.modifierIds) && Array.isArray(run.log) &&
    // A run saved when Kratos was a character cannot continue: the engine no longer has him.
    run.players.every((player) => typeof player?.id === 'string' && CHARACTER_IDS.some((id) => id === player.character) && Array.isArray(player.deck) &&
      Array.isArray(player.relics) && Array.isArray(player.potions)) && resumablePhase(run)
}

export const isRunPhase = (value: unknown): value is RunState['phase'] => typeof value === 'string' && RUN_PHASES.has(value)
