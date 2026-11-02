import { fail } from './errors.mjs'
import { chooseEvent, canSkipEvent, skipEvent } from '../../../src/game/state.ts'

/** @typedef {import('../../../src/server/room-state.ts').ActiveRoom} ActiveRoom */
/** @typedef {import('../../../src/server/room-state.ts').RoomSeat} Seat */
/** @typedef {import('../../../src/protocol/decisions.ts').EventAction} EventAction */

/** @param {{ snapshotFor: import('../../../src/server/room-state.ts').RoomProjection; settlePendingRelics: import('../../../src/server/room-state.ts').RoomSettlement }} callbacks */
export function createEventActions({ snapshotFor, settlePendingRelics }) {
  /** @param {ActiveRoom} room @param {Seat} seat @param {Extract<EventAction, {kind: 'event'}>} action @param {string} seatToken */
  function eventChoice(room, seat, action, seatToken) {
    const actorId = action.playerId ?? seat.playerId
    if (actorId !== seat.playerId && room.eventPledge?.actorId !== actorId) fail('Choose only your own Event option')
    let decision = action.decision
    /** @param {unknown} value */
    const stringArray = (value) => value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
    if (!decision || typeof decision !== 'object' || !Array.isArray(decision.optionIds) || !decision.optionIds.every((id) => typeof id === 'string') ||
      !stringArray(decision.cardUids) || !stringArray(decision.relicIds) || !stringArray(decision.potionIds) || !stringArray(decision.potionRecipientIds) || !stringArray(decision.rewardSources) || !stringArray(decision.guardianGemIds) ||
      (decision.potionReplacementIds !== undefined && (!Array.isArray(decision.potionReplacementIds) || !decision.potionReplacementIds.every((id) => id === null || typeof id === 'string'))) ||
      (decision.rewardItemChoices !== undefined && (!Array.isArray(decision.rewardItemChoices) || !decision.rewardItemChoices.every((choice) => choice === 'take' || choice === 'skip'))) ||
      decision.rewardItemIds !== undefined || decision.rewardItemKinds !== undefined ||
      (decision.rewardIndexes !== undefined && (!Array.isArray(decision.rewardIndexes) || !decision.rewardIndexes.every((index) => Number.isInteger(index) && index >= -1))) ||
      (decision.payments !== undefined && (!decision.payments || typeof decision.payments !== 'object' || Array.isArray(decision.payments) || Object.entries(decision.payments).some(([id, amount]) => typeof id !== 'string' || !Number.isInteger(amount) || amount < 0))) ||
      decision.receiveCardUid !== undefined || decision.receiveRelicId !== undefined ||
      [decision.targetPlayerId, decision.potionRecipientId, decision.roomId].some((value) => value !== undefined && typeof value !== 'string')) {
      fail('That Event choice is malformed')
    }
    if (room.eventPledge && (room.eventPledge.actorId !== actorId || room.eventPledge.optionId !== decision.optionIds.join(','))) {
      fail('That Event payment changed')
    }
    const eventRoom = room.run.roomState?.kind === 'event' ? room.run.roomState : undefined
    const options = eventRoom
      ? decision.optionIds.map((id) => eventRoom.card.options.find((candidate) => candidate.id === id))
      : []
    const paymentEffects = options.flatMap((option) => option?.effects.filter((effect) => effect.tag === 'pay-gold') ?? [])
    const paysWithItem = paymentEffects.length === 1 && paymentEffects[0]?.filter?.includes('or lose one Relic or Potion') && ((decision.relicIds?.length ?? 0) > 0 || (decision.potionIds?.length ?? 0) > 0)
    if (paysWithItem && seat.playerId !== actorId) fail('Only the Event chooser can offer an item')
    if (room.eventPledge && paysWithItem) fail('That Event payment method is already Gold')
    const cost = paymentEffects.reduce((sum, payment) => sum + (typeof payment.amount === 'number' ? payment.amount : 0), 0)
    const rewardStages = options.some((option) => option?.effects.some((effect) => ['card-reward', 'rare-reward', 'gain-relic', 'gain-potion'].includes(effect.tag)))
    const enginePending = eventRoom?.pendingDecisions?.[actorId]
    const rollPaymentSettled = cost > 0 && enginePending && (eventRoom?.pendingRolls?.[actorId]?.length ?? 0) > 0
    if (rollPaymentSettled) {
      if (enginePending.optionIds.join(',') !== decision.optionIds.join(',')) fail('That Event choice changed after its die roll')
      decision = { ...enginePending }
    }
    else if (cost > 0 && rewardStages && !enginePending) decision = { ...decision, payments: undefined }
    else if (cost > 0 && !paysWithItem) {
      const amount = decision.payments?.[seat.playerId]
      if (typeof amount !== 'number' || !Number.isInteger(amount) || Object.keys(decision.payments ?? {}).some((id) => id !== seat.playerId)) fail('You may pledge only your own Gold')
      const payer = room.run.players.find((player) => player.id === seat.playerId)
      if (!payer || amount > payer.gold) fail('You do not have that much Gold')
      const pending = room.eventPledge
      if (!pending && actorId !== seat.playerId) fail('The Event chooser must authorize payment')
      const optionId = decision.optionIds.join(',')
      if (pending && (pending.actorId !== actorId || pending.optionId !== optionId)) fail('That Event payment changed')
      const payments = { ...(pending?.payments ?? {}), [seat.playerId]: amount }
      const total = Object.values(payments).reduce((sum, paid) => sum + paid, 0)
      if (total > cost) fail(`That Event needs only ${cost} Gold`)
      if (!pending && room.run.players.reduce((sum, player) => sum + player.gold, 0) < cost) fail('The party cannot afford that Event choice')
      const pledge = { actorId, optionId, cost, decision: pending?.decision ?? { ...decision, payments: undefined }, payments }
      if (total < cost) {
        if (!pending) {
          const probe = structuredClone(room.run)
          const actor = probe.players.find((player) => player.id === actorId)
          if (!actor) fail('That Event choice is not legal')
          actor.gold = Math.max(actor.gold, cost)
          if (chooseEvent(probe, actorId, { ...pledge.decision, payments: { [actorId]: cost } }) === probe) fail('That Event choice is not legal')
        }
        room.eventPledge = pledge
        room.version += 1
        return { changed: true, snapshot: snapshotFor(room, seatToken) }
      }
      decision = { ...pledge.decision, payments }
    }
    const next = chooseEvent(room.run, actorId, decision)
    if (next === room.run) fail('That Event choice is not legal')
    room.run = next
    settlePendingRelics(room)
    room.eventPledge = undefined
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {string} seatToken */
  function cancelEventPledge(room, seat, seatToken) {
    if (!room.eventPledge || room.eventPledge.actorId !== seat.playerId) fail('Only the Event chooser can cancel this payment')
    room.eventPledge = undefined
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {Extract<EventAction, {kind: 'eventSkip'}>} action @param {string} seatToken */
  function eventSkip(room, seat, action, seatToken) {
    if (action.playerId !== undefined && action.playerId !== seat.playerId) fail('Skip only your own unavailable Event choice')
    if (!canSkipEvent(room.run, seat.playerId)) fail('A printed Event choice is available')
    room.run = skipEvent(room.run, seat.playerId)
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  return { eventChoice, cancelEventPledge, eventSkip }
}
