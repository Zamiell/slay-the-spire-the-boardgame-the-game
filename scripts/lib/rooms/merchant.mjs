import { fail } from './errors.mjs'
import { finishMerchant, purchaseAtMerchant, merchantPurchaseCost, merchantRemovalCost, removeAtCurrentMerchant } from '../../../src/game/state.ts'

/** @typedef {import('../../../src/server/room-state.ts').RoomState} Room */
/** @typedef {import('../../../src/server/room-state.ts').ActiveRoom} ActiveRoom */
/** @typedef {import('../../../src/server/room-state.ts').RoomSeat} Seat */
/** @typedef {import('../../../src/protocol/decisions.ts').MerchantPurchaseAction} PurchaseAction */
/** @typedef {import('../../../src/protocol/decisions.ts').MerchantRemoveAction} RemoveAction */
/** @typedef {import('../../../src/protocol/decisions.ts').MerchantWithdrawAction} WithdrawAction */

/** @param {import('../../../src/game/noncombat.ts').MerchantPurchase} purchase */
function purchaseKey(purchase) {
  return `${purchase?.buyerId ?? ''}/${purchase?.section ?? ''}/${purchase?.slot ?? ''}`
}

/** @param {Room} room @param {string} playerId @param {string} exceptKey */
export function pledgedGold(room, playerId, exceptKey) {
  return Object.entries(room.merchantPledges ?? {}).reduce((sum, [key, pledge]) =>
    key === exceptKey ? sum : sum + (pledge.payments?.[playerId] ?? 0), 0)
}

/** @param {import('../../../src/game/run.ts').RunState} run */
export function merchantPlayers(run) {
  const setup = run.setup
  return setup?.kind === 'catch-up'
    ? run.players.filter((player) => setup.playerIds.includes(player.id))
    : run.players
}

/** @param {Room} room @param {string} playerId */
function resetMerchantReady(room, playerId) {
  if (!room.merchantReady?.includes(playerId)) return false
  room.merchantReady = room.merchantReady.filter((id) => id !== playerId)
  if (room.merchantReady.length === 0) room.merchantReady = undefined
  return true
}

/** @param {{ settlePendingRelics: import('../../../src/server/room-state.ts').RoomSettlement }} callbacks */
export function createMerchantActions({ settlePendingRelics }) {
  /** Each token pledges only its own gold; the purchase settles atomically at exact cost. */
  /** @param {ActiveRoom} room @param {Seat} seat @param {PurchaseAction} action */
  function merchantPurchase(room, seat, action) {
    const run = room.run
    if (run.phase !== 'room' || run.roomState?.kind !== 'merchant') fail('The party is not at a Merchant')
    const purchase = action.purchase
    const eligible = merchantPlayers(run)
    if (!eligible.some((player) => player.id === seat.playerId)) fail('Only Catch Up players visit this Merchant')
    if (!purchase || typeof purchase.buyerId !== 'string' || !eligible.some((player) => player.id === purchase.buyerId) ||
      !['relic', 'potion', 'card', 'colorless'].includes(purchase.section) || !Number.isInteger(purchase.slot) || purchase.slot < 0) {
      fail('Choose a valid Merchant offer and seated buyer')
    }
    const amount = purchase.payments?.[seat.playerId]
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || Object.keys(purchase.payments ?? {}).some((id) => id !== seat.playerId)) {
      fail('You may pledge only your own Gold')
    }
    const payer = eligible.find((player) => player.id === seat.playerId)
    const key = purchaseKey(purchase)
    if (!payer || amount + pledgedGold(room, seat.playerId, key) > payer.gold) fail('You do not have that much unpledged Gold')
    const existing = room.merchantPledges?.[key]
    if (!existing && ['relic', 'potion', 'colorless'].includes(purchase.section) && Object.entries(room.merchantPledges ?? {}).some(([otherKey, pledge]) =>
      otherKey !== key && pledge.section === purchase.section && pledge.slot === purchase.slot)) {
      fail('Another buyer is already funding that shared item')
    }
    if (!existing && purchase.buyerId !== seat.playerId) fail('The buyer must authorize the purchase')
    if (purchase.section === 'potion' && purchase.potionRecipientId && purchase.potionRecipientId !== purchase.buyerId) {
      fail('The potion recipient must authorize the purchase as its buyer')
    }
    if (!existing && purchase.discardPotionId && (purchase.potionRecipientId ?? purchase.buyerId) !== seat.playerId) {
      fail('The potion owner must authorize replacing a Potion')
    }
    if (existing && (existing.buyerId !== purchase.buyerId || existing.section !== purchase.section || existing.slot !== purchase.slot)) {
      fail('That purchase changed while it was being funded')
    }
    if (existing && (existing.potionRecipientId !== purchase.potionRecipientId || existing.discardPotionId !== purchase.discardPotionId)) {
      fail('That purchase recipient changed while it was being funded')
    }
    const payments = { ...(existing?.payments ?? {}), [seat.playerId]: amount }
    const total = Object.values(payments).reduce((sum, value) => sum + value, 0)
    const available = merchantPurchaseCost(run.roomState, purchase)
    if (available === null) fail('That item is no longer for sale')
    if (total > available) fail(`That purchase needs only ${available} Gold`)
    if (!existing && eligible.reduce((sum, player) => sum + player.gold - pledgedGold(room, player.id, key), 0) < available) fail('The party cannot afford that purchase')
    const pledge = { buyerId: purchase.buyerId, section: purchase.section, slot: purchase.slot, potionRecipientId: purchase.potionRecipientId, discardPotionId: purchase.discardPotionId, payments }
    if (!existing) {
      const probe = structuredClone(run)
      const buyer = probe.players.find((player) => player.id === purchase.buyerId)
      if (!buyer) fail('Choose a valid Merchant offer and seated buyer')
      buyer.gold = available
      if (purchaseAtMerchant(probe, { ...pledge, payments: { [purchase.buyerId]: available } }) === probe) fail('That purchase cannot be completed')
    }
    if (total < available) room.merchantPledges = { ...room.merchantPledges, [key]: pledge }
    else {
      const next = purchaseAtMerchant(run, pledge)
      if (next === run) fail('That purchase cannot be completed')
      room.run = next
      room.merchantPledges = { ...room.merchantPledges }
      delete room.merchantPledges[key]
      settlePendingRelics(room)
    }
    resetMerchantReady(room, seat.playerId)
    room.version += 1
    return { changed: true }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {RemoveAction} action */
  function merchantRemove(room, seat, action) {
    const run = room.run
    if (run.phase !== 'room' || run.roomState?.kind !== 'merchant') fail('The party is not at a Merchant')
    const eligible = merchantPlayers(run)
    if (!eligible.some((player) => player.id === seat.playerId)) fail('Only Catch Up players visit this Merchant')
    const targetId = action.playerId
    if (!eligible.some((player) => player.id === targetId)) fail('Choose a Catch Up player')
    const amount = action.payments?.[seat.playerId]
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || Object.keys(action.payments ?? {}).some((id) => id !== seat.playerId)) {
      fail('You may pledge only your own Gold')
    }
    const payer = eligible.find((player) => player.id === seat.playerId)
    const key = `remove/${targetId}`
    if (!payer || amount + pledgedGold(room, seat.playerId, key) > payer.gold) fail('You do not have that much unpledged Gold')
    const existing = room.merchantPledges?.[key]
    if (!existing && (seat.playerId !== targetId || typeof action.cardUid !== 'string')) {
      fail('The card owner must choose the card before teammates contribute')
    }
    if (existing?.cardUid && action.cardUid && existing.cardUid !== action.cardUid) fail('That removal is already being funded')
    const payments = { ...(existing?.payments ?? {}), [seat.playerId]: amount }
    const cost = merchantRemovalCost(run.ascension)
    if (Object.values(payments).reduce((sum, value) => sum + value, 0) > cost) fail(`Card removal needs only ${cost} Gold`)
    if (!existing && eligible.reduce((sum, player) => sum + player.gold - pledgedGold(room, player.id, key), 0) < cost) fail('The party cannot afford card removal')
    const cardUid = existing?.cardUid ?? action.cardUid
    if (typeof cardUid !== 'string') fail('That card cannot be removed')
    /** @type {import('../../../src/server/room-state.ts').MerchantPledge & {kind: 'removal'; cardUid: string}} */
    const pledge = { kind: 'removal', buyerId: targetId, cardUid, payments }
    if (!existing) {
      const probe = structuredClone(run)
      const buyer = probe.players.find((player) => player.id === targetId)
      if (!buyer) fail('Choose a Catch Up player')
      buyer.gold = cost
      if (removeAtCurrentMerchant(probe, targetId, pledge.cardUid, { [targetId]: cost }) === probe) fail('That card cannot be removed')
    }
    if (Object.values(payments).reduce((sum, value) => sum + value, 0) < cost) room.merchantPledges = { ...room.merchantPledges, [key]: pledge }
    else {
      const next = removeAtCurrentMerchant(run, targetId, pledge.cardUid, payments)
      if (next === run) fail('That card cannot be removed')
      room.run = next
      room.merchantPledges = { ...room.merchantPledges }
      delete room.merchantPledges[key]
    }
    resetMerchantReady(room, seat.playerId)
    room.version += 1
    return { changed: true }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {WithdrawAction} action */
  function merchantWithdraw(room, seat, action) {
    const pending = typeof action.key === 'string' && Object.hasOwn(room.merchantPledges ?? {}, action.key) ? room.merchantPledges?.[action.key] : undefined
    if (!pending || !(seat.playerId in pending.payments)) fail('You have no pledge on that purchase')
    const payments = { ...pending.payments }
    delete payments[seat.playerId]
    room.merchantPledges = { ...room.merchantPledges }
    if (Object.keys(payments).length === 0 || pending.buyerId === seat.playerId) delete room.merchantPledges[action.key]
    else room.merchantPledges[action.key] = { ...pending, payments }
    resetMerchantReady(room, seat.playerId)
    room.version += 1
    return { changed: true }
  }

  /** @param {ActiveRoom} room @param {Seat} seat */
  function merchantResume(room, seat) {
    const run = room.run
    if (run?.phase !== 'room' || run.roomState?.kind !== 'merchant') fail('The party is not at a Merchant')
    if (!merchantPlayers(run).some((player) => player.id === seat.playerId)) fail('Only active players visit this Merchant')
    const changed = resetMerchantReady(room, seat.playerId)
    if (changed) room.version += 1
    return { changed }
  }

  /** @param {ActiveRoom} room @param {Seat} seat */
  function merchantFinish(room, seat) {
    const run = room.run
    if (run?.phase !== 'room' || run.roomState?.kind !== 'merchant') fail('The party is not at a Merchant')
    const connected = new Set(room.seats.filter((candidate) => candidate.connected !== false).map((candidate) => candidate.playerId))
    const visitors = merchantPlayers(run).map((player) => player.id)
    const eligible = visitors.filter((id) => connected.has(id))
    if (!eligible.includes(seat.playerId)) fail(run.setup?.kind === 'catch-up' ? 'Only Catch Up players visit this Merchant' : 'Only active players visit this Merchant')
    if (Object.keys(room.merchantPledges ?? {}).length > 0) fail('Resolve or cancel pending Merchant contributions first')
    room.merchantReady = [...new Set([...(room.merchantReady ?? []), seat.playerId])].filter((id) => visitors.includes(id))
    settleMerchantReady(room)
    room.version += 1
    return { changed: true }
  }

  /** @param {Room} room */
  function settleMerchantReady(room) {
    const run = room.run
    if (run?.phase !== 'room' || run.roomState?.kind !== 'merchant' || Object.keys(room.merchantPledges ?? {}).length > 0) return false
    const connected = new Set(room.seats.filter((seat) => seat.connected !== false).map((seat) => seat.playerId))
    const eligible = merchantPlayers(run).map((player) => player.id).filter((id) => connected.has(id))
    if (eligible.length === 0 || !eligible.every((id) => room.merchantReady?.includes(id))) return false
    const next = finishMerchant(run)
    if (next === run) return false
    room.run = next
    room.merchantPledges = undefined
    room.merchantReady = undefined
    return true
  }

  return { merchantPurchase, merchantRemove, merchantWithdraw, merchantResume, merchantFinish, settleMerchantReady }
}
