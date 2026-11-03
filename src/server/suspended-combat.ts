import type { CombatState } from '../game/combat.ts'
import type { RoomSnapshot } from '../protocol/room.ts'
import type { ActiveRoom, RoomSeat, RoomState } from './room-state.ts'

type ChoiceField = 'pendingPlunderSwitches' | 'pendingDieRelicChoices' | 'pendingHermitSetupLoads' |
  'pendingHermitChamberPlays' | 'pendingHermitStrengthRewards' | 'pendingSlayerChoices' | 'pendingPlayerChoices'
export type SuspendedChoices = { [Field in ChoiceField]: NonNullable<CombatState[Field]> }
export type ForcedCard = NonNullable<NonNullable<CombatState['startTurnProgress']>['forcedCard']>
export type SuspendedWork = {
  copies: NonNullable<CombatState['pendingCardCopy']>[]
  forcedCards: ForcedCard[]
  choices?: SuspendedChoices
}
type Result = { changed: boolean; snapshot?: RoomSnapshot }
type DieChoice = NonNullable<CombatState['pendingDieRelicChoices']>[number]
type Dependencies = {
  apply: (room: ActiveRoom, token: string, action: Record<string, unknown>, consumed: string | null, suspended: SuspendedWork) => Result
  restoreRoom: (room: RoomState, checkpoint: RoomState) => void
  snapshotFor: (room: RoomState, token: string) => RoomSnapshot
  settleForcedCards: (room: RoomState, consumed?: string | null, suspendActiveCopy?: boolean, suspended?: SuspendedWork | null) => void
  dieRelicChoiceNeedsInput: (combat: CombatState, choice: DieChoice) => boolean
}
const present = <Value>(value: Value | undefined): value is Value => value !== undefined
const playerWindow = (combat: CombatState) => combat.phase === 'player' ||
  combat.phase === 'copy' && combat.pendingCardCopy?.resumePhase === 'player'

function lastOwnedIndex<Choice extends { playerId: string }>(choices: readonly Choice[] | undefined, playerId: string) {
  if (!choices) return -1
  for (let index = choices.length - 1; index >= 0; index--) {
    if (choices[index]!.playerId === playerId) return index
  }
  return -1
}

export function clearSuspendedCombat(room: RoomState) {
  room.concurrentCardCopies = undefined
  room.concurrentDistilled = undefined
  room.concurrentRelicScries = undefined
  room.concurrentForcedCards = undefined
}

export function restoreConcurrentCopy(room: RoomState) {
  const combat = room.run?.combat
  if (!room.run || room.run.phase !== 'combat' || combat?.phase !== 'player' || combat.pendingCardCopy) return
  const queued = room.concurrentCardCopies?.at(-1)
  if (!queued) return
  room.concurrentCardCopies = room.concurrentCardCopies?.slice(0, -1)
  room.run = { ...room.run, combat: { ...combat, phase: 'copy', pendingCardCopy: queued } }
}

export function restoreConcurrentDistilled(room: RoomState) {
  const combat = room.run?.combat
  if (!room.run || room.run.phase !== 'combat' || !combat || !playerWindow(combat) || combat.pendingDistilled) return
  const queued = room.concurrentDistilled?.at(-1)
  if (!queued) return
  room.concurrentDistilled = room.concurrentDistilled?.slice(0, -1)
  room.run = { ...room.run, combat: { ...combat, pendingDistilled: queued } }
}

export function restoreConcurrentRelicScry(room: RoomState) {
  const combat = room.run?.combat
  if (!room.run || room.run.phase !== 'combat' || !combat || !playerWindow(combat) || combat.pendingRelicScry) return
  const queued = room.concurrentRelicScries?.at(-1)
  if (!queued) return
  room.concurrentRelicScries = room.concurrentRelicScries?.slice(0, -1)
  room.run = { ...room.run, combat: { ...combat, pendingRelicScry: queued } }
}

export function restoreConcurrentForcedCard(room: RoomState) {
  const combat = room.run?.combat
  if (!room.run || room.run.phase !== 'combat' || !combat || !playerWindow(combat) || combat.startTurnProgress?.forcedCard) return
  const queued = room.concurrentForcedCards?.at(-1)
  if (!queued) return
  room.concurrentForcedCards = room.concurrentForcedCards?.slice(0, -1)
  room.run = { ...room.run, combat: { ...combat,
    startTurnProgress: { choices: [], ...combat.startTurnProgress, forcedCard: queued } } }
}

function refreshDistilled(combat: CombatState, pending: CombatState['pendingDistilled']) {
  if (!pending) return undefined
  const player = combat.players.find(candidate => candidate.id === pending.playerId)
  const cards = pending.cards.filter(card => player?.hand.some(held => held.uid === card.uid))
  return cards.length ? { ...pending, cards } : undefined
}

function refreshRelicScry(combat: CombatState, pending: CombatState['pendingRelicScry']) {
  if (!pending) return undefined
  const player = combat.players.find(candidate => candidate.id === pending.playerId)
  return player ? { ...pending, cards: player.draw.slice(0, 3) } : undefined
}

function forcedCardStillValid(combat: CombatState, pending: ForcedCard | undefined) {
  return pending !== undefined && combat.players.find(player => player.id === pending.playerId)?.hand
    .some(card => card.uid === pending.cardUid) === true
}

function refreshChoiceTargets(combat: CombatState, choices: SuspendedChoices): SuspendedChoices {
  const living = new Set(combat.enemies.filter(enemy => !enemy.dead).map(enemy => enemy.uid))
  return { ...choices, pendingDieRelicChoices: choices.pendingDieRelicChoices.map(choice =>
    choice.enemyUid && !living.has(choice.enemyUid) ? { ...choice, enemyUid: null } : choice) }
}

function foreignChoicesFor(combat: CombatState, playerId: string, independent: boolean,
  needsInput: Dependencies['dieRelicChoiceNeedsInput']): SuspendedChoices {
  const foreign = <Choice extends { playerId: string }>(choices: Choice[] | undefined) =>
    independent ? (choices ?? []).filter(choice => choice.playerId !== playerId) : []
  return {
    pendingPlunderSwitches: foreign(combat.pendingPlunderSwitches),
    pendingDieRelicChoices: independent ? (combat.pendingDieRelicChoices ?? [])
      .filter(choice => choice.playerId !== playerId || !needsInput(combat, choice)) : [],
    pendingHermitSetupLoads: foreign(combat.pendingHermitSetupLoads),
    pendingHermitChamberPlays: foreign(combat.pendingHermitChamberPlays),
    pendingHermitStrengthRewards: foreign(combat.pendingHermitStrengthRewards),
    pendingSlayerChoices: foreign(combat.pendingSlayerChoices),
    pendingPlayerChoices: foreign(combat.pendingPlayerChoices),
  }
}

function ownChoicesFor(combat: CombatState, foreign: SuspendedChoices): SuspendedChoices {
  return {
    pendingPlunderSwitches: (combat.pendingPlunderSwitches ?? []).filter(choice => !foreign.pendingPlunderSwitches.includes(choice)),
    pendingDieRelicChoices: (combat.pendingDieRelicChoices ?? []).filter(choice => !foreign.pendingDieRelicChoices.includes(choice)),
    pendingHermitSetupLoads: (combat.pendingHermitSetupLoads ?? []).filter(choice => !foreign.pendingHermitSetupLoads.includes(choice)),
    pendingHermitChamberPlays: (combat.pendingHermitChamberPlays ?? []).filter(choice => !foreign.pendingHermitChamberPlays.includes(choice)),
    pendingHermitStrengthRewards: (combat.pendingHermitStrengthRewards ?? []).filter(choice => !foreign.pendingHermitStrengthRewards.includes(choice)),
    pendingSlayerChoices: (combat.pendingSlayerChoices ?? []).filter(choice => !foreign.pendingSlayerChoices.includes(choice)),
    pendingPlayerChoices: (combat.pendingPlayerChoices ?? []).filter(choice => !foreign.pendingPlayerChoices.includes(choice)),
  }
}

function mergeChoices(combat: CombatState, foreign: SuspendedChoices): SuspendedChoices {
  return {
    pendingPlunderSwitches: [...foreign.pendingPlunderSwitches, ...(combat.pendingPlunderSwitches ?? [])],
    pendingDieRelicChoices: [...foreign.pendingDieRelicChoices, ...(combat.pendingDieRelicChoices ?? [])],
    pendingHermitSetupLoads: [...foreign.pendingHermitSetupLoads, ...(combat.pendingHermitSetupLoads ?? [])],
    pendingHermitChamberPlays: [...foreign.pendingHermitChamberPlays, ...(combat.pendingHermitChamberPlays ?? [])],
    pendingHermitStrengthRewards: [...foreign.pendingHermitStrengthRewards, ...(combat.pendingHermitStrengthRewards ?? [])],
    pendingSlayerChoices: [...foreign.pendingSlayerChoices, ...(combat.pendingSlayerChoices ?? [])],
    pendingPlayerChoices: [...foreign.pendingPlayerChoices, ...(combat.pendingPlayerChoices ?? [])],
  }
}


/** The outer room transaction remains authoritative; this scope only switches seat-owned work. */
export function createSuspendedCombatCoordinator({ apply, restoreRoom, snapshotFor, settleForcedCards, dieRelicChoiceNeedsInput }: Dependencies) {
  return function applyWithSuspendedWork(room: ActiveRoom, seat: RoomSeat, action: Record<string, unknown>, seatToken: string,
    consumedPreviewPlayerId: string | null, suspendedWork: SuspendedWork | null): Result | undefined {
    const combat = room.run.combat
    if (!combat || suspendedWork) return undefined
    const activeCopy = combat?.phase === 'copy' ? combat.pendingCardCopy : undefined
    const foreignCopy = activeCopy?.resumePhase === 'player' && activeCopy.playerId !== seat.playerId
      ? activeCopy : undefined
    const copyIndex = foreignCopy
      ? lastOwnedIndex(room.concurrentCardCopies, seat.playerId)
      : -1
    const ownCopy = copyIndex >= 0 ? room.concurrentCardCopies?.[copyIndex] : undefined
    const asyncPlayerTurn = playerWindow(combat)
    const foreignChoices = foreignChoicesFor(combat, seat.playerId, asyncPlayerTurn, dieRelicChoiceNeedsInput)
    const activeDistilled = asyncPlayerTurn && combat?.pendingDistilled?.playerId !== seat.playerId
      ? combat?.pendingDistilled : undefined
    const activeRelicScry = asyncPlayerTurn && combat?.pendingRelicScry?.playerId !== seat.playerId
      ? combat?.pendingRelicScry : undefined
    const distilledIndex = asyncPlayerTurn && combat?.pendingDistilled?.playerId !== seat.playerId
      ? lastOwnedIndex(room.concurrentDistilled, seat.playerId) : -1
    const relicScryIndex = asyncPlayerTurn && combat?.pendingRelicScry?.playerId !== seat.playerId
      ? lastOwnedIndex(room.concurrentRelicScries, seat.playerId) : -1
    const ownDistilled = distilledIndex >= 0 ? room.concurrentDistilled?.[distilledIndex] : undefined
    const ownRelicScry = relicScryIndex >= 0 ? room.concurrentRelicScries?.[relicScryIndex] : undefined
    const playerTurnForcedCard = combat?.startTurnProgress?.forcedCard
    const activeForcedCard = asyncPlayerTurn && playerTurnForcedCard?.playerId !== seat.playerId
      ? playerTurnForcedCard : undefined
    const forcedCardIndex = asyncPlayerTurn && playerTurnForcedCard?.playerId !== seat.playerId
      ? lastOwnedIndex(room.concurrentForcedCards, seat.playerId) : -1
    const ownForcedCard = forcedCardIndex >= 0 ? room.concurrentForcedCards?.[forcedCardIndex] : undefined
    const foreignTriggers = asyncPlayerTurn
      ? (combat.pendingTriggers ?? []).filter((trigger) => trigger.playerId !== seat.playerId) : []
    const hasForeignWork = foreignCopy || activeDistilled || ownDistilled || activeRelicScry || ownRelicScry ||
      activeForcedCard || ownForcedCard ||
      foreignTriggers.length > 0 ||
      Object.values(foreignChoices).some((choices) => choices.length > 0)
    if (hasForeignWork) {
      const checkpoint = structuredClone(room)
      const foreignWork = {
        copies: [foreignCopy, ...(room.concurrentCardCopies ?? [])].filter(present),
        forcedCards: [activeForcedCard, ...(room.concurrentForcedCards ?? [])].filter(present),
        choices: foreignChoices,
      }
      if (copyIndex >= 0) {
        room.concurrentCardCopies = room.concurrentCardCopies?.filter((_copy, index) => index !== copyIndex)
      }
      if (distilledIndex >= 0) {
        room.concurrentDistilled = room.concurrentDistilled?.filter((_pending, index) => index !== distilledIndex)
      }
      if (relicScryIndex >= 0) {
        room.concurrentRelicScries = room.concurrentRelicScries?.filter((_pending, index) => index !== relicScryIndex)
      }
      if (forcedCardIndex >= 0) {
        room.concurrentForcedCards = room.concurrentForcedCards?.filter((_pending, index) => index !== forcedCardIndex)
      }
      room.run = {
        ...room.run,
        combat: {
          ...combat,
          ...(foreignCopy ? { phase: ownCopy ? 'copy' : 'player', pendingCardCopy: ownCopy } : {}),
          ...(activeDistilled || ownDistilled ? { pendingDistilled: ownDistilled } : {}),
          ...(activeRelicScry || ownRelicScry ? { pendingRelicScry: ownRelicScry } : {}),
          ...(activeForcedCard || ownForcedCard ? { startTurnProgress: {
            choices: [], ...combat.startTurnProgress,
            forcedCard: ownForcedCard,
          } } : {}),
          pendingTriggers: (combat.pendingTriggers ?? []).filter((trigger) => trigger.playerId === seat.playerId),
          ...ownChoicesFor(combat, foreignChoices),
        },
      }
      try {
        const result = apply(room, seatToken, action, consumedPreviewPlayerId, foreignWork)
        if (!result.changed) {
          restoreRoom(room, checkpoint)
          return { changed: false, snapshot: snapshotFor(room, seatToken) }
        }
        if (room.run.phase === 'combat' && room.run.combat && !['won', 'lost'].includes(room.run.combat.phase)) {
          let restored = room.run.combat
          const restoredChoices = refreshChoiceTargets(restored, foreignChoices)
          room.concurrentDistilled = room.concurrentDistilled
            ?.map((pending) => refreshDistilled(restored, pending)).filter(present)
          room.concurrentRelicScries = room.concurrentRelicScries
            ?.map((pending) => refreshRelicScry(restored, pending)).filter(present)
          room.concurrentForcedCards = room.concurrentForcedCards
            ?.filter((pending) => forcedCardStillValid(restored, pending))
          if (activeDistilled) {
            const pending = refreshDistilled(restored, activeDistilled)
            if (pending && restored.pendingDistilled) room.concurrentDistilled = [...(room.concurrentDistilled ?? []), pending]
            else if (pending) restored = { ...restored, pendingDistilled: pending }
          }
          const refreshedRelicScry = refreshRelicScry(restored, activeRelicScry)
          if (refreshedRelicScry) {
            if (restored.pendingRelicScry) room.concurrentRelicScries = [...(room.concurrentRelicScries ?? []), refreshedRelicScry]
            else restored = { ...restored, pendingRelicScry: refreshedRelicScry }
          }
          if (activeForcedCard && forcedCardStillValid(restored, activeForcedCard)) {
            if (restored.startTurnProgress?.forcedCard) {
              room.concurrentForcedCards = [...(room.concurrentForcedCards ?? []), activeForcedCard]
            } else {
              restored = { ...restored, startTurnProgress: {
                choices: [], ...restored.startTurnProgress,
                forcedCard: activeForcedCard,
              } }
            }
          }
          restored = { ...restored, pendingTriggers: [...foreignTriggers, ...(restored.pendingTriggers ?? [])],
            ...mergeChoices(restored, restoredChoices) }
          room.run = { ...room.run, combat: restored }
          restoreConcurrentDistilled(room)
          restoreConcurrentRelicScry(room)
          restoreConcurrentForcedCard(room)
          settleForcedCards(room, consumedPreviewPlayerId, true, foreignWork)
          const current = room.run.combat
          if (foreignCopy && current && !['won', 'lost'].includes(current.phase)) {
            if (current.pendingCardCopy) room.concurrentCardCopies = [...(room.concurrentCardCopies ?? []), foreignCopy]
            else room.run = { ...room.run, combat: { ...current, phase: 'copy', pendingCardCopy: foreignCopy } }
          }
          restoreConcurrentCopy(room)
          settleForcedCards(room, consumedPreviewPlayerId)
          if (!room.run.combat || ['won', 'lost'].includes(room.run.combat.phase)) clearSuspendedCombat(room)
        } else if (room.run?.combat && ['won', 'lost'].includes(room.run.combat.phase)) {
          clearSuspendedCombat(room)
          // Slayer Pack: set-aside choices end with the combat exactly as
          // `clearTerminalChoices` ends them, except a Ritual Dagger+ reveal: that
          // kill already happened, and its owner still answers after a victory
          // that another seat's blow decided.
          const ritual = room.run.combat.phase === 'won'
            ? foreignChoices.pendingSlayerChoices.filter((choice) => choice.kind === 'ritualDagger') : []
          if (ritual.length > 0) {
            room.run = { ...room.run, combat: { ...room.run.combat,
              pendingSlayerChoices: [...ritual, ...(room.run.combat.pendingSlayerChoices ?? [])] } }
          }
        }
        return { ...result, snapshot: snapshotFor(room, seatToken) }
      } catch (error) {
        restoreRoom(room, checkpoint)
        throw error
      }
    }

  }
}
