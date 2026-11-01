import type { CombatPhase, CombatPresentationEvent, CombatState, EndTurnAbility, PendingTriggerAbility, PlayedCard, StartTurnAbility, StartTurnChoice, StartTurnScryAbility } from '../game/combat.ts'
import type { SpireMap } from '../game/map.ts'
import type { CampfireChoice, CardRewardOffer, PendingGuardianSocket, PendingRelicPreview, RunPhase } from '../game/run.ts'
import type { DailyModifierId, QuickSetupState, RunMetaState } from '../game/meta.ts'
import type { EventDecision, EventRoomState } from '../game/event-room.ts'
import type { CourierOffer, MerchantState, RelicRewardState } from '../game/noncombat.ts'
import type { CampaignProgress, SpireKeys } from '../game/campaign.ts'
import type { BossCoinAward } from '../game/coins.ts'
import type { NeowCard, NeowRewardOffer } from '../game/neow.ts'
import type { CardInstance, CharacterId, Player } from '../game/types.ts'
import type { CardPackId } from '../game/packs.ts'
import type { SkinId } from '../game/skins.ts'

export type PublicSeat = {
  playerId: string
  name: string
  character: CharacterId
  /** Presentation only; absent for the default look. */
  skin?: SkinId
  connected: boolean
  cardPacks?: CardPackId[]
}

/** Only fields explicitly published by the server's player projection. */
export type VisiblePlayer = Pick<Player,
  | 'id' | 'name' | 'character' | 'skin' | 'row' | 'hp' | 'maxHp' | 'block' | 'energy' | 'gold'
  | 'strength' | 'strengthLossAtEndOfTurn' | 'vulnerable' | 'weak' | 'drawLocked'
  | 'lostHpThisCombat' | 'hpLostThisRound' | 'lostHpLastRound' | 'hpLossLimitThisRound'
  | 'freeCardsThisTurn' | 'nextCardCost' | 'enemyNextCardCost' | 'freeAttacksThisTurn'
  | 'cardPlayLocked' | 'doubledAttacksThisTurn' | 'tripledAttacksThisTurn'
  | 'doubledCardsThisTurn' | 'doubledSkillsThisTurn' | 'retainCardsThisTurn'
  | 'cardsPlayedThisTurn' | 'attacksPlayedThisTurn' | 'powerPlayedThisTurn'
  | 'shuffledThisCombat' | 'facingEnemyUid' | 'damageDealtZeroThisTurn'
  | 'shivs' | 'shivDamageBonus' | 'cardBlockBonus' | 'hitPoison'
  | 'starterStrikeDamageBonus' | 'clawCubesGainedThisCombat' | 'starterDefendBlockBonus'
  | 'miracles' | 'stance' | 'wrathAttackDamageBonus' | 'orbs' | 'orbEvokeBonus'
  | 'darkOrbEvokeBonus' | 'orbEndTurnBonus' | 'lightningEndTurnBonus' | 'damageStats'
  | 'freeGemCardsThisTurn' | 'freePowersThisTurn' | 'nextPowerOrSlimeDiscount'
  | 'nextAttackRapidFire' | 'energySpentThisTurn' | 'spentTwoEnergyOnCardThisTurn'
  | 'heat' | 'soulburn' | 'soulburnUsedThisTurn' | 'nextSoulburnDamageBonus'
  | 'exhaustNextCardAfterUid' | 'guardianMode' | 'vigor' | 'vigorSpentThisTurn'
  | 'guardianModeLocked' | 'slimes' | 'lootChests' | 'dead'
  | 'discard' | 'exhaust' | 'powers' | 'relics' | 'potions' | 'chamberSlots'
> & {
  deck: CardInstance[] | null
  draw: CardInstance[] | null
  hand: CardInstance[] | null
  chamber: CardInstance[] | null
  chamberCount: number
  deckCount: number
  tradableDeckCount: number
  drawCount: number
  handCount: number
  cardRewardCount: number
  rareRewardCount: number
}

export type VisibleCombat = {
  combatId: string
  initialEnemyCount?: number
  lastStand: boolean
  turn: number
  die: number
  phase: CombatPhase
  potionLimit: 2 | 3
  startTurnStage?: 'effects' | 'facing'
  players: VisiblePlayer[]
  enemies: CombatState['enemies']
  powerTriggersUsedThisTurn: string[]
  pendingTriggers: { id: number; playerId: string; sourceId: string; startTurn?: true; enemyUid?: string }[]
  pendingTriggerAbility: PendingTriggerAbility | null
  nextTriggerId: number
  startTurnProgress?: {
    choices: StartTurnChoice[]
    beforeDraw?: {
      drewFrom: number
      sources: { playerId: string; sourceId: string }[]
      ordered: boolean
    }
    rollPending?: { drewFrom: number }
    discard?: { playerId: string; sourceId: string; pendingTriggers: VisibleCombat['pendingTriggers'] }
    forcedCard?: {
      playerId: string
      cardUid: string | null
      sourceCardId: string
      sourceLabel?: string
      exhaustNonPower: boolean
    }
  }
  pendingCardCopy?: {
    id: number
    playerId: string
    card: CardInstance
    energySpent: number
    resumePhase: 'start' | 'player' | 'discard'
    forcedExhaust: boolean
    forcedChoices: StartTurnChoice[] | null
    deferredHavocs: {
      card: CardInstance
      exhaust: boolean
      virtualOnly?: boolean
      copySourceNames?: ('Double Tap' | 'Blasphemy' | 'Echo Form' | 'Burst' | 'Omniscience')[]
      copyResumePhase?: 'start' | 'player' | 'discard'
    }[]
    deferredTriggers?: { id: number; playerId: string; sourceId: string; enemyUid?: string }[]
    sourceNames: ('Double Tap' | 'Blasphemy' | 'Echo Form' | 'Burst' | 'Doppelganger' | 'Foreign Influence' | 'Haunting Echo' | 'Omniscience' | 'Overexert' | 'Replication' | 'Weave' | 'Rapid Fire')[]
    virtualOnly?: boolean
    queuedWeaves?: CardInstance[]
  }
  pendingDistilled?: { playerId: string; cards: CardInstance[] | null }
  pendingRelicScry?: { id: number; playerId: string; relicIndex: number; cards: CardInstance[] | null }
  pendingPlunderSwitches?: CombatState['pendingPlunderSwitches']
  pendingDieRelicChoices?: CombatState['pendingDieRelicChoices']
  pendingHermitSetupLoads?: CombatState['pendingHermitSetupLoads']
  pendingHermitChamberPlays?: CombatState['pendingHermitChamberPlays']
  pendingHermitStrengthRewards?: CombatState['pendingHermitStrengthRewards']
  /** Only the viewer's own card-play windows. */
  pendingCardPlayWindows?: CombatState['pendingCardPlayWindows']
  pendingPlayerChoices?: CombatState['pendingPlayerChoices']
  /** A Ritual Dagger+ reveal is null for everyone but its owner. */
  pendingSlayerChoices?: CombatState['pendingSlayerChoices']
  playedCardsThisTurn: PlayedCard[]
  viewerStanceChangedThisTurn?: boolean
  presentationEvents: CombatPresentationEvent[]
  pendingSummons: {
    sourceUid: string
    row: number
    defIds: string[]
    turn: number
    timing?: 'startOfTurn' | 'endOfTurn'
    direct?: boolean
    isBoss?: boolean
    strength?: number
    strengthDefId?: string
    strengthPerPower?: boolean
  }[]
  log: string[]
}

export type VisibleRun = {
  ascension: number
  chooseYourRelic: boolean
  lastStand: boolean
  meta: RunMetaState
  setup: QuickSetupState | null
  act: number
  phase: RunPhase
  neow: {
    players: Record<string, {
      card: NeowCard | undefined
      redRewardPending: boolean
      redReward: NeowRewardOffer | null
      blueOption: number | null
      pendingEffect: import('../game/neow.ts').NeowImmediateReward | null
      transformExcludedUids?: string[]
      rewardKind: NeowRewardOffer['kind'] | null
      reward: NeowRewardOffer | null
      availableSources: import('../game/run.ts').RewardSource[]
      done: boolean
    } | null>
  } | null
  pendingBossDefId: string | null
  pendingGuardianSockets: PendingGuardianSocket[]
  /** Public boss rolled at setup, unlike a pending second boss. */
  actBossDefId: string | null
  canRerollDownfallSelfBoss?: boolean
  map: SpireMap
  log: string[]
  players: VisiblePlayer[]
  combat: VisibleCombat | null
  rewards: CardRewardOffer[]
  roomState: MerchantState | RelicRewardState | EventRoomState | null
  courier: { usedBy: string[]; offer: CourierOffer | null }
  campaign: {
    runId: string
    bossesDefeated: number
    highestBossActDefeated: 0 | 1 | 2 | 3 | 4
    bossCoins?: BossCoinAward[]
    /** Only the viewer's own Catch Up hero is sent. */
    joinedAfterBosses?: Partial<Record<CharacterId, number>>
    keys: SpireKeys
    finalized: boolean
  }
}

export type RoomSnapshot = {
  earnedAscension?: number
  code: string
  phase: 'lobby' | 'run'
  selectingCampaign: boolean
  ascension: number
  chooseYourRelic: boolean
  lastStand: boolean
  metaOptions: { mode: 'standard' | 'custom'; modifiers: DailyModifierId[]; quickStartAct: 1 | 2 | 3 | 4 }
  /** Recent recorded runs retain the awards missed by a disconnected seat. */
  recordedRuns?: { runId: string; bossCoins: BossCoinAward[]; skip: number }[]
  /** Lobby union, frozen when the run starts. Older servers omit it. */
  cardPacks?: CardPackId[]
  version: number
  /** A new boot id lets a restored room resume at a lower version. */
  epoch?: string
  you: PublicSeat
  seats: PublicSeat[]
  pendingRelic?: PendingRelicPreview | null
  pendingRelicStatus?: { playerId: string; playerName: string; relicId: string } | null
  pendingTeammateAcquisitionPlayerId?: string | null
  campfireChoice?: { choice: CampfireChoice; cardUid?: string }
  campfireTransformAvailable?: boolean
  quickSetupTransformAvailable?: boolean
  campfireDecided: string[]
  endTurnDecided: string[]
  endTurnRequired: string[]
  endTurnTopPlayerIds?: string[]
  endTurnAbilities?: EndTurnAbility[]
  startTurnAbilities?: StartTurnAbility[]
  startTurnDecided: string[]
  startTurnRequired: string[]
  startTurnCoordinatorId?: string | null
  startTurnChoiceId?: string
  startTurnEnemyTargets?: Record<string, string>
  startTurnChoices?: StartTurnChoice[]
  stagedStartTurnTriggers?: (PendingTriggerAbility & { choiceId: string })[]
  startTurnPostRollLocked?: boolean
  startTurnOrderPending?: boolean
  startTurnOrderLocked?: boolean
  startTurnScryAbilities?: StartTurnScryAbility[]
  startTurnScry?: {
    id: string
    playerId: string
    label: string
    amount: number
    cards: CardInstance[] | null
  }
  startTurnDiscard?: {
    playerId: string
    sourceId: string
    label: string
    remaining: number
    cards: CardInstance[] | null
  }
  discardOrder?: string[]
  cardPreview?: {
    cardUid: string
    copy?: boolean
    chamber?: boolean
    kind: 'discard' | 'scry' | 'scryToHand' | 'topdeck' | 'search' | 'load' | 'loadAny'
    cards: CardInstance[]
    spendMiracle: boolean
    enemyUid: string | null
    energySpent?: number
    slimeUids?: string[]
    slimeEnemyUids?: string[]
  }
  powerPreview?: { id: number; powerUid: string; kind: 'scry'; cards: CardInstance[] }
  cardChoicePlayerId?: string
  merchantPledges?: Record<string, { buyerId: string; section?: string; slot?: number; kind?: 'removal'; cardUid?: string; potionRecipientId?: string; discardPotionId?: string; payments: Record<string, number> }>
  merchantReady?: string[]
  courierPledge?: { playerId: string; id: string; discardPotionId?: string; payments: Record<string, number> }
  eventPledge?: { actorId: string; optionId: string; cost: number; payments: Record<string, number>; decision: EventDecision }
  eventCanSkip: boolean
  unavailableEventOptionIds: string[]
  giveUpVote?: {
    runId: string
    deadlineAt: number
    remainingMs: number
    receivedAt?: number
    eligiblePlayerIds: string[]
    votes: Record<string, boolean>
  }
  campaignProgress: CampaignProgress
  run: VisibleRun | null
}

export type ActionOutcome = {
  status: 'accepted' | 'refused' | 'reconciled' | 'unknown'
  snapshot?: RoomSnapshot
  refreshAttempt?: number
}
