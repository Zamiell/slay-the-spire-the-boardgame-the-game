import type { RoomDecisionAction } from '../../src/protocol/decisions.ts'
import type { RoomSeat } from '../../src/server/room-state.ts'
import type { PublicSeat } from '../../src/protocol/room.ts'
import type { CombatView } from '../../src/game/combat/view.ts'
import { playCard, evaluateCombatQuery } from '../../src/game/combat.ts'

const decision = (action: RoomDecisionAction) => action
decision({ kind: 'potionReward', choice: 'pass', playerId: 'p2' })
decision({ kind: 'merchantPurchase', purchase: { buyerId: 'p1', section: 'relic', slot: 0, payments: { p1: 5 } } })
decision({ kind: 'bossRelicReward', choice: 'skip' })
// @ts-expect-error A Potion pass must identify its recipient.
decision({ kind: 'potionReward', choice: 'pass' })
// @ts-expect-error A boss Relic gain must identify the revealed Relic.
decision({ kind: 'bossRelicReward', choice: 'gain' })
// @ts-expect-error A Merchant purchase must name its funding.
decision({ kind: 'merchantPurchase', purchase: { buyerId: 'p1', section: 'relic', slot: 0 } })
// @ts-expect-error A card index is not a boolean.
decision({ kind: 'cardReward', choice: true })
// @ts-expect-error An upgrade's card id belongs inside the owner's campfire decision.
decision({ kind: 'campfire', cardUid: 'c1' })

const publicSeat: PublicSeat = { playerId: 'p1', name: 'Ann', character: 'ironclad', connected: true }
const authorize = (seat: RoomSeat) => seat.token
// @ts-expect-error A projected seat is not a private authorization identity.
authorize(publicSeat)

declare const combatView: CombatView
// @ts-expect-error A partial presentation view is not mutation authority.
playCard(combatView, 'p1', 'c1')
// @ts-expect-error Private calculations require real authority, not a projection.
evaluateCombatQuery(combatView, 'p1', { kind: 'hud' })
// @ts-expect-error A presentation view does not manufacture an RNG.
combatView.rng.seed
// @ts-expect-error A private hand is unknown, not an empty array.
combatView.players[0]!.hand.length
