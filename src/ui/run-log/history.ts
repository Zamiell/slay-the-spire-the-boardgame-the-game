import { cardDef, faceOf } from '../../game/cards.ts'
import type { RunState } from '../../game/run.ts'
import { projectRunTransition, publicLogChange, publicRecordedFrame, publicRunFrame, reduceRunHistory, type RunHistory } from '../live-run-history.ts'
import { applyRunLogEvent, type RunLogEvent } from './codec.ts'
import { currentRunLog, type RecordedRun } from './storage.ts'

let assistantContext: { run: RunState; active: boolean; ready: boolean } | null = null
let assistantCursor: { log: RecordedRun; run: RunState; index: number } | null = null
let assistantHistory: RunHistory = { status: 'idle', reason: 'No active local run.' }
const recordingIds = new WeakMap<RecordedRun, string>()
let archiveCursor: { log: RecordedRun; run: RunState; index: number } | null = null

function activeAssistantContext(runId: string | undefined, mode: string | undefined) {
  const current = assistantContext
  return mode === 'local' && runId && current?.active && current.run.campaign.runId === runId ? current : null
}

/** Only the allowlisted public projection leaves this module; never return replay patches. */
export function readAssistantRunHistory(runId: string | undefined, mode: string | undefined) {
  const memoryLog = currentRunLog()
  const unavailable = (reason: string) => {
    assistantCursor = null
    archiveCursor = null
    assistantHistory = reduceRunHistory(assistantHistory, { type: 'clear', reason })
    return assistantHistory
  }
  const current = activeAssistantContext(runId, mode)
  if (!current || !runId) {
    return unavailable('Recorded history is available only for the active local run, not online play, tutorials, menus, or replays.')
  }
  if (!current.ready) {
    assistantCursor = null
    assistantHistory = reduceRunHistory(assistantHistory, { type: 'load', runId })
    return assistantHistory
  }
  if (!memoryLog || memoryLog.runId !== runId || memoryLog.initial.seed !== current.run.seed) {
    return unavailable('No matching recording is available for this run.')
  }
  if (!assistantCursor || assistantCursor.log !== memoryLog || assistantCursor.index > memoryLog.events.length) {
    assistantCursor = { log: memoryLog, run: memoryLog.initial, index: 0 }
    assistantHistory = reduceRunHistory(assistantHistory, { type: 'load', runId })
    assistantHistory = reduceRunHistory(assistantHistory, { type: 'loaded' })
  }
  if (assistantHistory.status === 'error') return assistantHistory
  try {
    while (assistantCursor.index < memoryLog.events.length) {
      const before = assistantCursor.run
      const after = applyRunLogEvent(before, memoryLog.events[assistantCursor.index]!)
      assistantHistory = reduceRunHistory(assistantHistory, {
        type: 'commit', index: assistantCursor.index + 1, before, after,
      })
      assistantCursor.run = after
      assistantCursor.index += 1
    }
    return { ...assistantHistory,
      caughtUp: JSON.stringify(publicRunFrame(assistantCursor.run)) === JSON.stringify(publicRunFrame(current.run)) &&
        assistantCursor.run.combat?.presentationEvents.at(-1)?.seq === current.run.combat?.presentationEvents.at(-1)?.seq }
  } catch (error) {
    console.error('Could not reconstruct assistant run history.', error)
    assistantHistory = reduceRunHistory(assistantHistory, { type: 'fail', message: 'Recorded history could not be reconstructed.' })
    return assistantHistory
  }
}

export type RunHistoryQuery = {
  offset?: number
  limit?: number
  through?: number
  runId?: string
  recordingId?: string
}

function publicRecordedTransition(index: number, before: RunState, after: RunState, event: RunLogEvent) {
  const describeCard = (card: RunState['players'][number]['deck'][number]) => ({
    cardId: card.defId, name: faceOf(cardDef(card.defId), card.upgraded).name, upgraded: card.upgraded,
    ...(card.attachedGemId ? { gemId: card.attachedGemId } : {}),
  })
  return {
    ...projectRunTransition(index, before, after),
    before: publicRecordedFrame(before), after: publicRecordedFrame(after),
    viewerId: event.viewerId,
    choice: event.choice ? {
      source: event.choice.source.name,
      steps: event.choice.steps?.flatMap(step => step.name ? [step.name] : []),
      target: event.choice.target?.name,
    } : null,
    messages: {
      run: publicLogChange(before.log, after.log),
      combat: publicLogChange(before.combat?.log ?? [], after.combat?.log ?? [],
        before.combat?.combatId !== after.combat?.combatId),
    },
    deckChanges: after.players.flatMap(player => {
      const previous = before.players.find(candidate => candidate.id === player.id)
      if (!previous) return []
      const oldCards = new Map(previous.deck.map(card => [card.uid, card]))
      const newCards = new Set(player.deck.map(card => card.uid))
      const added = player.deck.filter(card => !oldCards.has(card.uid)).map(describeCard)
      const removed = previous.deck.filter(card => !newCards.has(card.uid)).map(describeCard)
      const changed = player.deck.filter(card => {
        const old = oldCards.get(card.uid)
        return old && (old.upgraded !== card.upgraded || old.attachedGemId !== card.attachedGemId)
      }).map(describeCard)
      return added.length || removed.length || changed.length ? [{ playerId: player.id, added, removed, changed }] : []
    }),
  }
}

/** On-demand pages use the complete recorder, not the sampled or 32-transition histories. */
export async function readAssistantRunHistoryPage(runId: string | undefined, mode: string | undefined, query: RunHistoryQuery = {}) {
  const memoryLog = currentRunLog()
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
    Object.keys(query).some(key => !['offset', 'limit', 'through', 'runId', 'recordingId'].includes(key))) {
    throw new Error('Invalid history query arguments.')
  }
  const current = activeAssistantContext(runId, mode)
  if (!current || !runId) {
    archiveCursor = null
    throw new Error('Full history is available only for the active local run, not menus, online games, tutorials, or replays.')
  }
  if (!current.ready) throw new Error('The run recording is still loading. Try again shortly.')
  const log = memoryLog
  if (!log || log.runId !== runId || log.initial.seed !== current.run.seed) throw new Error('No matching recording is available for this run.')
  let recordingId = recordingIds.get(log)
  if (!recordingId) { recordingId = crypto.randomUUID(); recordingIds.set(log, recordingId) }
  if (query.runId !== undefined && query.runId !== runId ||
    query.recordingId !== undefined && query.recordingId !== recordingId) throw new Error('The run or recording changed. Start history again at offset 0.')
  const offset = query.offset === undefined ? 0 : query.offset
  const limit = query.limit === undefined ? 50 : query.limit
  const through = query.through === undefined ? log.events.length : query.through
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(through) || through < offset || through > log.events.length) throw new Error('Invalid history range: use offset >= 0, limit 1-100, and through within the recording.')
  const ensureCurrent = () => {
    const active = activeAssistantContext(runId, mode)
    if (!active?.ready || currentRunLog() !== log) throw new Error('The active run or recording changed during the query. Start history again.')
    return active.run
  }
  const cursor = archiveCursor?.log === log && archiveCursor.index <= offset ? archiveCursor : null
  let reconstructed = cursor?.run ?? log.initial
  let index = cursor?.index ?? 0
  const initial = offset === 0 ? {
    frame: publicRecordedFrame(log.initial),
    messages: { run: [...log.initial.log], combat: [...(log.initial.combat?.log ?? [])] },
  } : undefined
  const transitions: ReturnType<typeof publicRecordedTransition>[] = []
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
  let size = bytes(initial ?? null) + 4096
  const budget = 384 * 1024
  if (size > budget) throw new Error('The recorded initial public state exceeds the history response size limit.')
  while (index < through && transitions.length < limit) {
    if (index % 25 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
      ensureCurrent()
    }
    const before = reconstructed
    const event = log.events[index]!
    const after = applyRunLogEvent(before, event)
    if (after.campaign.runId !== runId || after.seed !== log.initial.seed) throw new Error('Recorded history crosses an invalid run boundary.')
    if (index >= offset) {
      const entry = publicRecordedTransition(index + 1, before, after, event)
      const entrySize = bytes(entry) + 1
      if (size + entrySize > budget) {
        if (!transitions.length) throw new Error(`Recorded transition ${index + 1} exceeds the history response size limit.`)
        break
      }
      transitions.push(entry)
      size += entrySize
    }
    reconstructed = after
    index++
  }
  const active = ensureCurrent()
  if (!archiveCursor || archiveCursor.log !== log || archiveCursor.index <= index) archiveCursor = { log, run: reconstructed, index }
  return {
    status: 'ready' as const, runId, recordingId, offset, through, recordedTransitions: log.events.length,
    initial, transitions,
    next: index < through ? { runId, recordingId, offset: index, limit, through } : null,
    caughtUp: index === log.events.length &&
      JSON.stringify(publicRecordedFrame(reconstructed)) === JSON.stringify(publicRecordedFrame(active)) &&
      JSON.stringify([reconstructed.log, reconstructed.combat?.log]) === JSON.stringify([active.log, active.combat?.log]) &&
      reconstructed.combat?.presentationEvents.at(-1)?.seq === active.combat?.presentationEvents.at(-1)?.seq,
  }
}

export function setAssistantContext(context: NonNullable<typeof assistantContext>) {
  assistantContext = context
}

export function resetRecordedHistory() {
  archiveCursor = null
}
