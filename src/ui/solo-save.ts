import { hasPendingRelicAcquisition, resumeNeow, type RunState } from '../game/run.ts'
import { CHARACTER_IDS, type CharacterId } from '../game/types.ts'
import { DAILY_MODIFIERS, type RunMetaOptions } from '../game/meta.ts'
import { isCardPackId } from '../game/packs.ts'
import { MAX_RUN_KEY_LENGTH } from '../wallet.ts'
import { currentWalletKey } from '../wallet-storage.ts'
import { validSoloRun } from './run-state-validation.ts'

export const SOLO_RUN_KEY = 'sts-solo-run'

export type BuiltRun = {
  count: number
  seed: string
  ascension: number
  chooseYourRelic: boolean
  lastStand: boolean
  characters: CharacterId[]
  meta: RunMetaOptions
  /** The wallet ledger's key for this run's boss coins; drawn fresh at every start, absent on older saves. */
  coinKey?: string
  /**
   * The wallet of the account that started the run (`currentWalletKey()`): only it is
   * paid when the result is recorded. Absent on older saves, which pay whoever records.
   */
  owner?: string
}

export type SoloRunSave = {
  version: 1
  run: RunState
  built: BuiltRun
  /** Whole-run opening snapshot, including RNG and shared supplies. */
  combatStart?: RunState | null
  lootStart?: RunState | null
  roomStart?: RunState | null
  terminalRun?: RunState | null
  recordRunId?: string | null
  runLogExtractedRunId?: string | null
}

export const sameCombat = (checkpoint: RunState | null | undefined, run: RunState): boolean =>
  checkpoint?.phase === 'combat' && checkpoint.seed === run.seed &&
  checkpoint.campaign.runId === run.campaign.runId && Boolean(checkpoint.combat) &&
  checkpoint.combat?.combatId === run.combat?.combatId

export const unfinishedCombat = (run: RunState): boolean =>
  run.phase === 'combat' && Boolean(run.combat) && run.combat?.phase !== 'won' && run.combat?.phase !== 'lost'

export const sameLoot = (checkpoint: RunState | null | undefined, run: RunState): boolean =>
  checkpoint?.phase === 'reward' && run.phase === 'reward' && checkpoint.seed === run.seed &&
  checkpoint.campaign.runId === run.campaign.runId && checkpoint.act === run.act &&
  checkpoint.map.position === run.map.position && checkpoint.combatsFinished === run.combatsFinished

export const restartableRoom = (run: RunState | null | undefined): boolean =>
  run?.phase === 'room' && (run.roomState?.kind === 'merchant' || run.roomState?.kind === 'event')

export const sameRoom = (checkpoint: RunState | null | undefined, run: RunState): boolean =>
  checkpoint != null && restartableRoom(checkpoint) && checkpoint.seed === run.seed &&
  checkpoint.campaign.runId === run.campaign.runId && checkpoint.act === run.act &&
  checkpoint.map.position === run.map.position && JSON.stringify(checkpoint.setup) === JSON.stringify(run.setup) &&
  (run.phase === 'room' || run.phase === 'combat' && run.combat?.phase !== 'lost' || run.phase === 'reward' ||
    run.phase === 'map' && hasPendingRelicAcquisition(run))

export function savedSoloRun(): SoloRunSave | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SOLO_RUN_KEY) ?? 'null') as Partial<SoloRunSave> | null
    const run = saved?.run as Partial<RunState> | undefined
    const built = saved?.built as Partial<BuiltRun> | undefined
    const completed = run?.campaign?.finalized === true && saved?.terminalRun?.campaign?.runId === run.campaign.runId
    return saved?.version === 1 && (run?.campaign?.finalized === false || completed) && validSoloRun(run) &&
      (saved.combatStart == null || validSoloRun(saved.combatStart) && sameCombat(saved.combatStart, run)) &&
      (saved.lootStart == null || validSoloRun(saved.lootStart) && sameLoot(saved.lootStart, run)) &&
      (saved.roomStart == null || validSoloRun(saved.roomStart) && sameRoom(saved.roomStart, run)) &&
      built?.count === 1 && typeof built.seed === 'string' && typeof built.ascension === 'number' &&
      typeof built.chooseYourRelic === 'boolean' && typeof built.lastStand === 'boolean' &&
      Array.isArray(built.characters) && built.characters.every((character) => CHARACTER_IDS.includes(character)) &&
      built.meta !== null && typeof built.meta === 'object' && !Array.isArray(built.meta) &&
      (built.meta.mode === undefined || ['standard', 'daily', 'custom'].includes(built.meta.mode)) &&
      (built.meta.modifiers === undefined || Array.isArray(built.meta.modifiers) && built.meta.modifiers.every((id) =>
        DAILY_MODIFIERS.some((modifier) => modifier.id === id))) &&
      (built.meta.quickStartAct === undefined || [1, 2, 3, 4].includes(built.meta.quickStartAct)) &&
      (built.meta.ruleset === undefined || built.meta.ruleset === 'base' || built.meta.ruleset === 'downfall') &&
      (built.meta.campaign === undefined || built.meta.campaign === 'base' || built.meta.campaign === 'downfall') &&
      (built.meta.dailyDate === undefined || typeof built.meta.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(built.meta.dailyDate)) &&
      (built.meta.cardPacks === undefined || Array.isArray(built.meta.cardPacks) && built.meta.cardPacks.every(isCardPackId)) &&
      (built.coinKey === undefined || typeof built.coinKey === 'string' && built.coinKey.length > 0 && built.coinKey.length <= MAX_RUN_KEY_LENGTH) &&
      (built.owner === undefined || typeof built.owner === 'string' && built.owner.length > 0 && built.owner.length <= MAX_RUN_KEY_LENGTH) &&
      // Another account's run is never offered to the one signed in now.
      ownsRun(built as BuiltRun)
      ? { ...saved as SoloRunSave, built: legacyDailyAsStandard(built as BuiltRun), run: completed ? run as RunState : resumeNeow(run as RunState) }
      : null
  } catch {
    return null
  }
}

/** A save from before the shared-seed Daily Climb cannot rebuild a daily run without its day. */
function legacyDailyAsStandard(built: BuiltRun): BuiltRun {
  return built.meta.mode === 'daily' && !built.meta.dailyDate ? { ...built, meta: { ...built.meta, mode: 'standard' } } : built
}

/** Whether the account signed in now started this run (older saves name no owner). */
export const ownsRun = (built: Pick<BuiltRun, 'owner'>): boolean => built.owner === undefined || built.owner === currentWalletKey()
