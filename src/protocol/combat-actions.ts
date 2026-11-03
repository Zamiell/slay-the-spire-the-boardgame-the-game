import type { PlayContext, PotionContext, PowerContext, RelicContext, StartTurnChoice } from '../game/combat.ts'
import type { DieRelicChoiceAction, PlayerChoiceAction, SlayerChoiceAction } from './actions.ts'

/** Only caller-owned decisions belong on the wire, never engine cursors or callbacks. */
export type CardPlayChoices = Pick<PlayContext,
  'enemyUid' | 'playerId' | 'enemyUids' | 'playerIds' | 'switchWithPlayerId' | 'mode' |
  'discardUids' | 'exhaustUids' | 'topdeckUids' | 'recoverDiscardUid' | 'recoverDiscardUids' |
  'recoverExhaustUid' | 'recoverExhaustUids' | 'searchDrawUids' | 'spendMiracle' |
  'shivEnemyUids' | 'scryDiscardUids' | 'scryToHandUid' | 'evokeSlots' | 'evokeEnemyUids' |
  'energySpent' | 'spendVigor' | 'guardianModeShift' | 'secondGuardianModeShift' |
  'corruptedShardMode' | 'guardianBlockSpend' | 'guardianPowerCardUid' |
  'loadUids' | 'chamberUids' | 'hermitEnemyUids' | 'hermitDieRelics' | 'chooseLoadSelf' |
  'slimeUids' | 'slimeEnemyUids' | 'soulburnEnemyUids' | 'metamorphosisPowerUid'>

type Overflow = { expectedShivOverflow?: number; skipOverflow?: boolean }
export type CardPlayAction = Partial<CardPlayChoices> & Overflow & { cardUid: string } & (
  | { kind: 'playCard' | 'playHermitChamberCard'; copyId?: undefined }
  | { kind: 'playCardCopy'; copyId: number }
)
type RevealBinding = Pick<CardPlayChoices, 'enemyUid' | 'slimeUids' | 'slimeEnemyUids'> & { cardUid: string }
export type CardRevealAction = RevealBinding & (
  | { kind: 'previewCard'; spendMiracle: boolean }
  | { kind: 'previewCardCopy'; copyId: number }
  | { kind: 'previewHermitChamberCard'; energySpent?: number }
)
type TriggerChoices = Pick<PlayContext, 'loadUids' | 'chamberUids' | 'hermitEnemyUids' | 'slimeUids' | 'slimeEnemyUids'>

/** Current client messages. Server parsing still accepts and validates legacy/untrusted inputs. */
export type CombatAction = { preflight?: boolean } & (
  | CardPlayAction | CardRevealAction
  | Pick<DieRelicChoiceAction, 'kind' | 'choiceId' | 'enemyUid' | 'discardUids' | 'exhaustUids'>
  | Pick<PlayerChoiceAction, 'kind' | 'choiceId' | 'draw' | 'discardUid' | 'count'>
  | Pick<SlayerChoiceAction, 'kind' | 'choiceId' | 'enemyUid' | 'replace'>
  | { kind: 'activatePower'; powerUid: string; powerPreviewId?: number } & PowerContext
  | { kind: 'previewPowerChoice'; powerUid: string }
  | { kind: 'activateRelic'; relicIndex: number; relicScryId?: number } & RelicContext
  | { kind: 'usePotion'; potionId: string } & PotionContext & Overflow
  | { kind: 'spendShiv'; enemyUid: string; all?: boolean }
  | { kind: 'spendSoulburn'; enemyUid: string; extraCrispyPowerUid?: string }
  | { kind: 'resolveHermitSetupLoad'; cardUid: string; enemyUid?: string | null }
  | { kind: 'resolveHermitStrengthReward'; playerId: string }
  | { kind: 'resolvePlunderRowSwitch'; row: number | null }
  | { kind: 'orderStartTurnScries'; order: string[] }
  | { kind: 'resolveStartTurnScry'; sourceId: string; discardUids: string[] }
  | { kind: 'resolveStartTurnDiscard'; sourceId: string; discardUid: string }
  | { kind: 'resolveStartTurn'; choices: StartTurnChoice[] }
  | { kind: 'resolveEndTurnEffect'; abilityId: string; targetUid?: string }
  | { kind: 'discardHand'; discardOrder: string[] }
  | { kind: 'finishCardPlayWindow'; windowId: string }
  | { kind: 'chooseDistilledCard'; cardUid: string }
  | { kind: 'resolveTrigger'; triggerId: number; enemyRow?: number; enemyUid?: string; targetPlayerId?: string;
      hermitChoices?: TriggerChoices; slimeUids?: string[]; slimeEnemyUids?: string[] }
  | { kind: 'spendMiracle' | 'spendVigor' | 'endTurn' | 'resolveEnemies' | 'startTurn' | 'resolveCombat' }
)
