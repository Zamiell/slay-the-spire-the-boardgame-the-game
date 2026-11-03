import type { CampfireDecision, PotionRewardDecision, RewardSource } from '../game/run.ts'
import type { MerchantPurchase, TreasureDecision } from '../game/noncombat.ts'
import type { NeowDecision } from '../game/neow.ts'
import type { EventDecision } from '../game/event-room.ts'
import type { CombatAction } from './combat-actions.ts'

export type CampfireAction = { kind: 'campfire'; choices: Record<string, CampfireDecision> }
export type CardRewardAction = { kind: 'cardReward'; choice: number | null | 'reveal'; sources?: RewardSource[] }
export type PotionRewardAction = { kind: 'potionReward' } & (
  | { choice: 'gain' | 'skip' | 'skipAll' }
  | { choice: 'pass'; playerId: string }
  | { choice: 'replace'; potionId: string }
)
export function potionRewardAction(decision: PotionRewardDecision): PotionRewardAction {
  switch (decision.kind) {
    case 'pass': return { kind: 'potionReward', choice: 'pass', playerId: decision.playerId }
    case 'replace': return { kind: 'potionReward', choice: 'replace', potionId: decision.potionId }
    default: return { kind: 'potionReward', choice: decision.kind }
  }
}
export type RelicRewardAction =
  | { kind: 'relicReward'; choice: 'gain' | 'skip'; playerId?: undefined; decision?: undefined }
  | { kind: 'relicReward'; playerId?: string; decision: TreasureDecision; choice?: undefined }
export type BossRelicRewardAction = { kind: 'bossRelicReward' } & (
  | { choice: 'gain'; relicId: string }
  | { choice: 'skip'; relicId?: undefined }
)
export type TransformRewardAction = { kind: 'transformReward'; cardUid: string | null }
export type LootAction = { kind: 'goldReward'; gain?: boolean } | PotionRewardAction |
  Extract<RelicRewardAction, { choice: 'gain' | 'skip' }> | BossRelicRewardAction
export type NoncombatAction = CampfireAction | CardRewardAction | LootAction | TransformRewardAction

export type MerchantPurchaseAction = { kind: 'merchantPurchase'; purchase: MerchantPurchase }
export type MerchantRemoveAction = { kind: 'merchantRemove'; playerId: string; cardUid?: string; payments: Record<string, number> }
export type MerchantWithdrawAction = { kind: 'merchantWithdraw'; key: string }
export type MerchantAction = MerchantPurchaseAction | MerchantRemoveAction | MerchantWithdrawAction |
  { kind: 'merchantResume' | 'merchantFinish' }
export type NeowAction =
  | { kind: 'neow'; stage: 'reveal'; sources?: RewardSource[] }
  | { kind: 'neow'; stage: 'red' | 'reward'; choice: number | null | PotionRewardDecision }
  | { kind: 'neow'; stage: 'effect'; gain: boolean; cardUids: NonNullable<NeowDecision['cardUids']> }
  | { kind: 'neow'; stage: 'option'; optionIndex: number; cardUids: NonNullable<NeowDecision['cardUids']> }
export type AcquisitionAction =
  | { kind: 'choosePendingRelicReward'; pendingRelicId: number; reward: number; choice: number }
  | { kind: 'resolvePendingRelic'; pendingRelicId: number; cardUids: string[]; rewardIndices: number[] }
  | { kind: 'resolveGuardianSocket'; cardUid: string; gemId: string | null }
export type SetupAction = { kind: 'setupStep'; cardUids: string[] }
export type EventAction =
  | { kind: 'event'; playerId?: string; decision: EventDecision }
  | { kind: 'eventSkip'; playerId?: string }
  | { kind: 'eventCancel' }
export type CourierAction =
  | { kind: 'courierReveal'; itemKind: 'relic' | 'potion' }
  | { kind: 'courierResolve'; playerId?: string; decision: 'buy' | 'discard'; payments?: Record<string, number>; discardPotionId?: string }

/** Current client contracts. The server still validates untrusted and legacy wire inputs. */
export type RoomDecisionAction = NoncombatAction | RelicRewardAction | MerchantAction | NeowAction | AcquisitionAction | SetupAction |
  EventAction | CourierAction

type RunProgressAction =
  | { kind: 'enterRoom'; roomId: string; useWingBoots?: boolean }
  | { kind: 'switchBetweenCombatRow'; row: number }
  | { kind: 'tradePotion'; potionId: string; playerId: string }
  | { kind: 'usePotionOutsideCombat'; potionId: string; replacePotionId?: string }
  | { kind: 'giveUpVote'; vote: 'start'; deadlineAt?: undefined }
  | { kind: 'giveUpVote'; vote: 'yes' | 'no'; deadlineAt: number }
  | { kind: 'allocateCampaign'; colorless: number; actIV: number; expectedUnspentMarks: number; expectedRunId: string }
  | { kind: 'leaveRoom' | 'advanceAct' | 'startPendingBoss' | 'rerollDownfallSelfBoss' | 'finishRun' | 'returnToLobby' }

export type RoomAction = RoomDecisionAction | CombatAction | RunProgressAction
