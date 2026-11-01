import { fail } from './errors.mjs'
import { canUpgradeCard, currentRoom, resolveCampfire } from '../../../src/game/state.ts'
import { campfireNeedsDecision, campfireTransformAvailable } from '../../../src/game/run/campfire.ts'
import { cardIsCurse } from '../../../src/game/cards.ts'

/**
 * A campfire: everyone chooses, then the party leaves together (p.9).
 *
 * Each seat submits only its OWN choice — passing the whole record through let
 * one client Smith everybody else's cards. But the choices also have to be
 * COLLECTED rather than applied one at a time, because `resolveCampfire` moves
 * the party back to the map: applied immediately, the first seat to click
 * would heal alone and drag everyone out of the room.
 */
/**
 * @param {import('../../../src/server/room-state.ts').ActiveRoom} room
 * @param {import('../../../src/server/room-state.ts').RoomSeat} seat
 * @param {import('../../../src/protocol/decisions.ts').CampfireAction} action
 */
export function campfire(room, seat, action) {
  const run = room.run
  if (run.phase !== 'room') fail('The party is not in a room')
  // Not merely "a room": a treasure or event room has no Rest or Smith, and
  // accumulating choices there published a campfire prompt for a room that has
  // none, then threw the choices away.
  if (currentRoom(run.map)?.kind !== 'campfire') fail('This room has no campfire')
  if (seat.playerId in (room.campfireChoices ?? {})) fail('This campfire choice is already locked')

  // Validated, not merely present. `resolveCampfire` treats anything that is
  // not exactly 'rest' as a Smith, and a Smith naming no card silently does
  // nothing — so 'Rest' with a capital R quietly burned a seat's only heal.
  const choice = action.choices?.[seat.playerId]
  if (!choice || !['rest', 'smith', 'leave', 'ruby'].includes(choice.choice)) {
    fail('Choose Rest, Smith, Leave, or the Ruby Key')
  }
  if (choice.choice === 'ruby' && (run.campaignProgress.actIV < 5 || run.campaign.keys.ruby)) {
    fail('The Ruby Key is not available')
  }
  const player = run.players.find((candidate) => candidate.id === seat.playerId)
  if (choice.choice === 'rest' && player?.relics.some((relic) => relic.defId === 'coffee_dripper')) {
    fail('Coffee Dripper prevents Resting')
  }
  if (choice.choice === 'rest' && run.meta?.modifierIds?.includes('night_terrors')) fail('Night Terrors prevents Resting')
  if (choice.choice === 'smith' && player?.relics.some((relic) => relic.defId === 'fusion_hammer')) {
    fail('Fusion Hammer prevents Smithing')
  }
  const restAllowed = !run.meta?.modifierIds?.includes('night_terrors')
  if (choice.choice === 'leave' && (!player || campfireNeedsDecision(
    player, false, restAllowed, run.meta?.ruleset,
  ))) fail('Leave only when this player has no Rest or Smith choice')
  if (choice.removeCardUid !== undefined && (
    choice.choice !== 'rest' || !player?.relics.some((relic) => relic.defId === 'peace_pipe') ||
    !player.deck.some((card) => card.uid === choice.removeCardUid && card.defId !== 'ascenders_bane')
  )) fail('Peace Pipe can remove one of your cards only while Resting')
  if (choice.transformCardUid !== undefined && (
    choice.choice !== 'rest' || !player?.relics.some((relic) => relic.defId === 'straight_razor') ||
    choice.transformCardUid === choice.removeCardUid ||
    !player.deck.some((card) => card.uid === choice.transformCardUid && !cardIsCurse(card.defId)) ||
    !campfireTransformAvailable(player)
  )) fail('Straight Razor can Transform one eligible card only while Resting')
  if (choice.choice === 'smith') {
    const target = player?.deck.find((card) => card.uid === choice.cardUid && canUpgradeCard(card))
    if (!target) fail('Choose one of your own cards that is not already upgraded')
  }

  room.campfireChoices = { ...room.campfireChoices, [seat.playerId]: choice }
  room.version += 1

  const waiting = settleCampfire(room)
  if (waiting) {
    return { changed: true, waitingOn: waiting }
  }
  return { changed: true }
}

/**
 * Resolves the campfire once everyone still present has chosen.
 *
 * Returns the seats still to answer, or null once the party has left. Called
 * both when a choice arrives and when a player drops, because a drop can be
 * the thing that completes the table.
 */
/** @param {import('../../../src/server/room-state.ts').RoomState} room */
export function settleCampfire(room) {
  const run = room.run
  if (!run || run.phase !== 'room') return null
  if (currentRoom(run.map)?.kind !== 'campfire') return null
  const choices = room.campfireChoices
  if (!choices) return null
  // With nobody connected there is no table to un-hold: resolving here would
  // apply whatever partial choices happened to be in, and the players who had
  // not answered would reconnect to find their rest spent.
  if (!room.seats.some((seat) => seat.connected)) return null

  const rubyAvailable = run.campaignProgress.actIV >= 5 && !run.campaign.keys.ruby
  const restAllowed = !run.meta?.modifierIds?.includes('night_terrors')
  const undecided = room.seats.filter((other) => {
    const player = run.players.find((candidate) => candidate.id === other.playerId)
    if (!player || !campfireNeedsDecision(player, rubyAvailable, restAllowed, run.meta?.ruleset)) return false
    // Ruby and ordinary Campfire choices are simultaneous physical decisions.
    // A disconnected seat reconnects to its pending choice; it is never an
    // implicit skip or abstention.
    return !choices[other.playerId]
  })
  if (undecided.length > 0) return undecided.map((other) => other.playerId)

  const next = resolveCampfire(run, choices)
  if (next !== run) {
    room.campfireChoices = undefined
    room.run = next
    room.version += 1
  }
  return null
}
