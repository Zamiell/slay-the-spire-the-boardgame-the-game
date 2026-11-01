import { savedProfile } from './profile.ts'
import type { RunState } from './game/run.ts'
import type { BossAct } from './game/coins.ts'
import type { CharacterId } from './game/types.ts'
import { resetRoomEndpoint, roomUrl } from './multiplayer/room-endpoint.ts'
import { damageTotals } from './ui/run-summary-data.ts'
import { decodeResponse, HttpResponseError, requestJson } from './http.ts'
import type { DecodedResponse } from './http.ts'
import { DailyLeaderboardReply, LeaderboardAcknowledgement, LeaderboardReply, WinningDecksReply } from './protocol/responses.ts'

const INSTALLATION_KEY = 'sts-leaderboard-installation'
const OUTBOX_KEY = 'sts-leaderboard-outbox'
const REQUEST_TIMEOUT_MS = 5_000
const AUTO_FLUSH = import.meta.env.PROD || import.meta.env.VITE_HOSTED_SESSION === 'true' || import.meta.env.VITE_LEADERBOARD === 'true'

export type LeaderboardSnapshot = DecodedResponse<typeof LeaderboardReply>
export type LeaderboardRow = LeaderboardSnapshot['rows'][number]

type LeaderboardSubmission = {
  id: string
  profileToken?: string
  finalDeck?: { defId: string; upgraded: boolean; attachedGemId?: string }[]
  character: CharacterId
  characters?: CharacterId[]
  ascension: number
  mode: RunState['meta']['mode']
  damageStatsComplete: boolean
  startedAtAct: number
  highestBossActDefeated: number
  combatsFinished: number
  damageDealt: number
  damageTaken: number
  damageBlocked: number
  floorsCleared?: number
  dailyDate?: string
  dailyBossActs?: BossAct[]
}

let fallbackOutbox: LeaderboardSubmission[] = []
type FlushReport = { recorded: string[]; rejected: string[] }

let flushing: Promise<FlushReport> | null = null

function readOutbox(): LeaderboardSubmission[] {
  try {
    const saved = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]')
    const runs = Array.isArray(saved) ? saved : []
    return [...runs, ...fallbackOutbox].filter((run, index, all) =>
      all.findIndex((candidate) => candidate.id === run.id) === index)
  } catch { return fallbackOutbox }
}

function writeOutbox(runs: LeaderboardSubmission[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(runs))
    fallbackOutbox = []
  } catch { fallbackOutbox = runs }
}

function installationId() {
  try {
    const saved = localStorage.getItem(INSTALLATION_KEY)
    if (saved) return saved
    const id = crypto.randomUUID()
    localStorage.setItem(INSTALLATION_KEY, id)
    return id
  } catch { return crypto.randomUUID() }
}

export function queueFinishedSoloRun(run: RunState) {
  if (!run.campaign.finalized || run.players.length !== 1 || run.consoleModified) return null
  const totals = damageTotals(run.players[0]?.damageStats)
  const submission: LeaderboardSubmission = {
    id: `${installationId()}:${run.campaign.runId}:${run.seed}`,
    profileToken: savedProfile()?.token,
    finalDeck: run.players[0]!.deck.map(({ defId, upgraded, attachedGemId }) => ({
      defId, upgraded, ...(attachedGemId ? { attachedGemId } : {}),
    })),
    character: run.players[0]!.character,
    characters: [run.players[0]!.character],
    ascension: run.ascension,
    mode: run.meta.mode,
    damageStatsComplete: run.combatsFinished !== undefined,
    startedAtAct: run.campaign.startedAtAct,
    highestBossActDefeated: run.campaign.highestBossActDefeated,
    combatsFinished: Math.max(0, Math.floor(run.combatsFinished ?? 0)),
    damageDealt: totals.dealt,
    damageTaken: totals.taken,
    damageBlocked: totals.blocked,
    ...(run.floorsCleared === undefined ? {} : {
      floorsCleared: Math.max(0, Math.floor(run.floorsCleared)),
    }),
    ...(run.meta.dailyDate ? { dailyDate: run.meta.dailyDate, dailyBossActs: run.campaign.bossCoins?.map((award) => award.act) } : {}),
  }
  const queued = readOutbox()
  const existing = queued.findIndex((entry) => entry.id === submission.id)
  if (existing < 0) writeOutbox([...queued, submission])
  else if (queued[existing]!.floorsCleared === undefined && submission.floorsCleared !== undefined ||
      queued[existing]!.finalDeck === undefined && submission.finalDeck !== undefined) {
    queued[existing] = { ...queued[existing]!,
      ...(queued[existing]!.floorsCleared === undefined ? { floorsCleared: submission.floorsCleared } : {}),
      ...(queued[existing]!.finalDeck === undefined ? { finalDeck: submission.finalDeck } : {}),
      ...(queued[existing]!.profileToken === undefined ? { profileToken: submission.profileToken } : {}),
    }
    writeOutbox(queued)
  }
  return submission.id
}

async function flush() {
  const report: FlushReport = { recorded: [], rejected: [] }
  for (let run of readOutbox()) {
    let submitted = false
    for (let attempt = 0; attempt < 2 && !submitted; attempt += 1) {
      let endpoint: string | undefined
      try {
        endpoint = await roomUrl('/api/leaderboard')
        const response = await requestJson(endpoint, {
          method: 'POST', body: run, timeoutMs: REQUEST_TIMEOUT_MS, failure: 'Leaderboard submission failed',
        })
        if (response.status === 409 && run.profileToken !== undefined) {
          const { profileToken: _, ...anonymous } = run
          run = anonymous
          writeOutbox(readOutbox().map((entry) => entry.id === run.id ? run : entry))
          attempt -= 1
          continue
        }
        if (response.status === 400 || response.status === 413) {
          submitted = true
          writeOutbox(readOutbox().filter((entry) => entry.id !== run.id))
          report.rejected.push(run.id)
          continue
        }
        if (!response.ok) throw new Error('Leaderboard submission failed')
        const acknowledged = decodeResponse(LeaderboardAcknowledgement, response.body,
          'Leaderboard submission failed', response.status)
        // An older server would store a climb without its day, so it could never rank.
        if (run.floorsCleared !== undefined && acknowledged?.floorsClearedAccepted !== true ||
            run.dailyDate !== undefined && acknowledged?.dailyDateAccepted !== true ||
            run.dailyDate !== undefined && run.profileToken !== undefined && acknowledged?.dailyCoinsAccepted !== true ||
            run.finalDeck !== undefined && acknowledged?.finalDeckAccepted !== true ||
            run.profileToken !== undefined && acknowledged?.profileAccepted !== true) {
          resetRoomEndpoint()
          if (attempt === 1) return report
          continue
        }
        submitted = true
        writeOutbox(readOutbox().filter((entry) => entry.id !== run.id))
        report.recorded.push(run.id)
      } catch {
        resetRoomEndpoint()
        if (attempt === 1) return report
      }
    }
  }
  return report
}

export function flushLeaderboardOutbox(force = false) {
  if (!AUTO_FLUSH && !force) return Promise.resolve({ recorded: [], rejected: [] })
  flushing ??= flush().finally(() => { flushing = null })
  return flushing
}

export async function loadLeaderboard(): Promise<LeaderboardSnapshot> {
  await flushLeaderboardOutbox(true)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let endpoint: string | undefined
    try {
      endpoint = await roomUrl('/api/leaderboard')
      const response = await requestJson(endpoint, { cache: 'no-store', timeoutMs: REQUEST_TIMEOUT_MS, failure: 'Leaderboard unavailable' })
      if (!response.ok) throw new HttpResponseError('Leaderboard unavailable', response.status)
      return decodeResponse(LeaderboardReply, response.body, 'Leaderboard unavailable', response.status)
    } catch (error) {
      resetRoomEndpoint()
      if (attempt === 1) throw error
    }
  }
  throw new Error('Leaderboard unavailable')
}

export type DailyClimbBoard = DecodedResponse<typeof DailyLeaderboardReply>
export type DailyClimbRow = DailyClimbBoard['rows'][number]

/** The server answered but declined: a 429 rate limit, a 404 from a server without the ranking, or a bad query. */
export class DailyRankingRefused extends Error {
  readonly reason: 'rateLimited' | 'notDeployed' | 'rejected'
  constructor(status: number) {
    super('Daily ranking unavailable')
    this.reason = status === 429 ? 'rateLimited' : status === 404 ? 'notDeployed' : 'rejected'
  }
}

/** `characters` narrows the rows; ranks stay those of the whole day. */
export async function loadDailyLeaderboard(date: string, characters: readonly CharacterId[]): Promise<DailyClimbBoard> {
  // A climb queued moments ago may still be uploading; wait for it without starting another flush.
  await flushing?.catch(() => undefined)
  const query = new URLSearchParams({ date })
  characters.forEach((character) => query.append('character', character))
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const endpoint = await roomUrl(`/api/leaderboard/daily?${query}`)
      const response = await requestJson(endpoint, { cache: 'no-store', timeoutMs: REQUEST_TIMEOUT_MS, failure: 'Daily ranking unavailable' })
      // A rate limit or bad query is an answer from a live server; retrying only burns quota.
      if ([400, 404, 429].includes(response.status)) throw new DailyRankingRefused(response.status)
      if (!response.ok) throw new HttpResponseError('Daily ranking unavailable', response.status)
      return decodeResponse(DailyLeaderboardReply, response.body, 'Daily ranking unavailable', response.status)
    } catch (error) {
      if (error instanceof DailyRankingRefused) throw error
      resetRoomEndpoint()
      if (attempt === 1) throw error
    }
  }
  throw new Error('Daily ranking unavailable')
}

export type WinningDeckSort = 'character' | 'ascension' | 'cardCount' | 'username' | 'recordedAt'
export type WinningDeckPage = DecodedResponse<typeof WinningDecksReply>
export type WinningDeck = WinningDeckPage['rows'][number]

export async function loadWinningDecks(params: URLSearchParams, signal: AbortSignal): Promise<WinningDeckPage> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const failure = 'Could not load winning decks. Please try again.'
      const response = await requestJson(() => roomUrl(`/api/leaderboard/decks?${params}`), {
        cache: 'no-store', signal, timeoutMs: REQUEST_TIMEOUT_MS, failure,
      })
      if (response.status === 404) throw new HttpResponseError('Winning decks will be available after the archive server updates. Please try again shortly.', response.status)
      if (!response.ok) throw new HttpResponseError(failure, response.status)
      return decodeResponse(WinningDecksReply, response.body, failure, response.status)
    } catch (error) {
      if (signal.aborted) throw error
      resetRoomEndpoint()
      if (attempt === 1) throw error
    }
  }
  throw new Error('Could not load winning decks.')
}
