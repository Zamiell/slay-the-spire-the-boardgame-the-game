import { cardDef, faceOf } from '../game/cards.ts'
import type { RunState } from '../game/run.ts'

export function publicRunFrame(run: RunState) {
  const combat = run.phase === 'combat' ? run.combat : undefined
  return {
    phase: run.phase,
    combat: combat ? { id: combat.combatId, phase: combat.phase, turn: combat.turn } : null,
    players: (combat?.players ?? run.players).map(player => ({
      id: player.id, character: player.character, hp: player.hp, maxHp: player.maxHp,
      ...(combat ? { energy: player.energy, block: player.block, stance: player.stance } : {}),
    })),
  }
}

type Frame = ReturnType<typeof publicRunFrame>
type CardResolution = {
  playerId: string
  cardId: string
  name: string
  printedCost: number | 'X'
  copied: boolean
  /** Resolution parameter, not another payment when a card is copied. */
  effectEnergy: number
}
export type RunTransition = {
  index: number
  before: Frame
  after: Frame
  cards: CardResolution[]
  cardEnergySpent: { playerId: string; amount: number }[]
  timelineReset: boolean
  cardEventsTruncated: boolean
}
export type RunHistory = {
  status: 'idle'; reason: string
} | {
  status: 'loading'; runId: string
} | {
  status: 'error'; runId: string; message: string
} | {
  status: 'ready'; runId: string; processedTransitions: number; transitions: RunTransition[]; truncated: boolean
}
type HistoryEvent =
  | { type: 'clear'; reason: string }
  | { type: 'load'; runId: string }
  | { type: 'loaded' }
  | { type: 'commit'; index: number; before: RunState; after: RunState }
  | { type: 'fail'; message: string }

const HISTORY_LIMIT = 32

/** Records committed transitions, not clicks, frames, or inferred changes to a hand. */
export function reduceRunHistory(state: RunHistory, event: HistoryEvent): RunHistory {
  switch (event.type) {
    case 'clear': return { status: 'idle', reason: event.reason }
    case 'load': return { status: 'loading', runId: event.runId }
    case 'loaded':
      if (state.status !== 'loading') throw new Error('History must be loading before it becomes ready.')
      return { status: 'ready', runId: state.runId, processedTransitions: 0, transitions: [], truncated: false }
    case 'fail':
      if (state.status === 'idle') throw new Error('No run history is being tracked.')
      return { status: 'error', runId: state.runId, message: event.message }
    case 'commit': {
      if (state.status !== 'ready') throw new Error('History must be ready before recording a transition.')
      if (event.index !== state.processedTransitions + 1 ||
        event.before.campaign.runId !== state.runId || event.after.campaign.runId !== state.runId ||
        event.before.seed !== event.after.seed) throw new Error('Run history transitions must be consecutive and belong to the same run.')
      const { before, after } = event
      const previous = before.combat
      const next = after.combat
      const sameCombat = Boolean(previous && next && previous.combatId === next.combatId)
      const previousSequence = previous?.presentationEvents.at(-1)?.seq ?? 0
      const nextSequence = next?.presentationEvents.at(-1)?.seq ?? 0
      const timelineReset = Boolean(sameCombat && previous && next &&
        (next.turn < previous.turn || nextSequence < previousSequence))
      const events = sameCombat && !timelineReset
        ? next?.presentationEvents.filter(entry => entry.seq > previousSequence) ?? [] : []
      const cards = events.flatMap(entry => {
        if (entry.kind !== 'card') return []
        const face = faceOf(cardDef(entry.sourceId), entry.upgraded)
        return [{ playerId: entry.actorId, cardId: entry.sourceId, name: face.name,
          printedCost: face.cost, copied: entry.copied, effectEnergy: entry.energy }]
      })
      const cardEnergySpent = sameCombat && !timelineReset && previous?.turn === next?.turn
        ? (next?.players ?? []).flatMap(player => {
          const prior = previous?.players.find(candidate => candidate.id === player.id)
          if (!prior) return []
          const amount = (player.energySpentThisTurn ?? 0) - (prior.energySpentThisTurn ?? 0)
          return amount >= 0 ? [{ playerId: player.id, amount }] : []
        }) : []
      const transition: RunTransition = {
        index: event.index, before: publicRunFrame(before), after: publicRunFrame(after), cards, cardEnergySpent,
        timelineReset, cardEventsTruncated: events.length > 0 && events[0]!.seq > previousSequence + 1,
      }
      const changed = cards.length > 0 || timelineReset || transition.cardEventsTruncated ||
        cardEnergySpent.some(entry => entry.amount !== 0) || JSON.stringify(transition.before) !== JSON.stringify(transition.after)
      return {
        ...state, processedTransitions: event.index,
        transitions: changed ? [...state.transitions, transition].slice(-HISTORY_LIMIT) : state.transitions,
        truncated: state.truncated || changed && state.transitions.length >= HISTORY_LIMIT,
      }
    }
  }
}
