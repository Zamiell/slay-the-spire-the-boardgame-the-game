import { claimProfile, loginProfile, syncAscension } from '../profiles.mjs'
import { claimCoinGrant, confirmCoinGrant } from '../coin-grants.mjs'
import { syncAccountWallet } from '../account-wallets.mjs'
import { personalStats } from '../leaderboard.mjs'
import { send, readJson, sourceOf, networkOf } from './io.mjs'
import { CREATE_WINDOW_MS, MAX_PROFILE_CLAIMS_PER_WINDOW, MAX_LOGINS_PER_WINDOW, LOGIN_FAILURE_WINDOW_MS, MAX_LOGIN_FAILURES_PER_NAME, MAX_STATS_READS_PER_WINDOW, MAX_RATE_KEYS } from './policies.mjs'

export function createAccountRoutes({ store, persistence, rates, restrictions }) {
  const { attemptSave, queueSave } = persistence
  const { consume, profileRates, loginRates, loginFailures, statsRates } = rates
  const { restrictedNetworks, rejectRestricted, isRestrictedName, noteRestrictedSource } = restrictions

  return async function handle(request, response, url) {
    if (request.method === 'POST' && url.pathname === '/api/profile') {
      if (!consume(profileRates, sourceOf(request), CREATE_WINDOW_MS, MAX_PROFILE_CLAIMS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many name requests. Please try again shortly.' })
      }
      const body = await readJson(request)
      // A restricted network only loses new accounts; a known token may still set or confirm its password.
      if (restrictedNetworks.has(networkOf(sourceOf(request))) && !store.profiles.some((entry) => entry.token === body.token)) rejectRestricted()
      const profile = await claimProfile(store.profiles, body)
      if (!attemptSave()) {
        queueSave()
        return send(response, 503, { error: 'Could not save your account. Please try again.' })
      }
      return send(response, 200, { username: profile.username })
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      if (!consume(loginRates, sourceOf(request), CREATE_WINDOW_MS, MAX_LOGINS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many log in attempts. Please try again shortly.' })
      }
      const body = await readJson(request)
      const failureKey = typeof body.username === 'string' ? body.username.normalize('NFKC').trim().toLowerCase().slice(0, 64) : ''
      // Guessing is capped per name as well as per source, so a name can be locked for a
      // while by anyone who knows it. That trade is accepted: the cap is what stops a
      // botnet guessing one account's password.
      // The attempt is counted before the slow hash, so a burst of parallel guesses cannot
      // all pass the check; a login that is not a wrong password gives its slot back.
      const now = Date.now()
      const failures = loginFailures.get(failureKey)
      const attempts = failures && now - failures.startedAt < LOGIN_FAILURE_WINDOW_MS ? failures : { startedAt: now, count: 0 }
      if (attempts.count >= MAX_LOGIN_FAILURES_PER_NAME) {
        return send(response, 429, { error: 'Too many wrong passwords for this name. Please try again later.' })
      }
      // As with mail admin failures, a full table evicts its oldest name instead of skipping the count.
      if (!failures && loginFailures.size >= MAX_RATE_KEYS) loginFailures.delete(loginFailures.keys().next().value)
      attempts.count += 1
      loginFailures.delete(failureKey)
      loginFailures.set(failureKey, attempts)
      let profile
      try { profile = await loginProfile(store.profiles, body) } catch (error) {
        if (error.status !== 401) attempts.count -= 1
        throw error
      }
      loginFailures.delete(failureKey)
      const restricted = isRestrictedName(profile.username)
      if (restricted) noteRestrictedSource(request)
      return send(response, 200, { username: profile.username, token: profile.token, ...(restricted ? { restricted } : {}) })
    }
    if (request.method === 'POST' && url.pathname === '/api/profile/status') {
      if (!consume(statsRates, `status:${sourceOf(request)}`, CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many requests. Please try again shortly.' })
      }
      const body = await readJson(request)
      const profile = typeof body.token === 'string' ? store.profiles.find((entry) => entry.token === body.token) : undefined
      const restricted = Boolean(profile) && isRestrictedName(profile.username)
      if (restricted) noteRestrictedSource(request)
      return send(response, 200, { restricted })
    }
    if (request.method === 'POST' && url.pathname === '/api/profile/stats') {
      if (!consume(statsRates, `profile:${sourceOf(request)}`, CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many requests. Please try again shortly.' })
      }
      const body = await readJson(request)
      const profile = typeof body.token === 'string' ? store.profiles.find((entry) => entry.token === body.token) : undefined
      if (!profile) return send(response, 409, { error: 'Your name is not registered on this server.', code: 'profile' })
      return send(response, 200, personalStats(store.leaderboardRuns, profile.username))
    }
    if (request.method === 'POST' && url.pathname === '/api/profile/ascension') {
      if (!consume(statsRates, `ascension:${sourceOf(request)}`, CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many requests. Please try again shortly.' })
      }
      const body = await readJson(request)
      const profile = typeof body.token === 'string' ? store.profiles.find((entry) => entry.token === body.token) : undefined
      if (!profile) return send(response, 409, { error: 'Your name is not registered on this server.', code: 'profile' })
      const previous = profile.highestAscension
      const reply = syncAscension(profile, store.leaderboardRuns, body.highestAscension)
      if (previous !== reply.highestAscension) store.ascensionsDirty = true
      if (store.ascensionsDirty) {
        if (!attemptSave()) {
          queueSave()
          return send(response, 503, { error: 'Could not save your Ascension. Please try again.' })
        }
        store.ascensionsDirty = false
      }
      return send(response, 200, reply)
    }
    if (request.method === 'POST' && url.pathname === '/api/profile/wallet') {
      if (!consume(statsRates, `wallet:${sourceOf(request)}`, CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many requests. Please try again shortly.' })
      }
      const body = await readJson(request)
      const profile = typeof body.token === 'string' ? store.profiles.find((entry) => entry.token === body.token) : undefined
      if (!profile) return send(response, 200, { registered: false })
      const reply = syncAccountWallet(store, profile, body)
      if (store.walletsDirty) {
        if (!attemptSave()) {
          queueSave()
          return send(response, 503, { error: 'Could not save your wallet. Please try again.' })
        }
        store.walletsDirty = false
      }
      return send(response, 200, reply)
    }
    if (request.method === 'POST' && (url.pathname === '/api/profile/coins' || url.pathname === '/api/profile/coins/confirm')) {
      if (!consume(statsRates, `coins:${sourceOf(request)}`, CREATE_WINDOW_MS, MAX_STATS_READS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many requests. Please try again shortly.' })
      }
      const body = await readJson(request)
      const profile = typeof body.token === 'string' ? store.profiles.find((entry) => entry.token === body.token) : undefined
      // An unregistered or anonymous player simply has no grant: no error for a first visit to log.
      if (!profile) return send(response, 200, url.pathname === '/api/profile/coins' ? { coins: 0 } : { claimed: false })
      const reply = url.pathname === '/api/profile/coins'
        ? claimCoinGrant(store, profile.username, body.claimId)
        : confirmCoinGrant(store, profile.username, body.claimId, body.grantId)
      if (store.coinGrantsChanged) {
        // The reservation or the spend must be on disk before the client acts on it.
        if (!attemptSave()) {
          queueSave()
          return send(response, 503, { error: 'Could not save. Please try again.' })
        }
        store.coinGrantsChanged = false
      }
      return send(response, 200, reply)
    }
    return false
  }
}
