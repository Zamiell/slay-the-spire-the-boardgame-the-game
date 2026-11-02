import { addLeaderboardRun, dailyLeaderboard, leaderboardSnapshot, winningDecksPage } from '../leaderboard.mjs'
import { creditRecordedDailyCoins } from '../daily-coins.mjs'
import { randomDeck, statsSnapshot } from '../stats.mjs'
import { send, readJson, sourceOf } from './io.mjs'
import { CREATE_WINDOW_MS, MAX_LEADERBOARD_WRITES_PER_WINDOW, MAX_DECK_READS_PER_WINDOW, MAX_STATS_READS_PER_WINDOW } from './policies.mjs'
const DECK_PAGE_CACHE_LIMIT = 64
const DECK_QUERY_KEYS = new Set(['sort', 'direction', 'character', 'ascension', 'cursor'])
export function createCommunityRoutes({ store, persistence, rates, scheduleClassification }) {
  const { attemptSave, queueSave } = persistence
  const { consume, deckReadRates, dailyReadRates, statsRates, leaderboardRates } = rates
  const deckPages = new Map()
  let deckPagesRevision = store.leaderboardRevision
  let leaderboardSummary
  let leaderboardSummaryRevision = -1
  const dailyBoards = new Map()
  let dailyBoardsRevision = -1
  return async function handle(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/leaderboard/decks') {
      if (!consume(deckReadRates, sourceOf(request), CREATE_WINDOW_MS, MAX_DECK_READS_PER_WINDOW)) return send(response, 429, { error: 'Too many deck requests' })
      if ([...url.searchParams.keys()].some((name) => !DECK_QUERY_KEYS.has(name) ||
          name !== 'character' && url.searchParams.getAll(name).length > 1)) return send(response, 400, { error: 'Invalid winning deck query' })
      if (deckPagesRevision !== store.leaderboardRevision) {
        deckPages.clear()
        deckPagesRevision = store.leaderboardRevision
      }
      const key = JSON.stringify([url.searchParams.get('sort') ?? 'recordedAt', url.searchParams.get('direction') ?? 'desc',
        url.searchParams.getAll('character').sort(), url.searchParams.get('ascension') ?? 'all', url.searchParams.get('cursor')])
      let page = deckPages.get(key)
      if (!page) {
        page = winningDecksPage(store.leaderboardRuns, url.searchParams)
        if (deckPages.size >= DECK_PAGE_CACHE_LIMIT) deckPages.clear()
        deckPages.set(key, page)
      }
      return send(response, 200, page)
    }
    if (request.method === 'GET' && url.pathname === '/api/stats') {
      if (!consume(statsRates, sourceOf(request), CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) return send(response, 429, { error: 'Too many stats requests' })
      return send(response, 200, statsSnapshot(store.statsRuns, url.searchParams))
    }
    if (request.method === 'GET' && url.pathname === '/api/stats/deck') {
      if (!consume(statsRates, sourceOf(request), CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) return send(response, 429, { error: 'Too many stats requests' })
      return send(response, 200, randomDeck(store.statsRuns, url.searchParams))
    }
    if (request.method === 'GET' && url.pathname === '/api/leaderboard/daily') {
      if (!consume(dailyReadRates, sourceOf(request), CREATE_WINDOW_MS, MAX_DECK_READS_PER_WINDOW)) return send(response, 429, { error: 'Too many daily ranking requests' })
      if ([...url.searchParams.keys()].some((name) => name !== 'date' && name !== 'character') ||
          url.searchParams.getAll('date').length !== 1) return send(response, 400, { error: 'Invalid daily ranking query' })
      const date = url.searchParams.get('date')
      const characters = [...new Set(url.searchParams.getAll('character'))].sort()
      const key = JSON.stringify([date, characters])
      if (dailyBoardsRevision !== store.leaderboardRevision) {
        dailyBoards.clear()
        dailyBoardsRevision = store.leaderboardRevision
      }
      let board = dailyBoards.get(key)
      if (!board) {
        board = dailyLeaderboard(store.leaderboardRuns, date, characters)
        if (dailyBoards.size >= DECK_PAGE_CACHE_LIMIT) dailyBoards.clear()
        dailyBoards.set(key, board)
      }
      return send(response, 200, board)
    }
    if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
      if (leaderboardSummaryRevision !== store.leaderboardRevision) {
        leaderboardSummary = leaderboardSnapshot(store.leaderboardRuns)
        leaderboardSummaryRevision = store.leaderboardRevision
      }
      return send(response, 200, leaderboardSummary)
    }
    if (request.method === 'POST' && url.pathname === '/api/leaderboard') {
      const source = sourceOf(request)
      if (!consume(leaderboardRates, source, CREATE_WINDOW_MS, MAX_LEADERBOARD_WRITES_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many leaderboard submissions' })
      }
      const body = await readJson(request)
      if (typeof body.id === 'string' && body.id.startsWith('room:')) {
        return send(response, 400, { error: 'Run id is reserved for room results' })
      }
      const profile = store.profiles.find((entry) => entry.token === body.profileToken)
      if (body.profileToken && !profile) return send(response, 409, { error: 'Profile unavailable' })
      const { winningDecks: _, ...submission } = body
      const added = addLeaderboardRun(store, { ...submission, username: profile?.username })
      const recorded = store.leaderboardRuns.find((run) => run.id === body.id)
      if (recorded?.dailyDate !== undefined) {
        creditRecordedDailyCoins(store, recorded, profile)
        if (store.walletsDirty) {
          if (!attemptSave()) {
            queueSave()
            return send(response, 503, { error: 'Could not save your Daily Climb coins. Please try again.' })
          }
          store.walletsDirty = false
        }
      }
      if (added) { queueSave(); scheduleClassification() }
      return send(response, added ? 201 : 200, { ok: true, added, floorsClearedAccepted: true, finalDeckAccepted: true, profileAccepted: true, dailyDateAccepted: true, dailyCoinsAccepted: true })
    }
    return false
  }
}
