import type { RunState } from '../../game/run.ts'
import { normalizeLegacyRunLog, type RunLog, type RunLogEvent } from './codec.ts'

// Keep the shipped storage names so runs recorded before this feature remain downloadable.
const RUN_LOG_KEY = 'sts-run-vod'
const RUN_LOG_DATABASE = 'sts-run-vod-v2'
let memoryLog: RunLog | null = null
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
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(RUN_LOG_DATABASE, 1)
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('runs', { keyPath: 'runId' })
      request.result.createObjectStore('events', { keyPath: ['runId', 'index'] })
    }, { once: true })
    request.addEventListener('success', () => {
      request.result.addEventListener('versionchange', () => request.result.close())
      resolve(request.result)
    }, { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
  return database
}

const eventRange = (runId: string) => IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])

export async function persistedLog(runId: string): Promise<RunLog | null> {
  if (memoryLog?.runId === runId) return (memoryLog = normalizeLegacyRunLog(memoryLog))
  const db = await runLogDatabase()
  try {
    const transaction = db.transaction(['runs', 'events'], 'readonly')
    const run = await requested(transaction.objectStore('runs').get(runId)) as Omit<RunLog, 'events'> | undefined
    if (!run || run.version !== 2 || run.initial?.campaign.runId !== runId) return null
    const rows = await requested(transaction.objectStore('events').getAll(eventRange(runId))) as
      { runId: string; index: number; event: RunLogEvent }[]
    memoryLog = normalizeLegacyRunLog({ ...run, events: rows.sort((a, b) => a.index - b.index).map((row) => row.event) })
    return memoryLog
  } catch (error) {
    console.error('Could not read the recorded run.', error)
    return null
  }
}

export const readRunLog = (runId: string) => persistence.then(() => persistedLog(runId))

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
  memoryLog = log
  try { localStorage.setItem(RUN_LOG_KEY, log.runId) } catch {}
  persistence = persistence.catch(() => {}).then(() => persistStart(log))
  try { await persistence; return true } catch { return false }
}

export function discardRecording(runId?: string) {
  const currentRunId = memoryLog?.runId ?? (() => {
    try { return localStorage.getItem(RUN_LOG_KEY) } catch { return null }
  })()
  if (runId && currentRunId !== runId) return false
  memoryLog = null
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
export const currentRunLog = (): RecordedRun | null => memoryLog
export const flushRunLog = () => persistence

export function appendRunLogEvent(log: RunLog, event: RunLogEvent) {
  const index = log.events.push(event) - 1
  persistence = persistence.then(() => persistEvent(log.runId, index, event)).catch(error => {
    console.error('Could not persist the recorded run transition.', error)
  })
}
