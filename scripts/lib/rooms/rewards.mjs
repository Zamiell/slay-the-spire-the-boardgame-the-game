import { fail } from './errors.mjs'
import {
  chooseRelicReward, revealCardReward, resolveGoldReward, resolveRelicReward,
  resolveBossRelicReward, resolvePotionReward, resolveTransformReward, resolveCardRewards,
} from '../../../src/game/state.ts'

/** @typedef {import('../../../src/server/room-state.ts').RoomState} Room */
/** @typedef {import('../../../src/server/room-state.ts').ActiveRoom} ActiveRoom */
/** @typedef {import('../../../src/server/room-state.ts').RoomSeat} Seat */
/** @typedef {import('../../../src/server/room-state.ts').RoomSettlement} Settlement */
/** @typedef {import('../../../src/protocol/decisions.ts').RelicRewardAction} RelicAction */
/** @typedef {import('../../../src/protocol/decisions.ts').CardRewardAction} CardAction */
/** @typedef {import('../../../src/protocol/decisions.ts').TransformRewardAction} TransformAction */

/** Skip every disconnected seat's reward stages deterministically. */
/** @param {Room} room */
export function settleDisconnectedRewards(room) {
  for (const seat of room.seats.filter((candidate) => candidate.connected === false)) {
    for (;;) {
      const run = room.run
      const offer = run?.phase === 'reward'
        ? run.rewards.find((candidate) => candidate.playerId === seat.playerId)
        : undefined
      if (!run || !offer) break
      const pendingTinyHouse = run.players.find((player) => player.id === seat.playerId)?.relics
        .some((relic) => relic.pending && relic.defId === 'tiny_house')
      const next = pendingTinyHouse && offer.potion !== false
        ? resolvePotionReward(run, seat.playerId, { kind: 'skip' })
        : offer.gold
        ? resolveGoldReward(run, seat.playerId, false)
        : offer.transformReward
        ? resolveTransformReward(run, seat.playerId, null)
        : offer.potion !== false
        ? resolvePotionReward(run, seat.playerId, { kind: 'skip' })
        : (offer.relic ?? false) !== false
          ? resolveRelicReward(run, seat.playerId, false)
          : (offer.bossRelics ?? false) !== false
            ? resolveBossRelicReward(run, seat.playerId, null)
            : offer.cardReward && !run.rewards.some((other) => other.playerId !== seat.playerId && other.cardReward &&
              room.seats.find((candidate) => candidate.playerId === other.playerId)?.connected)
              ? resolveCardRewards(run, { [seat.playerId]: null })
            : run
      if (next === run) break
      room.run = next
      room.version += 1
    }
  }
}

/** @param {{ settlePendingRelics: Settlement; settleForcedCards: Settlement }} callbacks */
export function createRewardActions({ settlePendingRelics, settleForcedCards }) {
  /** @param {ActiveRoom} room @param {Seat} seat @param {RelicAction} action */
  function relicReward(room, seat, action) {
    if (room.run?.phase === 'reward' && action.choice !== undefined) {
      if (!['gain', 'skip'].includes(action.choice)) fail('Choose gain or skip for the Relic reward')
      const next = resolveRelicReward(room.run, seat.playerId, action.choice === 'gain')
      if (next === room.run) fail('That Relic reward choice is not legal')
      room.run = next
      settleDisconnectedRewards(room)
      settleReward(room)
      room.version += 1
      return { changed: true }
    }
    if (action.playerId !== undefined && action.playerId !== seat.playerId) fail('Choose only your own relic')
    if (action.decision === undefined) fail('That relic choice is not legal')
    const next = chooseRelicReward(room.run, seat.playerId, action.decision)
    if (next === room.run) fail('That relic choice is not legal')
    room.run = next
    settlePendingRelics(room)
    room.version += 1
    return { changed: true }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {CardAction} action */
  function cardReward(room, seat, action) {
    const run = room.run
    if (run.phase !== 'reward') fail('The party is not choosing rewards')
    const offer = run.rewards.find((candidate) => candidate.playerId === seat.playerId && candidate.cardReward)
    if (!offer) fail('This seat has no card reward')
    const choice = action.choice
    if (choice === 'reveal') {
      const sources = Array.isArray(action.sources) && action.sources.length <= 3
        ? action.sources.filter((source) => typeof source === 'string') : []
      const next = revealCardReward(run, seat.playerId, sources)
      if (next === run) fail('This reward is already revealed')
      room.run = next
      settleDisconnectedRewards(room)
      room.version += 1
      return { changed: true }
    }
    if (choice !== null && (
      offer.choices === null || !Number.isInteger(choice) || choice < 0 || choice >= offer.choices.length
    )) {
      fail('Choose one of your revealed cards or skip')
    }
    const next = resolveCardRewards(run, { [seat.playerId]: choice })
    if (next === run) fail('That card reward choice is no longer legal')
    room.run = next
    settleDisconnectedRewards(room)
    room.version += 1
    return { changed: true }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {TransformAction} action */
  function transformReward(room, seat, action) {
    const run = room.run
    if (run.phase !== 'reward') fail('The party is not choosing rewards')
    if (!run.rewards.some((offer) => offer.playerId === seat.playerId && offer.transformReward)) {
      fail('This seat has no Transform reward')
    }
    if (action.cardUid !== null && typeof action.cardUid !== 'string') fail('Choose one card to Transform or skip')
    const next = resolveTransformReward(run, seat.playerId, action.cardUid)
    if (next === run) fail('That card cannot be Transformed')
    room.run = next
    settlePendingRelics(room)
    settleDisconnectedRewards(room)
    settleReward(room)
    room.version += 1
    return { changed: true }
  }

  /** Drain reward choices saved by the former party-wide confirmation flow. */
  /** @param {Room} room */
  function settleReward(room) {
    const run = room.run
    if (!run || run.phase !== 'reward' || !room.rewardChoices) return null
    const next = resolveCardRewards(run, room.rewardChoices)
    if (next !== run) {
      room.rewardChoices = undefined
      room.rewardConfirmed = undefined
      room.run = next
      settleForcedCards(room)
      room.version += 1
    }
    return null
  }

  return { relicReward, cardReward, transformReward, settleReward }
}

/**
 * @param {import('../../../src/game/run.ts').RunState} run
 * @param {Seat} seat
 * @param {import('../../../src/protocol/decisions.ts').LootAction} action
 */
export function resolveLootAction(run, seat, action) {
  switch (action.kind) {
    case 'goldReward':
      if (action.gain !== undefined && typeof action.gain !== 'boolean') fail('Choose whether to take the Gold reward')
      return resolveGoldReward(run, seat.playerId, action.gain !== false)
    case 'potionReward': {
      if (run.phase !== 'reward') fail('The party is not choosing rewards')
      const offer = run.rewards.find((candidate) => candidate.playerId === seat.playerId)
      if (!offer || offer.potion === false) fail('This seat has no Potion reward')
      /** @type {import('../../../src/game/run.ts').PotionRewardDecision | null} */
      const decision = action.choice === 'skip' ? { kind: 'skip' }
        : action.choice === 'skipAll' ? { kind: 'skipAll' }
        : action.choice === 'gain' ? { kind: 'gain' }
          : action.choice === 'pass' ? { kind: 'pass', playerId: action.playerId }
            : action.choice === 'replace' ? { kind: 'replace', potionId: action.potionId }
              : null
      if (!decision) fail('Choose a legal Potion reward action')
      const next = resolvePotionReward(run, seat.playerId, decision)
      if (next === run) fail('That Potion reward choice is no longer legal')
      return next
    }
    case 'relicReward': {
      if (!['gain', 'skip'].includes(action.choice)) fail('Choose gain or skip for the Relic reward')
      const next = resolveRelicReward(run, seat.playerId, action.choice === 'gain')
      if (next === run) fail('That Relic reward choice is not legal')
      return next
    }
    case 'bossRelicReward': {
      if (action.choice !== 'gain' && action.choice !== 'skip') {
        fail('Choose gain or skip for the boss Relic reward')
      }
      if (action.choice === 'gain' && typeof action.relicId !== 'string') {
        fail('Choose a revealed boss Relic to gain')
      }
      if (action.choice === 'skip' && action.relicId !== undefined) {
        fail('A boss Relic skip cannot name a Relic')
      }
      const next = resolveBossRelicReward(run, seat.playerId,
        action.choice === 'gain' ? action.relicId : null)
      if (next === run) fail('That boss Relic choice is not legal')
      return next
    }
    default: return fail('Unknown reward action')
  }
}
