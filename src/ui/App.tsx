import { SOLO_RUN_KEY, sameCombat, unfinishedCombat, sameLoot, restartableRoom, sameRoom,
  savedSoloRun, ownsRun, type BuiltRun, type SoloRunSave } from './solo-save.ts'
import { validSoloRun } from './run-state-validation.ts'
import { TreasureEffects } from "./TreasureEffects.tsx"
import { MapDrawingProvider } from './MapDrawing.tsx'
import { useKeywordHelp } from './useKeywordHelp.ts'
import { DeveloperConsole } from './DeveloperConsole.tsx'
import { ConsoleCommandError, executeConsoleCommand } from './developer-commands.ts'
import { RunHeader } from './RunHeader.tsx'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from './Tooltip.tsx'
import { useControlPress } from './useControlPress.ts'
import { flushSync } from 'react-dom'
import { orderStartTurnScries, resolveHermitSetupLoad, resolveStartTurnScry, type CombatState } from '../game/combat.ts'
import { preloadImages, releasePreloadedImages } from '../game/assets.ts'
import {
  advanceAct,
  advanceQuickSetup,
  canGiveUpRun,
  canRerollDownfallSelfBoss,
  canSkipEvent,
  choosePendingRelicReward,
  chooseNeow,
  decideCourier,
  chooseEvent,
  chooseRelicReward,
  createRun,
  enterRoom,
  hasPendingRelicAcquisition,
  leaveRoom,
  finishMerchant,
  finishRewardsIfComplete,
  finishRun,
  giveUpRun,
  purchaseAtMerchant,
  removeAtCurrentMerchant,
  resolveCampfire,
  resolveNeowEffect,
  revealNeowReward,
  neowPreview,
  resolveNeowReward,
  revealCardReward,
  rerollDownfallSelfBoss,
  unavailableEventOptionIds,
  resolveRelicReward,
  resolveBossRelicReward,
  resolveGoldReward,
  resolvePotionReward,
  resolveTransformReward,
  pendingRelicPreview,
  resolvePendingRelic,
  resolveGuardianSocket,
  resolveCardRewards,
  resolveCombat,
  revealCourier,
  roomChoices,
  startPendingBoss,
  switchBetweenCombatRow,
  tradePotion,
  usePotionOutsideCombat,
  victoryIsTerminal,
  visibleMap,
  wingBootChoices,
  skipEvent,
} from '../game/run.ts'
import type { RunState } from '../game/run.ts'
import { createRng, seedFromString } from '../game/rng.ts'
import type { CharacterId } from '../game/types.ts'
import { visualId } from '../game/skins.ts'
import { preferredSkin } from '../skin-preference.ts'
import { SkinProvider } from './skin-context.tsx'
import { hasRoomSession, validRoomSessions } from '../multiplayer/useRoomSession.ts'
import { isActIVUnlocked } from '../game/campaign.ts'
import { allocateSharedMarks, canEnterActIV } from '../game/campaign.ts'
import type { CampaignProgress } from '../game/campaign.ts'
import { CAMPAIGN_EVENT, campaignKey, savedCampaign, saveCampaign, syncAccountAscension } from '../campaign-storage.ts'
import { dailySeedText } from '../game/daily.ts'
import { useUtcDay } from './useUtcDay.ts'
import { eventCanStartCombat } from '../game/events.ts'
import { MapScreen } from './MapScreen.tsx'
import { CampfireScreen } from './CampfireScreen.tsx'
import { RewardScreen } from './RewardScreen.tsx'
import { refreshCombatRelic, relicDef } from '../game/relics.ts'
import { OutsidePotionBar } from './OutsidePotionBar.tsx'
import { PotionSlots } from './PotionSlots.tsx'
import { GuardianSocketPanel, RelicResolvePanel } from './RelicResolvePanel.tsx'
import { StartMenu } from './StartMenu.tsx'
import { TutorialCoach } from './TutorialCoach.tsx'
import { tutorialChapters, tutorialSeed } from './tutorial/index.ts'
import { createTutorialRun, enterTutorialRoom } from './tutorial/run.ts'
import { GiveUpPanel } from './GiveUpPanel.tsx'
import { CourierPanel, CourierPeek, courierPeekPhase } from './CourierPanel.tsx'
import { RoomScreen } from './RoomScreen.tsx'
import { NeowScreen } from './NeowScreen.tsx'
import { QuickSetupScreen } from './QuickSetupScreen.tsx'
import { CardMorph, CardMorphAnnouncement } from './CardMorph.tsx'
import { CardInspectionProvider } from './CardInspectionProvider.tsx'
import { RunSummary, summarySeat } from './RunSummary.tsx'
import { useCardMorphs } from './useCardMorphs.ts'
import { usePrefersReducedMotion } from './combat-screen/hooks.ts'
import {
  COMBAT_OUTCOME_DELAY_MS,
  COMBAT_OUTCOME_SOUND_DELAY_MS,
  combatOutcomeAnimationActive,
} from './combat-screen/vfx.tsx'
import { cardDef, faceOf } from '../game/cards.ts'
import { currentQuickSetupStep, DAILY_MODIFIERS, rollDailyModifiers } from '../game/meta.ts'
import type { DailyModifierId, RunMetaOptions, RunMode } from '../game/meta.ts'
import { installSoundEffects, playSoundEffect, useCombatMusic, useRunOutcomeSound, useVictoryMusic } from './sfx.ts'
import { SettingsDialog } from './SettingsDialog.tsx'
import { LeaderboardScreen } from './LeaderboardScreen.tsx'
import { StatsScreen } from './StatsScreen.tsx'
import { ProfileScreen } from './ProfileScreen.tsx'
import { useGameSettings } from './game-settings.ts'
import { wingBootUses } from './wing-boots.ts'
import type { GameSettings } from './game-settings.ts'
import { useWebMcp } from './useWebMcp.ts'
import { ReplayBar } from './ReplayBar.tsx'
import { ReplaySession } from './run-replay.ts'
import { flushLeaderboardOutbox, queueFinishedSoloRun } from '../leaderboard.ts'
import { coinsOwed } from '../game/coins.ts'
import { enabledCardPacks, soloRunKey } from '../wallet.ts'
import { ACCOUNT_WALLETS, creditRunCoins, currentWalletKey, savedWallet, syncAccountWallet } from '../wallet-storage.ts'
import { CoinGainToast, type CoinGain } from './Coins.tsx'
import { isRestricted, onProfileChange, PROFILE_KEY, savedProfile, SPIRE_REJECTION } from '../profile.ts'
import {
  applyRunLogEvent,
  discardRunLog,
  downloadRunLog,
  playRunLog,
  readRunLog,
  startRunLog,
  useRunLog,
  type RunLog,
} from './run-log.ts'

const SINGLE_PLAYER_ONLY = import.meta.env.VITE_SINGLE_PLAYER === 'true'
const CombatScreen = lazy(() => import('./CombatScreen.tsx').then((module) => ({ default: module.CombatScreen })))
const OnlineGame = SINGLE_PLAYER_ONLY ? null : lazy(() => import('./OnlineGame.tsx').then((module) => ({ default: module.OnlineGame })))
const CompendiumScreen = lazy(() => import('./CompendiumScreen.tsx').then((module) => ({ default: module.CompendiumScreen })))
const ShopScreen = lazy(() => import('./ShopScreen.tsx').then((module) => ({ default: module.ShopScreen })))
const COMBAT_VFX = [
  'combat/vfx/hit-burst.webp', 'combat/vfx/death-ash.webp', 'combat/vfx/death-ring.webp',
  ...[
    'awakened-blue-fire', 'awakened-claw-scratch', 'watcher-calm-aura', 'watcher-wrath-aura',
    'guard-bloom', 'hexaghost-flame-impact', 'hexaghost-flame', 'dark-channel', 'defect-face-orb',
    'frost-channel', 'ironclad-bash', 'ironclad-strike', 'lightning-channel', 'turn-lightning-strike',
    'magic-burst', 'potion-burst', 'silent-knife', 'silent-poison', 'silent-shiv', 'watcher-pray',
    'watcher-meteor-impact', 'watcher-meteor', 'defect-lightning-beam', 'defect-dark-beam', 'speed-trail',
  ].map((name) => `combat/vfx/actions/${name}.webp`),
]

const ROSTER: { character: CharacterId; name: string }[] = [
  { character: 'ironclad', name: 'Ironclad' },
  { character: 'silent', name: 'Silent' },
  { character: 'defect', name: 'Defect' },
  { character: 'watcher', name: 'Watcher' },
  { character: 'slime_boss', name: 'Slime Boss' },
  { character: 'guardian', name: 'Guardian' },
  { character: 'hexaghost', name: 'Hexaghost' },
  { character: 'hermit', name: 'Hermit' },
]
const DEFAULT_CHARACTERS = ROSTER.map((entry) => entry.character)

function legalCharacters(selected: readonly CharacterId[]): CharacterId[] {
  const result: CharacterId[] = []
  for (let seat = 0; seat < ROSTER.length; seat += 1) {
    const wanted = selected[seat]
    result.push(wanted && !result.includes(wanted)
      ? wanted
      : DEFAULT_CHARACTERS.find((character) => !result.includes(character))!)
  }
  return result
}

function newRun(playerCount: number, seedText: string, ascension = 0, progress = savedCampaign(), chooseYourRelic = false, lastStand = false, selected = DEFAULT_CHARACTERS, meta: RunMetaOptions = {}): RunState {
  const party = legalCharacters(selected).slice(0, playerCount).map((character, index) => ({
    id: `p${index + 1}`,
    name: ROSTER.find((entry) => entry.character === character)!.name,
    character,
    // Presentation only: the skin this account has chosen for the hero, frozen into the run.
    skin: preferredSkin(character),
  }))
  return createRun(seedFromString(seedText), party, Math.min(ascension, progress.highestAscension), progress, chooseYourRelic, lastStand, meta)
}

/** The player's own journal; a Daily Climb runs on a shared baseline instead. */
function campaignBeforeCurrentRun(run: RunState): CampaignProgress {
  if (run.meta.dailyDate !== undefined) {
    // The climb still used a run number, so the next run must not reuse its id.
    const journal = savedCampaign()
    return { ...journal, nextRunNumber: Math.max(journal.nextRunNumber, run.campaignProgress.nextRunNumber) }
  }
  return {
    ...run.campaignProgress,
    nextRunNumber: run.campaign.finalized ? run.campaignProgress.nextRunNumber : Math.max(0, run.campaignProgress.nextRunNumber - 1),
    highestAscension: Math.max(run.campaignProgress.highestAscension, savedCampaign().highestAscension),
  }
}

function campaignBeforePendingRun(run: RunState): CampaignProgress {
  return run.meta.dailyDate !== undefined || !run.campaign.finalized && run.campaignProgress.unspentMarks > 0
    ? campaignBeforeCurrentRun(run)
    : run.campaignProgress
}

export function App() {
  useControlPress()
  useWebMcp()
  const [account, setAccount] = useState(() => savedProfile()?.token)
  // Refresh account coins and Ascension on visits, account changes and reconnects.
  useEffect(() => {
    let active = true
    const settle = () => {
      if (active && document.visibilityState !== 'hidden') {
        void syncAccountWallet().catch(() => {})
        void syncAccountAscension().catch(() => {})
      }
    }
    if (!ACCOUNT_WALLETS) return () => { active = false }
    settle()
    const changedAccount = () => {
      const next = savedProfile()?.token
      if (next !== account) setAccount(next)
      settle()
    }
    const stop = onProfileChange(changedAccount)
    const storage = (event: StorageEvent) => { if (event.key === PROFILE_KEY || event.key === null) changedAccount(); else if (event.key === campaignKey()) settle() }
    const timer = window.setInterval(settle, 15_000)
    window.addEventListener(CAMPAIGN_EVENT, settle)
    window.addEventListener('focus', settle)
    window.addEventListener('online', settle)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', settle)
    return () => {
      active = false; stop(); window.clearInterval(timer)
      window.removeEventListener(CAMPAIGN_EVENT, settle)
      window.removeEventListener('focus', settle)
      window.removeEventListener('online', settle)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', settle)
    }
  }, [account])
  const [online, setOnline] = useState<boolean | null>(() => !SINGLE_PLAYER_ONLY && hasRoomSession() ? null : false)
  useEffect(() => {
    if (SINGLE_PLAYER_ONLY || online !== null) return
    let active = true
    void validRoomSessions().then((valid) => {
      if (active) setOnline(valid.length > 0)
    }, () => { if (active) setOnline(false) })
    return () => { active = false }
  }, [online])
  const [settings, setSettings] = useGameSettings()
  useEffect(() => {
    // Mouse activation is not keyboard selection. Touch keeps focus for its
    // first-tap card/tooltips previews, and form fields keep native editing.
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !(event.target instanceof Element)) return
      if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="option"]')) return
      const control = event.target.closest('button, a[href], summary, [tabindex], [role="button"]')
      if (!control) return
      event.preventDefault()
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    document.addEventListener('pointerdown', pointerDown, true)
    return () => document.removeEventListener('pointerdown', pointerDown, true)
  }, [])
  useEffect(() => settings.sfxVolume > 0 ? installSoundEffects(true) : undefined, [settings.sfxVolume])
  useEffect(() => {
    if (document.querySelector('link[data-combat-vfx]')) return
    void preloadImages(COMBAT_VFX, { fetchPriority: 'low' })
    return () => releasePreloadedImages(COMBAT_VFX)
  }, [])
  useKeywordHelp()
  return (
    <SkinProvider>
    <CardInspectionProvider>
    <Suspense fallback={<main className="app-loading" role="status">Loading…</main>}>
      {online === null ? <main className="app-loading" role="status">Loading…</main> : <>
      <div className="game-mode" hidden={online}>
        <LocalGame key={account} onOnline={SINGLE_PLAYER_ONLY ? undefined : () => setOnline(true)}
          settings={settings} onSettings={setSettings} active={!online} />
      </div>
      {online && OnlineGame ? <OnlineGame onLocal={() => setOnline(false)} settings={settings} onSettings={setSettings} /> : null}
      </>}
    </Suspense>
    </CardInspectionProvider>
    </SkinProvider>
  )
}

function LocalGame({ onOnline, settings, onSettings, active }: {
  onOnline?: () => void
  settings: GameSettings
  onSettings: (settings: GameSettings) => void
  active: boolean
}) {
  // A remount must return to the menu, not autosave an unstarted replacement run.
  const [open, setOpen] = useState(false)
  const onOpen = () => setOpen(true)
  const onClose = () => setOpen(false)
  const [seedText, setSeedText] = useState<string>(() => crypto.randomUUID())
  const [ascension, setAscension] = useState(0)
  const [characters, setCharacters] = useState<CharacterId[]>(() => [...DEFAULT_CHARACTERS])
  const [chooseYourRelic, setChooseYourRelic] = useState(false)
  const [lastStand, setLastStand] = useState(false)
  const [mode, setMode] = useState<RunMode>('standard')
  const [customModifierIds, setCustomModifierIds] = useState<DailyModifierId[]>([])
  const [quickStartAct, setQuickStartAct] = useState<1 | 2 | 3 | 4>(1)
  const [run, setRun] = useState<RunState>(() => newRun(1, crypto.randomUUID()))
  const [journalAscension, setJournalAscension] = useState(() => savedCampaign().highestAscension)
  const [resume, setResume] = useState<SoloRunSave | null>(savedSoloRun)
  const [resumePending, setResumePending] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const resuming = useRef(false)
  const combatStart = useRef<RunState | null>(null)
  const lootStart = useRef<RunState | null>(null)
  const roomStart = useRef<RunState | null>(null)
  const [runLogRestoration, setRunLogRestoration] = useState(0)
  const [consoleRewindEpoch, setConsoleRewindEpoch] = useState(0)
  // Play in progress belongs to the account that started it: profile.ts clears the
  // saved run on an account change, so the Resume offered here follows the save.
  const ownership = useRef<{ open: boolean; built: Pick<BuiltRun, 'owner'>; playing: boolean }>({ open, built: {}, playing: false })
  useEffect(() => {
    const refresh = () => {
      setResume(savedSoloRun())
      // A run left open in this tab belongs to the account that started it: leave it
      // when another account signs in (here or in another tab).
      const current = ownership.current
      if (current.open && current.playing && !ownsRun(current.built)) onClose()
    }
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === PROFILE_KEY || event.key === SOLO_RUN_KEY) refresh() }
    const stop = onProfileChange(refresh)
    window.addEventListener('storage', storage)
    return () => { stop(); window.removeEventListener('storage', storage) }
  }, [])
  const [choosingNextCharacter, setChoosingNextCharacter] = useState(false)
  const prefersReducedMotion = usePrefersReducedMotion()
  const updateCombat = useCallback((next: CombatState) => {
    setRun((current) => ({ ...current, combat: next }))
  }, [])
  useRunOutcomeSound(run, undefined, true,
    settings.reducedMotion || prefersReducedMotion ? 0 : COMBAT_OUTCOME_SOUND_DELAY_MS)
  useCombatMusic(run, active && open && settings.bgmVolume > 0, settings.bgmVolume)
  useVictoryMusic(!run.campaign.finalized && victoryIsTerminal(run, run.campaignProgress), active && open && settings.bgmVolume > 0, settings.bgmVolume)
  const [viewerId, setViewerId] = useState('p1')
  const revealLocalCourier = useCallback((kind: 'relic' | 'potion') => setRun((current) => revealCourier(current, viewerId, kind)), [viewerId])
  const [compendium, setCompendium] = useState(false)
  const [leaderboard, setLeaderboard] = useState(false)
  const [stats, setStats] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [shop, setShop] = useState<false | 'packs' | 'skins'>(false)
  const [coinGain, setCoinGain] = useState<CoinGain | null>(null)
  const clearCoinGain = useCallback(() => setCoinGain(null), [])
  const [giveUpOpen, setGiveUpOpen] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsReturnToPause, setSettingsReturnToPause] = useState(false)
  const [mapSelectionPending, setMapSelectionPending] = useState(false)
  const pauseDialog = useRef<HTMLDialogElement>(null)
  const runShell = useRef<HTMLElement>(null)
  const queuedLeaderboardRun = useRef<string | null>(null)
  const leaderboardSubmission = useRef<{ id: string; owner: string } | null>(null)
  const [leaderboardStatus, setLeaderboardStatus] = useState<'pending' | 'recorded' | 'queued' | 'rejected' | null>(null)
  const [recordRunId, setRecordRunId] = useState<string | null>(null)
  const [runLogExtractedRunId, setRunLogExtractedRunId] = useState<string | null>(null)
  const [runLogMessage, setRunLogMessage] = useState<string | null>(null)
  const [extractingRunLog, setExtractingRunLog] = useState(false)
  const [replayLog, setReplayLog] = useState<RunLog | null>(null)
  const [replayFinished, setReplayFinished] = useState(false)
  // Bumped by each seek so the screens start clean instead of carrying half-finished picks from the old position.
  const [replayEpoch, setReplayEpoch] = useState(0)
  const [replaySession, setReplaySession] = useState<ReplaySession | null>(null)
  const replayRunner = useRef<{ log: RunLog; controller: AbortController; removeCursor?: () => void; stop?: number } | null>(null)
  const replayReturn = useRef<{ run: RunState; viewerId: string } | null>(null)
  const terminalRun = useRef<RunState | null>(null)
  // The guided tutorial is a throwaway Act I run. The run it interrupted is
  // parked here and restored on exit, and while it lasts nothing is written to
  // the solo checkpoint, the campaign journal, the run log or the leaderboard.
  // `attempt` restarts the coach when the same hero's tutorial is tried again.
  const [tutorial, setTutorial] = useState<{ character: CharacterId; seed: string; attempt: number } | null>(null)
  const [tutorialTipsHidden, setTutorialTipsHidden] = useState(false)
  const tutorialReturn = useRef<{ run: RunState; viewerId: string } | null>(null)
  const tutorialCharacter = tutorial?.character
  const tutorialChapterList = useMemo(() => tutorialCharacter ? tutorialChapters(tutorialCharacter) : [], [tutorialCharacter])
  const { available: runLogAvailable, discard: discardLog, load: loadRunLog } = useRunLog(
    run, active && open && !replayLog && !tutorial, viewerId, runLogRestoration,
  )
  const consoleContext = useRef({ run, active, open, viewerId, replayLog, tutorial })
  consoleContext.current = { run, active, open, viewerId, replayLog, tutorial }
  const [today, refreshToday] = useUtcDay()
  const dailyModifiers = useMemo(() => rollDailyModifiers(createRng(seedFromString(dailySeedText(today)))).modifiers, [today])
  // Set when Embark found the UTC day had turned since the menu was drawn.
  const [dailyTurned, setDailyTurned] = useState(false)
  // For a Daily Climb this reads the stored journal, which only the persist effect writes, from `run`.
  const playerProgress = useMemo(() => campaignBeforeCurrentRun(run), [run.campaignProgress, run.campaign.finalized, run.meta.dailyDate, active, journalAscension])
  // The engine fixes a Daily Climb's seed, Ascension and setup from its day.
  const metaOptions: RunMetaOptions = mode === 'daily' ? { mode, dailyDate: today } : { mode, modifiers: customModifierIds, quickStartAct }
  const canGiveUp = canGiveUpRun(run, run.campaignProgress)
  // The Spire turns a restricted account's runs away: each one is lost the moment it is open.
  const [restricted, setRestricted] = useState(isRestricted)
  useEffect(() => onProfileChange(() => setRestricted(isRestricted())), [])
  const lostToSpire = restricted && !replayLog
  useLayoutEffect(() => {
    if (restricted && open && !tutorial && !replayLog && canGiveUp) setRun(giveUpRun)
  }, [restricted, open, tutorial, replayLog, canGiveUp])

  /** The settings the run in progress was actually built from. */
  const [built, setBuilt] = useState<BuiltRun>({ count: 1, seed: seedText, ascension: 0, chooseYourRelic: false, lastStand: false, characters: [...DEFAULT_CHARACTERS], meta: {} })
  const coinKey = built.coinKey ?? soloRunKey(run.campaign.runId, run.seed)

  const discardSoloRun = () => {
    try { localStorage.removeItem(SOLO_RUN_KEY) } catch { /* Storage is unavailable. */ }
    combatStart.current = null
    lootStart.current = null
    roomStart.current = null
    setResume(null)
    setResumeError(null)
  }

  const resumeSoloRun = async () => {
    if (!resume || resuming.current) return
    resuming.current = true
    setResumePending(true)
    setResumeError(null)
    const owner = currentWalletKey()
    try {
      let restored = resume.run
      const combat = unfinishedCombat(restored)
      const room = restartableRoom(restored) || Boolean(resume.roomStart)
      if (room || combat || restored.phase === 'reward') {
        const matches = room ? sameRoom : combat ? sameCombat : sameLoot
        let checkpoint = room ? resume.roomStart : combat ? resume.combatStart : resume.lootStart
        if (!checkpoint) {
          const log = await readRunLog(restored.campaign.runId)
          if (log) {
            let state = log.initial
            if (matches(state, restored)) checkpoint = state
            for (const event of log.events) {
              if (checkpoint) break
              state = applyRunLogEvent(state, event)
              if (matches(state, restored)) checkpoint = state
            }
          }
        }
        if (!checkpoint || !validSoloRun(checkpoint) || !matches(checkpoint, restored)) {
          throw new Error(`The beginning of this ${room ? 'shop or event' : combat ? 'combat' : 'loot screen'} could not be recovered. Your saved run has not been changed.`)
        }
        restored = structuredClone(checkpoint)
      }
      if (restored.phase !== 'combat') restored = {
        ...restored,
        players: restored.players.map(player => ({ ...player, relics: player.relics.map(refreshCombatRelic) })),
      }
      if (currentWalletKey() !== owner || !ownsRun(resume.built)) {
        throw new Error('The account changed while loading. Please select Resume again.')
      }
      combatStart.current = unfinishedCombat(restored) ? structuredClone(restored) : null
      lootStart.current = restored.phase === 'reward' ? structuredClone(restored) : null
      roomStart.current = restartableRoom(restored) ? structuredClone(restored) : null
      // A Daily Climb's seed, Ascension and setup are fixed, not the player's menu choices.
      if (resume.built.meta.dailyDate === undefined) {
        setSeedText(resume.built.seed)
        setAscension(resume.built.ascension)
        setCustomModifierIds([...(resume.built.meta.modifiers ?? [])])
        setQuickStartAct(resume.built.meta.quickStartAct ?? 1)
      }
      setCharacters(resume.built.characters)
      setChooseYourRelic(resume.built.chooseYourRelic)
      setLastStand(resume.built.lastStand)
      setMode(resume.built.meta.mode ?? 'standard')
      setBuilt(resume.built)
      setRun(restored)
      setRunLogRestoration((generation) => generation + 1)
      terminalRun.current = resume.terminalRun ? structuredClone(resume.terminalRun) : null
      setRecordRunId(resume.recordRunId ?? null)
      setRunLogExtractedRunId(resume.runLogExtractedRunId ?? null)
      setRunLogMessage(null)
      setViewerId('p1')
      setChoosingNextCharacter(false)
      onOpen()
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : 'Could not resume your saved run. Please try again.')
    } finally {
      resuming.current = false
      setResumePending(false)
    }
  }

  const flushQueuedRun = () => void flushLeaderboardOutbox().then(({ recorded, rejected }) => {
    const submission = leaderboardSubmission.current
    if (!submission) return
    const { id, owner } = submission
    if (recorded.includes(id) || rejected.includes(id)) leaderboardSubmission.current = null
    setLeaderboardStatus(recorded.includes(id) ? 'recorded' : rejected.includes(id) ? 'rejected' : 'queued')
    if (recorded.includes(id) && currentWalletKey() === owner) {
      const before = savedWallet().coins
      // An in-flight refresh may predate this payout. Wait for it, then read again.
      void syncAccountWallet().then(() => syncAccountWallet()).then(({ wallet }) => {
        const coins = wallet.coins - before
        if (coins > 0 && currentWalletKey() === owner) setCoinGain((current) => ({ coins, total: wallet.coins, id: (current?.id ?? 0) + 1 }))
      }).catch(() => {})
    }
  })

  useEffect(() => {
    if (replayLog) return
    flushQueuedRun()
    const retry = window.setInterval(flushQueuedRun, 60_000)
    const online = flushQueuedRun
    window.addEventListener('online', online)
    return () => { clearInterval(retry); window.removeEventListener('online', online) }
  }, [replayLog])

  useEffect(() => {
    const dialog = pauseDialog.current
    if (!dialog) return
    if (!active && pauseOpen) {
      setPauseOpen(false)
      return
    }
    if (pauseOpen && !dialog.open) dialog.showModal()
    else if (!pauseOpen && dialog.open) dialog.close()
  }, [active, pauseOpen])

  useEffect(() => {
    if (!active || !open || compendium || giveUpOpen) return undefined
    let timer: number | undefined
    const pause = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || pauseDialog.current?.open || document.querySelector('dialog[open]')) return
      if (event.target instanceof Element && event.target.closest('.powers, .potion-chip, .relic-chip')) return
      if (document.querySelector('.power__zoom, .potion-tip, .relic-chip:hover > .relic-tip, .relic-chip:focus-within > .relic-tip')) return
      timer = window.setTimeout(() => {
        if (!event.defaultPrevented && !document.querySelector('dialog[open]')) setPauseOpen(true)
      })
    }
    document.addEventListener('keydown', pause)
    return () => {
      document.removeEventListener('keydown', pause)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [active, compendium, giveUpOpen, open])

  useEffect(() => {
    if (giveUpOpen && !canGiveUp) setGiveUpOpen(false)
  }, [canGiveUp, giveUpOpen])

  function restart(count: number, seed: string, nextAscension = 0, nextChooseYourRelic = chooseYourRelic, nextLastStand = lastStand, selected = characters, nextMeta: RunMetaOptions = metaOptions) {
    const nextCharacters = legalCharacters(selected)
    const journal = open ? campaignBeforePendingRun(run) : campaignBeforeCurrentRun(run)
    // Every climb shares the day's seed, so its run number alone keeps it distinct on the
    // leaderboard; another tab may already have used this tab's next number.
    const progress = nextMeta.mode === 'daily'
      ? { ...journal, nextRunNumber: Math.max(journal.nextRunNumber, savedCampaign().nextRunNumber) }
      : journal
    const legalAscension = Math.min(nextAscension, progress.highestAscension)
    // The public day seed must never become the random seed of a later Standard run.
    if (nextMeta.mode !== 'daily') setSeedText(seed)
    setAscension(legalAscension)
    setCharacters(nextCharacters)
    setChooseYourRelic(nextChooseYourRelic)
    setLastStand(nextLastStand)
    setViewerId('p1')
    setRecordRunId(null)
    setRunLogExtractedRunId(null)
    setRunLogMessage(null)
    setCoinGain(null)
    setReplayLog(null)
    setReplaySession(null)
    setTutorial(null)
    tutorialReturn.current = null
    terminalRun.current = null
    // Bought Shop packs join every new run except a Daily Climb, whose pools everyone shares.
    const packs = nextMeta.mode === 'daily' ? [] : enabledCardPacks(savedWallet())
    const meta: RunMetaOptions = {
      ...nextMeta,
      ...(packs.length > 0 ? { cardPacks: packs } : {}),
      preventDuplicateCardRewards: settings.preventDuplicateCardRewards,
    }
    const next = newRun(count, seed, legalAscension, progress, nextChooseYourRelic, nextLastStand, nextCharacters, meta)
    // A Daily Climb's engine overrides the requested Ascension; record what was built.
    setBuilt({ count, seed, ascension: next.ascension, chooseYourRelic: nextChooseYourRelic, lastStand: nextLastStand, characters: nextCharacters, meta,
      coinKey: soloRunKey(next.campaign.runId, next.seed, crypto.randomUUID()), owner: currentWalletKey() })
    void startRunLog(next)
    setRun(next)
  }

  const startTutorial = (character: CharacterId) => {
    if (!tutorialReturn.current) tutorialReturn.current = { run, viewerId }
    setViewerId('p1')
    setPauseOpen(false)
    setGiveUpOpen(false)
    setTutorialTipsHidden(false)
    const seed = tutorialSeed(character)
    setTutorial((current) => ({ character, seed, attempt: (current?.attempt ?? 0) + 1 }))
    setRun(createTutorialRun(character, ROSTER.find((entry) => entry.character === character)!.name, seed))
    onOpen()
  }

  const exitTutorial = () => {
    const previous = tutorialReturn.current
    tutorialReturn.current = null
    if (previous) {
      setRun(previous.run)
      setViewerId(previous.viewerId)
    }
    setTutorial(null)
    setPauseOpen(false)
    onClose()
  }

  const recordRunResult = () => {
    // Recording the result is what pays the run's boss coins, once: the ledger
    // refuses a second payment however often this is reached for the same run.
    if (!replayLog && !tutorial && !run.consoleModified) {
      if (!ownsRun(built)) {
        // Another account signed in since this run began (possibly in another tab): its coins are not theirs.
        if (coinsOwed(run.campaign.bossCoins) > 0) setRunLogMessage('This run was started by another account, so its coins were not paid. Sign in to that account to play its runs.')
      } else if (!(run.meta.dailyDate !== undefined && ACCOUNT_WALLETS && savedProfile())) {
        const { coins, total } = creditRunCoins(coinKey, run.campaign.bossCoins)
        if (coins > 0) setCoinGain((current) => ({ coins, total, id: (current?.id ?? 0) + 1 }))
      }
    }
    setRecordRunId(run.campaign.runId)
    // The pre-record snapshot of this run must never be offered again.
    setResume(null)
    setRun((current) => {
      if (current.campaign.finalized) return current
      terminalRun.current = structuredClone(current)
      return finishRun(current)
    })
  }

  const extractRunLog = async () => {
    if (extractingRunLog) return
    setExtractingRunLog(true)
    try {
      const log = await loadRunLog()
      if (!log) return setRunLogMessage('This run log could not be loaded.')
      downloadRunLog(log)
      setRunLogExtractedRunId(log.runId)
      setRunLogMessage('Run log downloaded.')
    } catch (error) {
      setRunLogMessage(error instanceof Error ? error.message : 'Run log extraction failed.')
    } finally { setExtractingRunLog(false) }
  }

  const prepareNextRun = () => {
    discardLog()
    discardSoloRun()
    setSeedText(crypto.randomUUID())
    if (run.meta.mode === 'daily') setMode('standard')
    setChoosingNextCharacter(true)
    onClose()
  }

  const stopReplay = () => {
    const runner = replayRunner.current
    replayRunner.current = null
    if (!runner) return
    clearTimeout(runner.stop)
    runner.controller.abort()
    runner.removeCursor?.()
  }

  const leaveReplay = () => {
    stopReplay()
    const previous = replayReturn.current
    replayReturn.current = null
    if (previous) {
      setRun(previous.run)
      setViewerId(previous.viewerId)
    }
    setReplayLog(null)
    setReplaySession(null)
    setReplayFinished(false)
    setRunLogMessage(null)
  }

  const startReplay = (log: RunLog) => {
    stopReplay()
    setReplayFinished(false)
    replayReturn.current = { run: structuredClone(run), viewerId }
    setRunLogMessage(null)
    setReplayLog(log)
    setReplaySession(new ReplaySession(log))
    setRun(structuredClone(log.initial))
    setViewerId(log.initial.players[0]!.id)
    setCompendium(false)
    setPauseOpen(false)
    setSettingsOpen(false)
    onOpen()
  }

  const launchReplay = (log: RunLog, session: ReplaySession, start?: { position: number; state: RunState }) => {
    const started = { log, controller: new AbortController() } as NonNullable<typeof replayRunner.current>
    replayRunner.current = started
    session.update({ finished: false })
    void playRunLog(log, {
      setRun,
      setViewer: setViewerId,
      reducedMotion: settings.reducedMotion || prefersReducedMotion,
      signal: started.controller.signal,
      pause: () => setPauseOpen(true),
      pace: session,
      start,
      onPosition: (position) => session.update({ position }),
    }).then((removeCursor) => {
      if (started.controller.signal.aborted) removeCursor()
      else {
        started.removeCursor = removeCursor
        session.update({ finished: true, paused: false, position: session.timeline.total })
        setReplayFinished(true)
      }
    }).catch((error) => {
      if (started.controller.signal.aborted) return
      session.update({ finished: true })
      setRunLogMessage(error instanceof Error ? error.message : 'Replay stopped.')
    })
  }

  // Jumping restarts playback from the chosen move; the run state there is rebuilt from the log.
  const seekReplay = (position: number) => {
    const runner = replayRunner.current
    if (!replayLog || !replaySession || !runner) return
    const target = Math.min(Math.max(Math.trunc(position), 0), replaySession.timeline.total)
    let state: RunState
    try { state = replaySession.timeline.stateAt(target) } catch (error) {
      setRunLogMessage(error instanceof Error ? error.message : 'Replay stopped.')
      return
    }
    clearTimeout(runner.stop)
    runner.controller.abort()
    runner.removeCursor?.()
    setReplayFinished(false)
    setRunLogMessage(null)
    // The remount below replaces the game menu's dialog, so an open menu is closed with it.
    setPauseOpen(false)
    setReplayEpoch((epoch) => epoch + 1)
    launchReplay(replayLog, replaySession, { position: target, state })
  }

  useEffect(() => {
    if (!replayLog || !replaySession || !open || !active) return
    // StrictMode reruns this effect at once with nothing changed (also when a Suspense boundary
    // reappears); the replay already under way keeps going instead of restarting from its first event.
    if (replayRunner.current?.log === replayLog) clearTimeout(replayRunner.current.stop)
    else {
      stopReplay()
      setReplayFinished(false)
      setRunLogMessage(null)
      // Coming back to a replay that was already under way picks up where it stopped.
      const position = replaySession.position
      let start: { position: number; state: RunState } | undefined
      try { if (position > 0) start = { position, state: replaySession.timeline.stateAt(position) } } catch {}
      launchReplay(replayLog, replaySession, start)
    }
    return () => {
      // A seek replaces the runner, so the one to stop is whichever is current when the effect ends.
      const runner = replayRunner.current
      if (runner) runner.stop = window.setTimeout(() => { if (replayRunner.current === runner) stopReplay() })
    }
  }, [active, open, replayLog])

  useEffect(() => {
    replaySession?.timeline.index()
    return () => replaySession?.timeline.stopIndexing()
  }, [replaySession])

  // A debug bridge for the Playwright suite: drive real clicks, assert real
  // state. Screenshots are for review; assertions read from here.
  useLayoutEffect(() => {
    const bridge = {
      getRun: () => run,
      /** The combat state, or null outside a fight. */
      getState: () => run.combat,
      setRun: (next: RunState) => flushSync(() => setRun(next)),
      reset: (count: number, seed: string, nextAscension = 0) => restart(count, seed, nextAscension, chooseYourRelic, lastStand, DEFAULT_CHARACTERS, mode === 'daily' ? {} : metaOptions),
      setViewer: (id: string) => flushSync(() => setViewerId(id)),
      playUiSound: () => playSoundEffect('ui'),
      getSettings: () => settings,
    }
    ;(window as unknown as { __STS_DEBUG__?: typeof bridge }).__STS_DEBUG__ = bridge
  }, [run, settings, mode])

  useEffect(() => {
    if (!replayLog) setAscension((current) => Math.min(current, playerProgress.highestAscension))
  }, [replayLog, playerProgress.highestAscension])

  useEffect(() => {
    if (!replayLog && !tutorial) saveCampaign(open ? campaignBeforePendingRun(run) : campaignBeforeCurrentRun(run))
  }, [open, replayLog, run.campaignProgress, run.campaign.finalized, tutorial])

  useEffect(() => {
    const refresh = () => setJournalAscension(savedCampaign().highestAscension)
    const storage = (event: StorageEvent) => { if (event.key === campaignKey() || event.key === null) refresh() }
    window.addEventListener(CAMPAIGN_EVENT, refresh)
    window.addEventListener('storage', storage)
    refresh()
    return () => { window.removeEventListener(CAMPAIGN_EVENT, refresh); window.removeEventListener('storage', storage) }
  }, [])

  ownership.current = { open, built, playing: !tutorial && !replayLog }
  // A bounty toast belongs to the screen it was raised on; leaving the run drops it.
  useEffect(() => { if (!open) setCoinGain(null) }, [open])

  // A fallen boss only promises its coins: they reach the wallet when the run's
  // result is recorded (`recordRunResult`). This announces each new award as
  // pending; a resume or reload announces nothing, and a replay or the tutorial
  // plays somebody's — or nobody's — finished boss again.
  const announcedAwards = useRef<{ key: string; count: number } | null>(null)
  useEffect(() => {
    // A tutorial or replay is not the parked run: leave its count alone, so returning announces nothing.
    if (replayLog || tutorial || run.consoleModified) return
    const count = run.campaign.bossCoins?.length ?? 0
    const key = `${coinKey}|${run.campaign.runId}`
    const previous = announcedAwards.current
    announcedAwards.current = { key, count }
    if (previous?.key !== key || count <= previous.count) return
    const coins = coinsOwed(run.campaign.bossCoins?.slice(previous.count))
    if (coins > 0) setCoinGain((current) => ({ coins, total: coinsOwed(run.campaign.bossCoins), pending: true, id: (current?.id ?? 0) + 1 }))
  }, [coinKey, replayLog, run.campaign.bossCoins, run.consoleModified, tutorial])

  useLayoutEffect(() => {
    if (!open || replayLog || tutorial) return
    if (run.campaign.finalized) {
      if (terminalRun.current?.campaign.runId !== run.campaign.runId) return discardSoloRun()
      if (recordRunId === run.campaign.runId && queuedLeaderboardRun.current !== run.campaign.runId && ownsRun(built)) {
        queuedLeaderboardRun.current = run.campaign.runId
        const id = queueFinishedSoloRun(run)
        leaderboardSubmission.current = id ? { id, owner: currentWalletKey() } : null
        if (leaderboardSubmission.current) {
          setLeaderboardStatus('pending')
          flushQueuedRun()
        } else setLeaderboardStatus(null)
      }
    }
    // A run that belongs to another account is never saved for the one signed in now.
    if (!ownsRun(built)) return
    if (unfinishedCombat(run)) {
      if (!sameCombat(combatStart.current, run)) combatStart.current = structuredClone(run)
    } else combatStart.current = null
    if (run.phase === 'reward') {
      if (!sameLoot(lootStart.current, run)) lootStart.current = structuredClone(run)
    } else lootStart.current = null
    // Keep an Event's arrival through its shop, fight, or pending rewards.
    // Returning to the map without an outstanding acquisition commits the visit.
    if (!sameRoom(roomStart.current, run)) roomStart.current = restartableRoom(run) ? structuredClone(run) : null
    const saved: SoloRunSave = {
      version: 1, run, built, combatStart: combatStart.current, lootStart: lootStart.current, roomStart: roomStart.current,
      terminalRun: terminalRun.current?.campaign.runId === run.campaign.runId ? terminalRun.current : null,
      recordRunId,
      runLogExtractedRunId,
    }
    try {
      localStorage.setItem(SOLO_RUN_KEY, JSON.stringify(saved))
    } catch {
      // Keep the last atomic checkpoint; the run continues in memory.
    }
  }, [built, open, recordRunId, replayLog, run, runLogExtractedRunId, tutorial])

  // A finished combat folds back into the run on its own; the player should not
  // have to click through a screen that only says "you won".
  useEffect(() => {
    if (!replayLog && open && !compendium && !pauseOpen && !settingsOpen && run.combat && (run.combat.phase === 'won' || run.combat.phase === 'lost')) {
      let timer: number
      const resolveWhenAnimationsFinish = () => {
        if (combatOutcomeAnimationActive()) {
          timer = window.setTimeout(resolveWhenAnimationsFinish, 100)
          return
        }
        setRun((current) => resolveCombat(current))
      }
      timer = window.setTimeout(resolveWhenAnimationsFinish, run.combat.phase === 'won'
        ? settings.reducedMotion || prefersReducedMotion ? 0 : COMBAT_OUTCOME_DELAY_MS
        : 900)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [compendium, open, pauseOpen, prefersReducedMotion, replayLog, run.combat, settings.reducedMotion, settingsOpen])

  const viewer = run.players.find((player) => player.id === viewerId) ?? run.players[0]
  const headerViewer = run.phase === 'combat'
    ? run.combat?.players.find((player) => player.id === viewerId) ?? viewer
    : viewer
  // Fires wherever a card changed — campfire, event, reward, Neow, a relic —
  // because it watches the deck rather than each of those call sites.
  const morph = useCardMorphs(viewer?.deck, open ? run.campaign.runId : undefined, run.phase, viewerId)
  // The map is regenerated per act, so this counts the CURRENT act's climb, not
  // the run's. The summary labels it "Rooms this act" to match.
  const roomsCleared = useMemo(
    () => Object.values(run.map.rooms).filter((room) => room.visited).length,
    [run.map.rooms],
  )
  const pendingSocket = run.pendingGuardianSockets?.find((pending) =>
    run.phase !== 'reward' || pending.playerId === viewerId)
  const pendingSocketOwner = run.players.find((player) => player.id === pendingSocket?.playerId)
  const pendingAcquisition = hasPendingRelicAcquisition(run, run.phase === 'reward' ? viewerId : undefined)
  // Derived once per render: `visibleMap` rebuilds the room table (and clones
  // every room under Uncertain Future), and the map phase asked for it four
  // times — twice in one `MapScreen` line, then again per Wing Boots option.
  const seenMap = useMemo(() => visibleMap(run), [run])
  const wingChoices = useMemo(() => wingBootChoices(run, viewerId), [run, viewerId])
  const pendingPreview = useMemo(() => pendingRelicPreview(run, viewerId), [run, viewerId])
  const canSwitchRowsHere = run.phase === 'map' || run.phase === 'room' &&
    run.roomState?.kind === 'event' && eventCanStartCombat(run.roomState.card)
  const pendingOwner = run.players.find((player) => player.relics.some((relic) => relic.pending))
  const pendingRelic = pendingOwner?.relics.find((relic) => relic.pending)
  const roomKind = run.map.position ? run.map.rooms[run.map.position]?.kind : undefined
  // A restricted account's lost run shows the Spire's notice, not marks it cannot earn.
  const allocatingCampaignMarks = run.campaign.finalized || (run.campaignProgress.unspentMarks > 0 && !lostToSpire)
  const resultRecorded = recordRunId === run.campaign.runId
  const runLogExtracted = runLogExtractedRunId === run.campaign.runId
  useEffect(() => {
    if (!allocatingCampaignMarks) return
    // The campaign journal precedes the direct character-selection route.
    // Warm its selected hero and the following campaign choice while players
    // assign marks or review their result.
    const campaignArt = ['menu/campaign-standard-menu.webp', 'menu/campaign-downfall-menu.webp']
    const first = characters[0] ?? 'ironclad'
    const characterArt = `menu/character-select/character-${visualId(first, preferredSkin(first))}-wallpaper.webp`
    void preloadImages(campaignArt, { decode: true, fetchPriority: 'high' })
    void preloadImages([characterArt], { decode: true, fetchPriority: 'high' })
    return () => releasePreloadedImages([...campaignArt, characterArt])
  }, [allocatingCampaignMarks, characters])
  function allocateCampaignMark(colorless: number, actIV: number) {
    setRun((current) => {
      const progress = allocateSharedMarks(current.campaignProgress, colorless, actIV)
      if (current.campaign.finalized) return { ...current, campaignProgress: progress }
      return newRun(built.count, built.seed, built.ascension, { ...progress, nextRunNumber: progress.nextRunNumber - 1 }, built.chooseYourRelic, built.lastStand, built.characters, built.meta)
    })
  }

  if (!open) {
    if (compendium) return <CompendiumScreen onBack={() => setCompendium(false)} />
    if (leaderboard) return <LeaderboardScreen onBack={() => setLeaderboard(false)} />
    if (stats) return <StatsScreen onBack={() => setStats(false)} />
    if (profileOpen) return <ProfileScreen onBack={() => setProfileOpen(false)} onShop={() => { setProfileOpen(false); setShop('skins') }} />
    if (shop) return <ShopScreen initialTab={shop} onBack={() => setShop(false)} />
    return <StartMenu
      characters={characters}
      ascension={ascension}
      maxAscension={playerProgress.highestAscension}
      mode={mode}
      dailyModifiers={dailyModifiers}
      customModifierIds={customModifierIds}
      quickStartAct={quickStartAct}
      actIVUnlocked={isActIVUnlocked(playerProgress)}
      dailyTurned={dailyTurned}
      onCharacter={(seat, character) => setCharacters((current) => {
        const next = [...current]
        const previous = next[seat]
        if (!previous) return current
        const otherSeat = next.indexOf(character)
        if (otherSeat >= 0) next[otherSeat] = previous
        next[seat] = character
        return next
      })}
      onAscension={setAscension}
      onMode={setMode}
      onCustomModifier={(id, enabled) => setCustomModifierIds((current) => enabled
        ? current.includes(id) ? current : [...current, id]
        : current.filter((candidate) => candidate !== id))}
      onQuickStartAct={setQuickStartAct}
      onStart={(campaign) => {
        // Read the day fresh: past midnight the menu previewed yesterday's modifiers, so show today's before starting.
        const day = refreshToday()
        setDailyTurned(false)
        if (mode === 'daily' && day !== today) return setDailyTurned(true)
        discardSoloRun()
        discardRunLog(resume?.run.campaign.runId ?? run.campaign.runId)
        setChoosingNextCharacter(false)
        if (mode === 'daily') restart(1, dailySeedText(day), ascension, false, false, characters, { mode, dailyDate: day })
        else restart(1, seedText, ascension, false, false, characters, { ...metaOptions, campaign })
        onOpen()
      }}
      onTutorial={() => startTutorial(characters[0] ?? 'ironclad')}
      onResume={resume ? resumeSoloRun : undefined}
      resumePending={resumePending}
      resumeError={resumeError}
      onOnline={onOnline}
      onLeaderboard={() => setLeaderboard(true)}
      onStats={() => setStats(true)}
      onProfile={() => setProfileOpen(true)}
      onCompendium={() => setCompendium(true)}
      onShop={() => setShop('packs')}
      onReplay={startReplay}
      onCharacterBack={() => { setChoosingNextCharacter(false); setDailyTurned(false) }}
      settings={settings}
      onSettings={onSettings}
      initiallyChoosingCharacter={choosingNextCharacter}
    />
  }

  return (
    <>
    <SkinProvider seats={run.players}>
    <MapDrawingProvider key={run.campaign.runId} runId={run.campaign.runId}>
    <main key={replayEpoch} ref={runShell} tabIndex={-1} inert={compendium || undefined} aria-hidden={compendium || undefined}
      data-assistant-run-id={run.campaign.runId} data-assistant-phase={run.phase} data-assistant-mode={replayLog ? 'replay' : 'local'}
      className={`app-shell sts-scope${run.phase === 'combat' ? ' app-shell--combat' : ''}${run.phase === 'neow' ? ' app-shell--neow' : ''}${run.roomState?.kind === 'event' ? ' app-shell--event' : ''}${compendium ? ' app-shell--compendium-open' : ''}`}>
      <RunHeader player={headerViewer} act={run.act} ascension={run.ascension} combat={run.phase === 'combat'}
        die={run.combat?.die} deck={viewer?.deck}
        map={run.phase !== 'map' && run.phase !== 'setup' ? seenMap : undefined} bossDefId={run.actBossDefId}
        stanceChangedThisTurn={run.phase === 'combat' ? run.combat?.stanceChangedThisTurn.includes(viewerId) : undefined}
        sharedDrawLocked={run.combat?.players.filter(player => !player.dead).every(player => player.drawLocked)}
        onSettings={() => { setSettingsReturnToPause(false); setSettingsOpen(true) }}
        statusBefore={tutorial ? <Tooltip name={tutorialTipsHidden ? 'Show tutorial tips' : 'Hide tutorial tips'}>{help =>
            <button {...help} type="button" className="pip pip--tutorial" aria-pressed={!tutorialTipsHidden}
            onClick={() => setTutorialTipsHidden((current) => !current)}>Tutorial</button>}</Tooltip> : null}
        inventory={headerViewer ? <>
              {!allocatingCampaignMarks && run.phase !== 'combat' && run.phase !== 'defeat' && run.phase !== 'neow' &&
              !victoryIsTerminal(run, run.campaignProgress) && !pendingAcquisition ? (
                <OutsidePotionBar players={run.players} viewerId={viewerId}
                  ascension={run.ascension}
                  ruleset={run.meta.ruleset ?? 'base'}
                  onTrade={(potionId, playerId) => setRun((current) => tradePotion(current, viewerId, playerId, potionId))}
                  onUse={(potionId, replacePotionId) => setRun((current) =>
                    usePotionOutsideCombat(current, viewerId, potionId, replacePotionId))} />
              ) : <PotionSlots player={headerViewer} ascension={run.ascension} />}
              {run.phase === 'combat' && run.combat ? <CourierPeek placement="header" active={!run.courier.offer && courierPeekPhase(run.combat)}
                players={run.combat.players} viewerId={viewerId} usedBy={run.courier.usedBy} onReveal={revealLocalCourier} /> : null}
        </> : null} />

      <SettingsDialog open={settingsOpen} settings={settings} onChange={onSettings}
        onClose={() => { setSettingsOpen(false); if (settingsReturnToPause) setPauseOpen(true) }}
        generalChildren={run.meta.modifierIds.length > 0 || run.players.length > 1 ? <>
          {run.meta.modifierIds.length > 0 ? <details className="ascension-rules run-modifiers">
            <summary>{run.meta.mode === 'daily' ? 'Daily Climb' : 'Custom Run'} · {run.meta.modifierIds.length} modifiers</summary>
            <ul>{run.meta.modifierIds.map((id) => {
              const modifier = DAILY_MODIFIERS.find((candidate) => candidate.id === id)!
              return <li key={id}><strong>{modifier.name}</strong> — {modifier.rule}</li>
            })}</ul>
          </details> : null}
          {run.players.length > 1 ? <label className="settings-select">Seat
            <select value={viewerId} onChange={(event) => setViewerId(event.target.value)}>
              {run.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
            </select>
          </label> : null}
        </> : undefined} />

      {giveUpOpen && canGiveUp ? <GiveUpPanel
        players={run.players} playerId={viewerId}
        onVote={(yes) => {
          setGiveUpOpen(false)
          if (yes) setRun((current) => giveUpRun(current))
        }}
        onCancel={() => setGiveUpOpen(false)}
      /> : null}

      <dialog ref={pauseDialog} className="choice-modal pause-menu" aria-labelledby="pause-menu-title"
        onCancel={(event) => { event.preventDefault(); setPauseOpen(false) }}>
        <section className="choice-modal__panel">
          <p>Game paused</p>
          <h2 id="pause-menu-title">Slay the Spire</h2>
          <button type="button" className="is-chosen" onClick={() => setPauseOpen(false)}>Resume</button>
          <button type="button" onClick={() => { setPauseOpen(false); setSettingsReturnToPause(true); setSettingsOpen(true) }}>Settings</button>
          <button type="button" onClick={() => { setPauseOpen(false); setCompendium(true) }}>Compendium</button>
          {!replayLog && !tutorial && canGiveUp ? <button type="button" onClick={() => { setPauseOpen(false); setGiveUpOpen(true) }}>Give up</button> : null}
          <button type="button" onClick={() => {
            setPauseOpen(false)
            if (tutorial) exitTutorial()
            else if (replayLog) leaveReplay()
            // A recorded run resumes from its save (the campaign journal), never from the
            // victory it was recorded from.
            else setResume(run.campaign.finalized ? savedSoloRun() : {
              version: 1, run, built, combatStart: combatStart.current, lootStart: lootStart.current, roomStart: roomStart.current,
            })
            onClose()
          }}>{tutorial ? 'Leave tutorial' : 'Return to main menu'}</button>
        </section>
      </dialog>

      {!allocatingCampaignMarks && run.phase === 'combat' && run.combat ? (
        <><div className="courier-combat-lock" inert={Boolean(run.courier.offer) || undefined} aria-disabled={Boolean(run.courier.offer) || undefined}><CombatScreen
          key={consoleRewindEpoch} state={run.combat}
          act={run.act}
          viewerId={viewerId}
          animateOpeningHand
          autoAdvance={!replayLog && !compendium && !pauseOpen && !settingsOpen && !giveUpOpen && !run.courier.offer}
          selectionDialogsActive={!compendium && !pauseOpen && !settingsOpen && !giveUpOpen && !run.courier.offer}
          courierUsedBy={run.courier.usedBy}
          onCourierReveal={run.courier.offer ? undefined : revealLocalCourier}
          mutationsEnabled={!run.courier.offer}
          onChange={updateCombat}
        /></div><CourierPanel players={run.combat.players} viewerId={viewerId} ascension={run.ascension} offer={run.courier.offer} onResolve={(decision, payments = {}, discardPotionId) => setRun((current) => decideCourier(current, current.courier.offer?.playerId ?? viewerId, decision, payments, discardPotionId))} /></>
      ) : null}
      {pendingPreview ? <RelicResolvePanel key={`${viewerId}:${pendingPreview.id}`}
        pending={pendingPreview}
        player={viewer!} potion={run.rewards.find((offer) => offer.playerId === viewerId)?.potion}
        ascension={run.ascension}
        onPotion={(decision) => setRun((current) => resolvePotionReward(current, viewerId, decision))}
        onRewardChoice={(reward, choice) => setRun((current) =>
          choosePendingRelicReward(current, viewerId, reward, choice))} onResolve={(cardUids, rewardIndices) => setRun((current) =>
          resolvePendingRelic(current, viewerId, cardUids, rewardIndices))} /> : null}
      {pendingSocket && pendingSocketOwner ? <GuardianSocketPanel
        key={`${pendingSocket.playerId}-${pendingSocket.cardUid}`}
        pending={pendingSocket}
        deck={pendingSocketOwner.deck}
        onResolve={(gemId) => setRun((current) => finishRewardsIfComplete(resolveGuardianSocket(
          current, pendingSocket.playerId, pendingSocket.cardUid, gemId,
        )))} /> : null}
      {run.phase !== 'neow' && run.phase !== 'reward' && pendingOwner && pendingRelic && pendingOwner.id !== viewerId ? <section className="room-screen" role="status">
        Waiting for {pendingOwner.name} to resolve {relicDef(pendingRelic.defId).name}.
        <button type="button" onClick={() => setViewerId(pendingOwner.id)}>Switch to {pendingOwner.name}</button>
      </section> : null}

      {!allocatingCampaignMarks && run.phase === 'neow' && run.neow ? <NeowScreen
        players={run.players}
        progress={Object.fromEntries(Object.keys(run.neow.players).map((id) => [id, neowPreview(run, id)]))}
        viewerId={viewerId}
        ascension={run.ascension}
        enabled={!pendingAcquisition}
        selectionDialogsActive={!pendingAcquisition}
        disabledMessage={pendingOwner && pendingRelic
          ? `Waiting for ${pendingOwner.name} to resolve ${relicDef(pendingRelic.defId).name}.`
          : undefined}
        onViewer={setViewerId}
        onReveal={(playerId, _stage, sources) => setRun((current) => revealNeowReward(current, playerId, sources))}
        onReward={(playerId, choice) => setRun((current) => resolveNeowReward(current, playerId, choice))}
        onEffect={(playerId, gain, decision) => setRun((current) => resolveNeowEffect(current, playerId, gain, decision))}
        onChoose={(playerId, optionIndex, decision) => setRun((current) => chooseNeow(current, playerId, optionIndex, decision))}
        onArmCardGain={morph.armGain}
      /> : null}

      {!allocatingCampaignMarks && run.phase === 'setup' && run.setup && !pendingAcquisition ? <QuickSetupScreen
        setup={run.setup}
        players={run.players}
        currentStep={currentQuickSetupStep(run.setup)}
        onAdvance={(cardUids) => setRun((current) => advanceQuickSetup(current, cardUids))}
      /> : null}

      {!allocatingCampaignMarks && run.phase === 'map' ? (
        <>
          <MapScreen map={seenMap} choices={pendingAcquisition ? [] : roomChoices({ ...run, map: seenMap })} blocked={pendingAcquisition}
            bossDefId={run.actBossDefId}
            canRerollBoss={!pendingAcquisition && canRerollDownfallSelfBoss(run)}
            onRerollBoss={() => setRun(rerollDownfallSelfBoss)}
            onSelectionChange={setMapSelectionPending}
            wingChoices={pendingAcquisition ? [] : wingChoices}
            wingUses={wingBootUses(run.players.find((player) => player.id === viewerId))}
            onEnter={(roomId) => setRun((current) => wingChoices.some((room) => room.id === roomId)
              ? enterRoom(current, roomId, viewerId)
              : tutorial ? enterTutorialRoom(current, roomId, tutorial.seed) : enterRoom(current, roomId))} />
        </>
      ) : null}

      {!pendingAcquisition && !mapSelectionPending && canSwitchRowsHere &&
      run.players.filter((player) => !player.dead).length > 1 ? <section className="map-row-switch">
        <strong>Switch rows before the next combat</strong>
        {run.players.filter((player) => !player.dead).map((player) => <label key={player.id}>{player.name}
          <select value={player.row} onChange={(event) => setRun((current) =>
            switchBetweenCombatRow(current, player.id, Number(event.target.value)))}>
            {run.players.map((_seat, row) => <option value={row} key={row}>Row {row + 1}</option>)}
          </select>
        </label>)}
      </section> : null}

      {!allocatingCampaignMarks && run.phase === 'reward' && !pendingAcquisition ? (
        <RewardScreen
          players={run.players}
          rewards={run.rewards}
          onReveal={(playerId, sources) => setRun((current) => revealCardReward(current, playerId, sources))}
          onGold={(playerId, gain) => setRun((current) => resolveGoldReward(current, playerId, gain))}
          onPotion={(playerId, decision) => setRun((current) => resolvePotionReward(current, playerId, decision))}
          onRelic={(playerId, choice) => setRun((current) => resolveRelicReward(current, playerId, choice === 'gain'))}
          onBossRelic={(playerId, relicId) => setRun((current) => resolveBossRelicReward(current, playerId, relicId))}
          onTransform={(playerId, cardUid) => setRun((current) => resolveTransformReward(current, playerId, cardUid))}
          onResolve={(decisions) => setRun((current) => resolveCardRewards(current, decisions))}
          ascension={run.ascension}
          act={run.act}
        />
      ) : null}

      {!allocatingCampaignMarks && run.phase === 'betweenCombat' ? (
        <section className="room-screen between-combat">
          <h2>Another boss approaches</h2>
          <p className="muted">Switch rows now. Relics and once-per-combat effects reset for the next fight.</p>
          {run.players.filter((player) => !player.dead).map((player) => (
            <label key={player.id}>{player.name}
              <select value={player.row} onChange={(event) => setRun((current) =>
                switchBetweenCombatRow(current, player.id, Number(event.target.value)))}>
                {run.players.map((_seat, row) => <option value={row} key={row}>Row {row + 1}</option>)}
              </select>
            </label>
          ))}
          <button type="button" disabled={pendingAcquisition}
            onClick={() => setRun((current) => startPendingBoss(current))}>Face the next boss</button>
        </section>
      ) : null}

      {!allocatingCampaignMarks && !pendingAcquisition && run.phase === 'room'
        && roomKind === 'campfire' && !run.roomState ? (
        <CampfireScreen
          players={run.players}
          rubyAvailable={isActIVUnlocked(run.campaignProgress) && !run.campaign.keys.ruby}
          restAllowed={!run.meta.modifierIds.includes('night_terrors')}
          ruleset={run.meta.ruleset}
          onResolve={(choices) => setRun((current) => resolveCampfire(current, choices))}
        />
      ) : null}

      {!allocatingCampaignMarks && !pendingAcquisition && run.phase === 'room' && run.roomState ? (
        <RoomScreen
          selectionDialogsActive={!compendium && !pauseOpen && !settingsOpen && !giveUpOpen}
          room={run.roomState}
          players={run.players}
          viewerId={viewerId}
          ascension={run.ascension}
          onPurchase={(purchase) => setRun((current) => purchaseAtMerchant(current, purchase))}
          onRemove={(playerId, cardUid, payments) => setRun((current) => removeAtCurrentMerchant(current, playerId, cardUid, payments))}
          onFinishMerchant={() => setRun((current) => finishMerchant(current))}
          onRelic={(playerId, decision) => setRun((current) => chooseRelicReward(current, playerId, decision))}
          onEvent={(playerId, decision) => setRun((current) => chooseEvent(current, playerId, decision))}
          onPreparedHermitSetup={(cardUid, enemyUid) => setRun((current) => {
            if (current.roomState?.kind !== 'event' || !current.roomState.preparedCombat) return current
            const preparedCombat = resolveHermitSetupLoad(current.roomState.preparedCombat, viewerId, cardUid, enemyUid, true)
            return preparedCombat === current.roomState.preparedCombat ? current : {
              ...current, roomState: { ...current.roomState, preparedCombat },
            }
          })}
          onPreparedStartTurnScryOrder={(order) => setRun((current) => {
            if (current.roomState?.kind !== 'event' || !current.roomState.preparedCombat) return current
            const preparedCombat = orderStartTurnScries(current.roomState.preparedCombat, order)
            return preparedCombat === current.roomState.preparedCombat ? current : {
              ...current, roomState: { ...current.roomState, preparedCombat },
            }
          })}
          onPreparedStartTurnScry={(sourceId, discardUids) => setRun((current) => {
            if (current.roomState?.kind !== 'event' || !current.roomState.preparedCombat) return current
            const preparedCombat = resolveStartTurnScry(
              current.roomState.preparedCombat, viewerId, sourceId, discardUids,
            )
            return preparedCombat === current.roomState.preparedCombat ? current : {
              ...current, roomState: { ...current.roomState, preparedCombat },
            }
          })}
          eventCanSkip={canSkipEvent(run, viewerId)}
          unavailableEventOptionIds={unavailableEventOptionIds(run, viewerId)}
          onSkipEvent={(playerId) => setRun((current) => skipEvent(current, playerId))}
          sapphireAvailable={isActIVUnlocked(run.campaignProgress) && !run.campaign.keys.sapphire}
          eventMap={seenMap}
          eventBossDefId={run.actBossDefId}
          onArmCardGain={morph.armGain}
        />
      ) : null}

      {!allocatingCampaignMarks && !pendingAcquisition && run.phase === 'room' && roomKind !== 'campfire' && !run.roomState ? (
        <section className="room-screen">
          <h2>{roomKind ?? 'room'}</h2>
          <button type="button" className="ribbon-back" aria-label="Back to the map" onClick={() => setRun((current) => leaveRoom(current))}>
            <span aria-hidden="true"></span>
          </button>
        </section>
      ) : null}

      {tutorial && !pendingAcquisition && (run.phase === 'victory' || run.phase === 'defeat') ? (
        <section className="room-screen tutorial-end" aria-labelledby="tutorial-end-title">
          <h2 id="tutorial-end-title" className={run.phase === 'defeat' ? 'room-screen__defeat' : undefined}>
            {run.phase === 'victory' ? 'Tutorial complete' : 'The tutorial run has ended'}
          </h2>
          <RunSummary act={run.act} roomsCleared={roomsCleared}
            ascension={run.ascension} seats={run.players.map(summarySeat)} />
          <p>{run.phase === 'victory'
            ? 'You defeated the Act I boss. You know the basics now: start a Single Player run to climb all three Acts and unlock new cards.'
            : 'Every run teaches something. Try again with the same hero, or start a Single Player run when you are ready.'}</p>
          <div className="room-screen__actions">
            {run.phase === 'defeat' ? <button type="button" onClick={() => startTutorial(tutorial.character)}>Try again</button> : null}
            <button type="button" onClick={exitTutorial}>Return to main menu</button>
          </div>
        </section>
      ) : null}

      {!tutorial && !allocatingCampaignMarks && !pendingAcquisition && run.phase === 'victory' && !run.campaign.finalized ? (
        <section className="room-screen">
          <h2>{run.act >= 4 ? 'The Spire is conquered' : `Act ${run.act} complete`}</h2>
          <RunSummary act={run.act} roomsCleared={roomsCleared}
            ascension={run.ascension} seats={run.players.map(summarySeat)} coins={run.consoleModified ? 0 : coinsOwed(run.campaign.bossCoins)}
            coinsClaimed={Boolean(replayLog) || resultRecorded} />
          {run.lastStand && run.players.some((player) => player.dead) && run.act < 4 ? (
            <p role="status">Last Stand won the Act, but a fallen hero means the party cannot continue to the next Act.</p>
          ) : null}
          <div className="room-screen__actions">
            {(replayLog ? !replayFinished && !runLogMessage : !runLogExtracted) && !(run.lastStand && run.players.some((player) => player.dead)) &&
            (run.act < 3 || canEnterActIV(run.campaignProgress, run.campaign.keys, run.act)) ? <button type="button" disabled={pendingAcquisition || extractingRunLog}
              onClick={() => {
                // A replay climbs only its own copy; the parked run keeps its log and result bookkeeping.
                if (!replayLog) {
                  setRunLogExtractedRunId(null)
                  setRunLogMessage(null)
                  terminalRun.current = null
                }
                setRun((current) => advanceAct(current))
              }}>
              Climb to Act {run.act + 1}
            </button> : null}
            {!replayLog ? <><button type="button" disabled={pendingAcquisition || extractingRunLog}
              onClick={recordRunResult} data-run-log-control>Stop and record result</button>
            <button type="button" onClick={() => void extractRunLog()} disabled={!runLogAvailable || extractingRunLog}
              data-run-log-control>{runLogExtracted ? 'Extract run logs again' : 'Extract run logs'}</button></> : null}
          </div>
          {runLogMessage && !replayLog ? <p aria-live="polite">{runLogMessage}</p> : null}
        </section>
      ) : null}

      {!tutorial && !allocatingCampaignMarks && run.phase === 'defeat' && !run.campaign.finalized ? (
        <section className="room-screen">
          <h2 className="room-screen__defeat">{lostToSpire ? SPIRE_REJECTION : 'The party has fallen'}</h2>
          {lostToSpire ? <div className="room-screen__actions">
            <button type="button" onClick={() => { discardSoloRun(); onClose() }}>Return to main menu</button>
          </div> : <RunSummary act={run.act} roomsCleared={roomsCleared}
            ascension={run.ascension} seats={run.players.map(summarySeat)} coins={run.consoleModified ? 0 : coinsOwed(run.campaign.bossCoins)}
            coinsClaimed={Boolean(replayLog) || resultRecorded} />}
          {!lostToSpire && !run.campaign.finalized && !replayLog ? <><div className="room-screen__actions">
            <button type="button" onClick={recordRunResult} disabled={extractingRunLog} data-run-log-control>Record campaign result</button>
            <button type="button" onClick={() => void extractRunLog()} disabled={!runLogAvailable || extractingRunLog}
              data-run-log-control>{runLogExtracted ? 'Extract run logs again' : 'Extract run logs'}</button>
          </div>{runLogMessage ? <p aria-live="polite">{runLogMessage}</p> : null}</> : null}
        </section>
      ) : null}

      {allocatingCampaignMarks ? <section className="campaign-end">{run.meta.dailyDate !== undefined ? <><span>Daily Climb · {run.meta.dailyDate}</span><h2>{run.floorsCleared ?? 0} floor{run.floorsCleared === 1 ? '' : 's'} reached</h2><p>Daily Climbs rank on the Daily Climb leaderboard and do not earn campaign marks.</p></> : <><span>Campaign journal</span><h2>Marks earned</h2><p>{run.campaignProgress.unspentMarks} shared mark{run.campaignProgress.unspentMarks === 1 ? '' : 's'} remain. Assign each to Colorless or Act IV.</p></>}{!replayLog && run.campaign.finalized && leaderboardStatus ? <p key={leaderboardStatus} aria-live="polite" data-webmcp-transient-status data-webmcp-pending={leaderboardStatus === 'pending' ? 'true' : undefined}>{leaderboardStatus === 'pending' ? 'Recording run on the leaderboard…' : leaderboardStatus === 'recorded' ? 'Run recorded on the leaderboard.' : leaderboardStatus === 'queued' ? 'Leaderboard unavailable — run saved for automatic retry.' : 'Leaderboard rejected this run.'}</p> : null}{runLogMessage && !replayLog ? <p aria-live="polite">{runLogMessage}</p> : null}{!replayLog ? <div>{run.campaignProgress.unspentMarks > 0 && run.campaignProgress.colorless < 3 ? <button type="button" onClick={() => allocateCampaignMark(1, 0)}>Mark Colorless · {run.campaignProgress.colorless}/3</button> : null}{run.campaignProgress.unspentMarks > 0 && run.campaignProgress.actIV < 5 ? <button type="button" onClick={() => allocateCampaignMark(0, 1)}>Mark Act IV · {run.campaignProgress.actIV}/5</button> : null}{run.campaign.finalized && !resultRecorded ? <button type="button" onClick={recordRunResult} disabled={extractingRunLog} data-run-log-control>Record campaign result</button> : null}{run.campaign.finalized ? <button type="button" onClick={() => void extractRunLog()} disabled={!runLogAvailable || extractingRunLog} data-run-log-control>{runLogExtracted ? 'Extract run logs again' : 'Extract run logs'}</button> : null}{resultRecorded && run.campaignProgress.unspentMarks === 0 ? <button type="button" disabled={extractingRunLog} onClick={prepareNextRun}>Prepare next run →</button> : null}</div> : null}</section> : null}
      {run.consoleModified && (run.phase === 'victory' || run.phase === 'defeat') ?
        <p>Console run: unranked. No account Coins or campaign progress are awarded.</p> : null}
      <TreasureEffects room={run.roomState?.kind === 'treasure' ? run.roomState : null}
        players={run.players} runId={run.campaign.runId} resolved={run.log.at(-1) === 'The relics are resolved.'} />
      {replayLog && (replayFinished || runLogMessage) ? <section className={`run-replay__banner${runLogMessage ? ' run-replay__banner--error' : ''}`}
        data-run-log-control>
        <p id="run-replay-banner-message" role={runLogMessage ? 'alert' : 'status'}>{runLogMessage ?? 'Replay finished'}</p>
        <button type="button" autoFocus={!document.activeElement?.closest('.replay-bar')} aria-describedby="run-replay-banner-message" onClick={() => { leaveReplay(); onClose() }}>Return to main menu</button>
      </section> : null}
      {tutorial && !pauseOpen && !settingsOpen && !compendium ? <TutorialCoach key={tutorial.attempt}
        chapters={tutorialChapterList} run={run} hidden={tutorialTipsHidden} onHide={() => setTutorialTipsHidden(true)} /> : null}
      {morph.current ? <CardMorph request={morph.current} onDone={morph.dismiss} /> : null}
      <CoinGainToast gain={coinGain} onDone={clearCoinGain} />
      {/* `aria-live` rather than `role="status"`: the run already has status
          regions ("Choice locked. Waiting for the party…"), and a second one
          would both compete with them and make `getByRole('status')` ambiguous
          for the suites. A bare live region announces without claiming a role.
          Rendered always, empty when idle, because a live region has to exist
          before its text changes for the change to be announced. */}
      <CardMorphAnnouncement key={`${open ? run.campaign.runId : ''}:${viewerId}`} request={morph.current}
        name={(card) => faceOf(cardDef(card.defId), card.upgraded).name} />
    </main>
    </MapDrawingProvider>
    </SkinProvider>
    {active && !replayLog && !tutorial && !compendium ? <DeveloperConsole key={run.campaign.runId}
      modified={Boolean(run.consoleModified)} onExecute={async command => {
        const rewind = command.trim().toLowerCase() === 'rewind'
        const history = rewind ? await loadRunLog() : undefined
        const context = consoleContext.current
        if (context.run !== run || context.viewerId !== viewerId || !context.active || !context.open ||
          context.replayLog || context.tutorial) {
          throw new ConsoleCommandError('The run changed while loading the command. Try again.')
        }
        const result = executeConsoleCommand(run, viewerId, command, history)
        if (result.run !== run) {
          setCoinGain(null)
          combatStart.current = unfinishedCombat(result.run) ? structuredClone(result.run) : null
          lootStart.current = result.run.phase === 'reward' ? structuredClone(result.run) : null
          roomStart.current = restartableRoom(result.run) ? structuredClone(result.run) : null
          flushSync(() => {
            if (rewind) setConsoleRewindEpoch(value => value + 1)
            setRunLogRestoration(value => value + 1)
            setRun(result.run)
          })
        }
        return result.output
      }} /> : null}
    {replayLog && replaySession && !compendium ? <ReplayBar session={replaySession} onSeek={seekReplay}
      onExit={() => { leaveReplay(); onClose() }} /> : null}
    {compendium ? <CompendiumScreen onBack={() => {
      setCompendium(false)
      requestAnimationFrame(() => runShell.current?.focus())
    }} backLabel="Back to run" /> : null}
    </>
  )
}
