import { fail } from './errors.mjs'
import { revealCourier, decideCourier, courierCost } from '../../../src/game/state.ts'

/** @typedef {import('../../../src/server/room-state.ts').ActiveRoom} ActiveRoom */
/** @typedef {import('../../../src/server/room-state.ts').RoomSeat} Seat */
/** @typedef {import('../../../src/protocol/decisions.ts').CourierAction} CourierAction */

/** @param {{ snapshotFor: import('../../../src/server/room-state.ts').RoomProjection }} callbacks */
export function createCourierActions({ snapshotFor }) {
  /** @param {ActiveRoom} room @param {Seat} seat @param {Extract<CourierAction, {kind: 'courierReveal'}>} action @param {string} seatToken */
  function courierReveal(room, seat, action, seatToken) {
    if (action.kind !== 'courierReveal' || (action.itemKind !== 'relic' && action.itemKind !== 'potion')) fail('Choose a Courier deck')
    const next = revealCourier(room.run, seat.playerId, action.itemKind)
    if (next === room.run) fail('The Courier cannot reveal that deck now')
    room.run = next
    room.courierPledge = undefined
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {Extract<CourierAction, {kind: 'courierResolve'}>} action @param {string} seatToken */
  function courierResolve(room, seat, action, seatToken) {
    const offer = room.run?.courier?.offer
    if (!offer) fail('The Courier has no offer')
    if (action.playerId !== undefined && action.playerId !== offer.playerId) fail('That Courier offer belongs to another player')
    if (action.decision === 'discard') {
      if (seat.playerId !== offer.playerId) fail('Only the Courier owner may discard the offer')
      const next = decideCourier(room.run, offer.playerId, 'discard')
      if (next === room.run) fail('That Courier decision is not legal')
      room.run = next
      room.courierPledge = undefined
      room.version += 1
      return { changed: true, snapshot: snapshotFor(room, seatToken) }
    }
    if (action.decision !== 'buy') fail('Choose whether to buy or discard')
    const amount = action.payments?.[seat.playerId]
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || Object.keys(action.payments ?? {}).some((id) => id !== seat.playerId)) fail('You may pledge only your own Gold')
    const combat = room.run.combat
    const payer = combat?.players.find((player) => player.id === seat.playerId)
    if (!combat || !payer || payer.dead || amount > payer.gold) fail('A fallen player cannot fund The Courier')
    const cost = courierCost(offer)
    if (cost === null) fail('That Courier card cannot be bought')
    const pending = room.courierPledge
    if (!pending && seat.playerId !== offer.playerId) fail('The Courier owner must authorize the purchase')
    if (pending && (pending.playerId !== offer.playerId || pending.id !== offer.id || pending.discardPotionId !== action.discardPotionId)) fail('That Courier purchase changed')
    if (!pending && action.discardPotionId && seat.playerId !== offer.playerId) fail('The Potion owner must authorize replacement')
    const payments = { ...(pending?.payments ?? {}), [seat.playerId]: amount }
    const total = Object.values(payments).reduce((sum, paid) => sum + paid, 0)
    if (total > cost) fail(`That Courier offer needs only ${cost} Gold`)
    if (!pending && combat.players.filter((player) => !player.dead).reduce((sum, player) => sum + player.gold, 0) < cost) fail('The party cannot afford that Courier offer')
    const pledge = { playerId: offer.playerId, id: offer.id, discardPotionId: action.discardPotionId, payments }
    if (!pending) {
      const probe = structuredClone({ ...room.run, combat })
      const owner = probe.combat.players.find((player) => player.id === offer.playerId)
      if (!owner) fail('That Courier purchase is not legal')
      owner.gold = cost
      if (decideCourier(probe, offer.playerId, 'buy', { [offer.playerId]: cost }, action.discardPotionId) === probe) fail('That Courier purchase is not legal')
    }
    if (total === cost) {
      const next = decideCourier(room.run, offer.playerId, 'buy', payments, action.discardPotionId)
      if (next === room.run) fail('That Courier purchase is not legal')
      room.run = next
      room.courierPledge = undefined
    } else room.courierPledge = pledge
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  return { courierReveal, courierResolve }
}
