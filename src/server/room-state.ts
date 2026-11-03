import type { RunState, CampfireDecision } from '../game/run.ts'
import type { CampaignProgress } from '../game/campaign.ts'
import type { MerchantPurchase } from '../game/noncombat.ts'
import type { PublicSeat, RoomSnapshot } from '../protocol/room.ts'
import type { CombatState } from '../game/combat.ts'

/** Private identity; never a public snapshot DTO. */
export type RoomSeat = Omit<PublicSeat, 'connected'> & { token: string; connected?: boolean; pendingCatchUp?: boolean }

export type MerchantPledge = Partial<Omit<MerchantPurchase, 'buyerId' | 'payments'>> & {
  kind?: 'removal'
  buyerId: string
  payments: Record<string, number>
  cardUid?: string
}

/** The private room core and fields owned by checked action coordinators. */
export type RoomState = {
  code: string
  lastActivityAt: number
  phase: 'lobby' | 'run'
  ascension: number
  chooseYourRelic: boolean
  lastStand: boolean
  metaOptions: RoomSnapshot['metaOptions']
  seats: RoomSeat[]
  run: RunState | null
  campaignBaseProgress: CampaignProgress
  campaignProgress: CampaignProgress
  version: number
  merchantPledges?: Record<string, MerchantPledge>
  merchantReady?: string[]
  campfireChoices?: Record<string, CampfireDecision>
  rewardChoices?: Record<string, number | null>
  rewardConfirmed?: string[]
  courierPledge?: RoomSnapshot['courierPledge']
  eventPledge?: RoomSnapshot['eventPledge']
  concurrentCardCopies?: NonNullable<CombatState['pendingCardCopy']>[]
  concurrentDistilled?: NonNullable<CombatState['pendingDistilled']>[]
  concurrentRelicScries?: NonNullable<CombatState['pendingRelicScry']>[]
  concurrentForcedCards?: NonNullable<NonNullable<CombatState['startTurnProgress']>['forcedCard']>[]
}

export type ActiveRoom = RoomState & { run: RunState }
export type RoomStore = { rooms: Map<string, RoomState>; file?: string }
export type RoomSettlement = (room: RoomState) => void
export type RoomProjection = (room: RoomState, seatToken: string) => RoomSnapshot
