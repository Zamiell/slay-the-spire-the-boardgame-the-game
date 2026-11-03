import type { RunState } from '../../game/run.ts'
import { normalizeLegacyRunLog, type RunLog, type RunLogEvent } from './codec.ts'

// Keep the shipped storage names so runs recorded before this feature remain downloadable.
const RUN_LOG_KEY = 'sts-run-vod'
const RUN_LOG_DATABASE = 'sts-run-vod-v2'
type Recording = { log: RunLog; initialized: boolean; durableEvents: number; error: unknown }
let recording: Recording | null = null
let persistence = Promise.resolve()
let database: Promise<IDBDatabase> | null = null
const requested = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result), { once: true })
  request.addEventListener('error', () => reject(request.error), { once: true })
})

const committed = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.addEventListener('complete', () => resolve(), { once: true })
  transaction.addEventListener('error', () => reject(transaction.error), { once: true })
  transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
})

function runLogDatabase() {
  if (database) return database
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(RUN_LOG_DATABASE, 1)
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('runs', { keyPath: 'runId' })
      request.result.createObjectStore('events', { keyPath: ['runId', 'index'] })
    }, { once: true })
    request.addEventListener('success', () => {
      request.result.addEventListener('versionchange', () => { request.result.close(); database = null })
      resolve(request.result)
    }, { once: true })
    request.addEventListener('error', () => { database = null; reject(request.error) }, { once: true })
  }).catch(error => { database = null; throw error })
  return database
}

const eventRange = (runId: string) => IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])

export async function persistedLog(runId: string): Promise<RunLog | null> {
  if (recording?.log.runId === runId) {
    Object.assign(recording.log, normalizeLegacyRunLog(recording.log))
    return recording.log
  }
  const previous = recording
  const db = await runLogDatabase()
  const transaction = db.transaction(['runs', 'events'], 'readonly')
  const run = await requested(transaction.objectStore('runs').get(runId)) as Omit<RunLog, 'events'> | undefined
  if (!run || run.version !== 2 || run.initial?.campaign.runId !== runId) return null
  const rows = await requested(transaction.objectStore('events').getAll(eventRange(runId))) as
    { runId: string; index: number; event: RunLogEvent }[]
  rows.sort((a, b) => a.index - b.index)
  if (rows.some((row, index) => row.runId !== runId || row.index !== index)) {
    throw new Error('The recorded run has missing transitions and cannot be recovered.')
  }
  const log = normalizeLegacyRunLog({ ...run, events: rows.map(row => row.event) })
  if (recording === previous) recording = { log, initialized: true, durableEvents: rows.length, error: null }
  return log
}

export const readRunLog = async (runId: string) => { await flushRunLog(); return persistedLog(runId) }

async function persistStart(log: RunLog) {
  const db = await runLogDatabase()
  const transaction = db.transaction(['runs', 'events'], 'readwrite')
  transaction.objectStore('runs').put({ version: log.version, runId: log.runId, initial: log.initial })
  transaction.objectStore('events').delete(eventRange(log.runId))
  await committed(transaction)
}

async function persistEvent(runId: string, index: number, event: RunLogEvent) {
  const db = await runLogDatabase()
  const transaction = db.transaction('events', 'readwrite')
  transaction.objectStore('events').put({ runId, index, event })
  await committed(transaction)
}

export async function startRecording(run: RunState) {
  const log: RunLog = { version: 2, runId: run.campaign.runId, initial: structuredClone(run), events: [] }
  const next: Recording = { log, initialized: false, durableEvents: 0, error: null }
  recording = next
  try { localStorage.setItem(RUN_LOG_KEY, log.runId) } catch {}
  await persistRecording(next, true)
  return next.error === null
}

export function discardRecording(runId?: string) {
  const currentRunId = recording?.log.runId ?? (() => {
    try { return localStorage.getItem(RUN_LOG_KEY) } catch { return null }
  })()
  if (runId && currentRunId !== runId) return false
  recording = null
  try { localStorage.removeItem(RUN_LOG_KEY) } catch {}
  if (currentRunId) persistence = persistence.then(async () => {
    const db = await runLogDatabase()
    const transaction = db.transaction(['runs', 'events'], 'readwrite')
    transaction.objectStore('runs').delete(currentRunId)
    transaction.objectStore('events').delete(eventRange(currentRunId))
    await committed(transaction)
  }).catch(error => {
    console.error('Could not discard the recorded run.', error)
  })
  return true
}

export type RecordedRun = Readonly<Omit<RunLog, 'events'>> & { readonly events: readonly RunLogEvent[] }
export const currentRunLog = (): RecordedRun | null => recording?.log ?? null
export async function flushRunLog() {
  const current = recording
  if (!current) return persistence
  await persistRecording(current, true)
  if (current.error !== null) throw current.error
}

function persistRecording(current: Recording, retry = false) {
  const through = current.log.events.length
  persistence = persistence.then(async () => {
    if (current.error !== null && !retry) return
    try {
      if (!current.initialized) {
        await persistStart(current.log)
        current.initialized = true
      }
      while (current.durableEvents < through) {
        const index = current.durableEvents
        await persistEvent(current.log.runId, index, current.log.events[index]!)
        current.durableEvents++
      }
      current.error = null
    } catch (error) {
      current.error = error ?? new Error('The run recording transaction was aborted.')
      console.error('Could not persist the recorded run. Pending transitions remain in memory until a successful flush.', error)
    }
  })
  return persistence
}

export function appendRunLogEvent(log: RunLog, event: RunLogEvent) {
  if (recording?.log !== log) throw new Error('Cannot append to an inactive run recording.')
  log.events.push(event)
  void persistRecording(recording)
}
