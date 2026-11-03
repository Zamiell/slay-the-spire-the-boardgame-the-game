import type { RoomDecisionAction } from '../../src/protocol/decisions.ts'
import type { RoomSeat } from '../../src/server/room-state.ts'
import type { PublicSeat } from '../../src/protocol/room.ts'
import type { CombatView } from '../../src/game/combat/view.ts'
import { playCard, evaluateCombatQuery } from '../../src/game/combat.ts'
import type { NoncombatPlayerView } from '../../src/ui/noncombat-player.ts'
import { addCard } from '../../src/game/acquisition.ts'
import type { VisiblePreparedCombat } from '../../src/protocol/room.ts'
import { startTurnScryPreview } from '../../src/game/combat.ts'
import type { StartTurnAbility } from '../../src/game/combat.ts'
import type { WirePlayerTarget, WireStartTurnAbility } from '../../src/protocol/combat-replies.ts'
import type { CombatScreenProps } from '../../src/ui/combat-screen/types.ts'

declare const sendCombat: NonNullable<CombatScreenProps['onAction']>
declare const session: ReturnType<typeof import('../../src/multiplayer/useRoomSession.ts').useRoomSession>
sendCombat({ kind: 'spendShiv', enemyUid: 'e1' })
sendCombat({ kind: 'playCardCopy', cardUid: 'c1', copyId: 7 })
session.act({ kind: 'enterRoom', roomId: 'room-1' })
// @ts-expect-error Enemy identifiers are strings at the UI boundary.
sendCombat({ kind: 'spendShiv', enemyUid: 123 })
// @ts-expect-error The transport must not erase the combat contract.
session.act({ kind: 'spendShiv', enemyUid: 123 })
// @ts-expect-error A copied play identifies its exact copy instance.
sendCombat({ kind: 'playCardCopy', cardUid: 'c1' })
// @ts-expect-error Reveal actions are not read-only queries.
sendCombat({ kind: 'previewCard', cardUid: 'c1', enemyUid: null })
// @ts-expect-error Unknown action kinds cannot be sent by the client.
session.act({ kind: 'inventedAction' })
// @ts-expect-error Engine-only observers are not wire choices.
sendCombat({ kind: 'playCard', cardUid: 'c1', previewShivTarget: () => true })
// @ts-expect-error Closed client choice contracts do not inherit loose schema index signatures.
sendCombat({ kind: 'resolvePlayerChoice', choiceId: 1, typo: true })

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

declare const noncombatView: NoncombatPlayerView
// @ts-expect-error A hidden noncombat deck is not an empty deck.
noncombatView.deck.length
// @ts-expect-error Presentation does not reveal the ordered reward supply.
noncombatView.cardRewards.length
// @ts-expect-error A presentation seat cannot acquire a card through the engine.
addCard(noncombatView, 'strike_ironclad', 'c1')
declare const preparedView: VisiblePreparedCombat
// @ts-expect-error A projected encounter cannot reveal the next private draw.
startTurnScryPreview(preparedView)
// @ts-expect-error Event answers must include their option ids.
decision({ kind: 'event', decision: { cardUids: ['c1'] } })
// @ts-expect-error Courier purchases cannot choose a card reward supply.
decision({ kind: 'courierReveal', itemKind: 'card' })

declare const engineAbility: StartTurnAbility
const wireAbility: WireStartTurnAbility = engineAbility
const roundTripAbility: StartTurnAbility = wireAbility
void roundTripAbility
const sameAbilityKeys: Exclude<keyof StartTurnAbility, keyof WireStartTurnAbility> |
  Exclude<keyof WireStartTurnAbility, keyof StartTurnAbility> extends never ? true : never = true
void sameAbilityKeys
// @ts-expect-error Public ally choices use label, not a second player-name contract.
const invalidTarget: WirePlayerTarget = { id: 'p1', name: 'Owner' }
void invalidTarget
