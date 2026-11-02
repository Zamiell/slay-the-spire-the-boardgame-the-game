import { fail } from './errors.mjs'
import { neowPreview, revealNeowReward, resolveNeowReward, chooseNeow, resolveNeowEffect, advanceQuickSetup } from '../../../src/game/state.ts'

/** @typedef {import('../../../src/server/room-state.ts').ActiveRoom} ActiveRoom */
/** @typedef {import('../../../src/server/room-state.ts').RoomSeat} Seat */
/** @typedef {import('../../../src/protocol/decisions.ts').NeowAction} NeowAction */
/** @typedef {import('../../../src/protocol/decisions.ts').SetupAction} SetupAction */

/** @param {{ snapshotFor: import('../../../src/server/room-state.ts').RoomProjection }} callbacks */
export function createSetupActions({ snapshotFor }) {
  /** @param {Extract<NeowAction, {stage: 'red' | 'reward'}>} action
   * @returns {number | import('../../../src/game/run.ts').PotionRewardDecision | null} */
  function neowRewardChoice(action) {
    const choice = action.choice
    if (choice === null || typeof choice === 'number' && Number.isInteger(choice)) return choice
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) fail('Choose a valid Neow reward')
    if (choice.kind === 'gain' || choice.kind === 'skip') {
      if (Object.keys(choice).some((key) => key !== 'kind')) fail('Choose a valid Neow reward')
      return { kind: choice.kind }
    }
    if (choice.kind === 'pass' && typeof choice.playerId === 'string' &&
      Object.keys(choice).every((key) => key === 'kind' || key === 'playerId')) {
      return { kind: 'pass', playerId: choice.playerId }
    }
    if (choice.kind === 'replace' && typeof choice.potionId === 'string' &&
      Object.keys(choice).every((key) => key === 'kind' || key === 'potionId')) {
      return { kind: 'replace', potionId: choice.potionId }
    }
    fail('Choose a valid Neow reward')
  }

  /** One authenticated action covers Neow's red reward, blue option, and queued rewards.
   * @param {ActiveRoom} room @param {Seat} seat @param {NeowAction} action @param {string} seatToken */
  function neowAction(room, seat, action, seatToken) {
    if ('playerId' in action && action.playerId !== undefined) fail('Neow choices are bound to your seat')
    const preview = neowPreview(room.run, seat.playerId)
    if (!preview || preview.done) fail('This seat has no pending Neow choice')
    let next
    if (action.stage === 'reveal') {
      const sources = action.sources
      if (Object.keys(action).some((key) => !['kind', 'stage', 'sources'].includes(key)) || sources !== undefined && (
        !Array.isArray(sources) || sources.length !== 3 || new Set(sources).size !== sources.length ||
        sources.some((source) => typeof source !== 'string' || !preview.availableSources.includes(source))
      )) fail('Choose a valid Neow reveal')
      if (!preview.redRewardPending && !preview.rewardKind) fail('No Neow reward is waiting to be revealed')
      next = revealNeowReward(room.run, seat.playerId, sources)
    } else if (action.stage === 'red') {
      if (!preview.redRewardPending) fail('The red Neow reward is no longer pending')
      next = resolveNeowReward(room.run, seat.playerId, neowRewardChoice(action))
    } else if (action.stage === 'option') {
      if (preview.redRewardPending || preview.blueOption !== null || preview.pendingEffect || preview.rewardKind) fail('The blue Neow option is not pending')
      if (!Number.isInteger(action.optionIndex) || action.cardUids !== undefined &&
        (!Array.isArray(action.cardUids) || action.cardUids.some((uid) => typeof uid !== 'string'))) {
        fail('Choose a valid Neow option')
      }
      next = chooseNeow(room.run, seat.playerId, action.optionIndex, { cardUids: action.cardUids ?? [] })
    } else if (action.stage === 'effect') {
      if (!preview.pendingEffect || typeof action.gain !== 'boolean' || action.cardUids !== undefined &&
        (!Array.isArray(action.cardUids) || action.cardUids.some((uid) => typeof uid !== 'string')) ||
        Object.keys(action).some((key) => !['kind', 'stage', 'gain', 'cardUids'].includes(key))) fail('Choose a valid Neow immediate reward')
      next = resolveNeowEffect(room.run, seat.playerId, action.gain, { cardUids: action.cardUids ?? [] })
    } else if (action.stage === 'reward') {
      if (!preview.rewardKind) fail('No blue Neow reward is pending')
      next = resolveNeowReward(room.run, seat.playerId, neowRewardChoice(action))
    } else fail('Choose the current Neow stage')
    if (next === room.run) fail('That Neow choice is not legal')
    if (next.phase !== 'neow') room.seats = room.seats.filter((candidate) => !candidate.pendingCatchUp)
    room.run = next
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  /** @param {ActiveRoom} room @param {Seat} seat @param {SetupAction} action @param {string} seatToken */
  function quickSetupStep(room, seat, action, seatToken) {
    const setup = room.run?.setup
    if (room.run?.phase !== 'setup' || !setup) fail('The party is not resolving Quick Start')
    const activePlayerId = setup.playerIds[setup.playerIndex] ?? setup.playerIds[0]
    if (seat.playerId !== activePlayerId) fail('Only the active setup player may resolve this step')
    const cardUids = Array.isArray(action.cardUids) && action.cardUids.length <= 1
      ? action.cardUids.filter((uid) => typeof uid === 'string') : []
    const next = advanceQuickSetup(room.run, cardUids)
    if (next === room.run) fail('That Quick Start choice is not legal')
    room.run = next
    room.version += 1
    return { changed: true, snapshot: snapshotFor(room, seatToken) }
  }

  return { neowAction, quickSetupStep }
}
