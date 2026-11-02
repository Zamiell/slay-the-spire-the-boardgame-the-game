import { WELCOME_LETTER, announceToPlayers, developerInbox, developerUnread, ownerOf, playerInbox, sendDeveloperReply, sendPlayerLetter } from '../mail.mjs'
import { timingSafeEqual } from 'node:crypto'
import { send, readJson, sourceOf } from './io.mjs'
import { CREATE_WINDOW_MS, MAX_MAIL_READS_PER_WINDOW, MAIL_SEND_WINDOW_MS, MAX_MAIL_SENDS_PER_WINDOW, MAX_MAIL_SENDS_PER_SOURCE, MAX_MAIL_ADMIN_REPLIES_PER_WINDOW, MAX_MAIL_ADMIN_FAILURES_PER_WINDOW, MAX_RATE_KEYS } from './policies.mjs'

export function createMailRoutes({ store, persistence, rates, mailAdminToken, mailAdminOwners, maxMailCharacters }) {
  const { attemptSave, queueSave } = persistence
  const { consume, mailReadRates, mailSendRates, mailProfileRates, mailAdminReplyRates, mailAdminFailures } = rates
  const mailAdminKey = typeof mailAdminToken === 'string' && mailAdminToken.length >= 24 ? Buffer.from(`Bearer ${mailAdminToken}`) : null
  if (mailAdminToken && !mailAdminKey) console.warn('Mail replies disabled: STS_MAIL_ADMIN_TOKEN must be at least 24 characters')
  const delegatedMailOwners = new Set((typeof mailAdminOwners === 'string' ? mailAdminOwners.split(',') : mailAdminOwners ?? [])
    .map((value) => String(value).trim().toLowerCase()).filter((value) => /^[0-9a-f]{64}$/.test(value)))
  const delegatedMailProfile = (token) => {
    const profile = typeof token === 'string' ? store.profiles.find((entry) => entry.token === token) : undefined
    return profile && delegatedMailOwners.has(ownerOf(profile.token)) ? profile : undefined
  }
  const mailAdminAuthorized = (request, now = Date.now()) => {
    const source = sourceOf(request)
    const failures = mailAdminFailures.get(source)
    const current = failures && now - failures.startedAt < CREATE_WINDOW_MS ? failures : undefined
    const offered = Buffer.from(request.headers.authorization?.toString() ?? '')
    const matches = offered.length === mailAdminKey.length && timingSafeEqual(offered, mailAdminKey)
    if (matches && (current?.count ?? 0) < MAX_MAIL_ADMIN_FAILURES_PER_WINDOW) return true
    if (!matches) {
      // A full table must evict the oldest source, never stop counting failures.
      if (!current && mailAdminFailures.size >= MAX_RATE_KEYS) mailAdminFailures.delete(mailAdminFailures.keys().next().value)
      mailAdminFailures.delete(source)
      mailAdminFailures.set(source, { startedAt: current?.startedAt ?? now, count: (current?.count ?? 0) + 1 })
    }
    return false
  }
  const saveMail = (undo) => {
    store.mailDirty = true
    if (attemptSave()) return true
    undo()
    return false
  }
  return async function handle(request, response, url) {
    if (request.method === 'POST' && (url.pathname === '/api/mail' || url.pathname === '/api/mail/send')) {
      const sending = url.pathname === '/api/mail/send'
      if (!consume(sending ? mailSendRates : mailReadRates, sourceOf(request), sending ? MAIL_SEND_WINDOW_MS : CREATE_WINDOW_MS,
        sending ? MAX_MAIL_SENDS_PER_SOURCE : MAX_MAIL_READS_PER_WINDOW)) {
        return send(response, 429, { error: sending ? 'You have sent a lot of letters. Please wait a little.' : 'Too many mail requests' })
      }
      const body = await readJson(request)
      const profile = typeof body.token === 'string' ? store.profiles.find((entry) => entry.token === body.token) : undefined
      if (!sending) {
        // An unknown profile simply has no letters yet: a first visit reads an
        // empty mailbox rather than an error.
        if (!profile) return send(response, 200, { letters: [], unread: 0, admin: false })
        const admin = delegatedMailOwners.has(ownerOf(profile.token))
        const readOptions = { markRead: body.markRead === true, readThroughAt: body.readThroughAt }
        let inbox = playerInbox(store.mail, profile, readOptions)
        if (!admin && inbox.letters.length === 0) {
          try {
            const { undo } = sendDeveloperReply(store.mail, profile.username, WELCOME_LETTER, store.profiles, { maxCharacters: maxMailCharacters })
            if (saveMail(undo)) inbox = playerInbox(store.mail, profile, readOptions)
          } catch {}
        }
        if (inbox.changed) {
          store.mailDirty = true
          queueSave()
        }
        return send(response, 200, {
          letters: inbox.letters,
          unread: admin ? developerUnread(store.mail, profile.username) : inbox.unread,
          personalUnread: inbox.unread,
          admin,
        })
      }
      if (!profile) return send(response, 409, { error: 'Your name is not registered on this server.', code: 'profile' })
      if (delegatedMailOwners.has(ownerOf(profile.token))) return send(response, 403, { error: 'Server mailbox accounts only reply to player letters.' })
      if (!consume(mailProfileRates, profile.username, MAIL_SEND_WINDOW_MS, MAX_MAIL_SENDS_PER_WINDOW)) {
        return send(response, 429, { error: 'You have sent a lot of letters. Please wait a little.' })
      }
      // A letter that is refused or cannot be saved does not count against the allowance.
      const refund = () => { const rate = mailProfileRates.get(profile.username); if (rate) rate.count -= 1 }
      let sent
      try { sent = sendPlayerLetter(store.mail, profile, body.body, { maxCharacters: maxMailCharacters }) } catch (error) {
        refund()
        throw error
      }
      if (!saveMail(sent.undo)) {
        refund()
        return send(response, 503, { error: 'Could not send your letter. Please try again.' })
      }
      return send(response, 201, { letters: sent.letters, unread: sent.unread })
    }
    if (request.method === 'POST' && (url.pathname === '/api/mail/desk' || url.pathname === '/api/mail/desk/reply')) {
      const source = sourceOf(request)
      if (!consume(url.pathname.endsWith('/reply') ? mailSendRates : mailReadRates, source,
        url.pathname.endsWith('/reply') ? MAIL_SEND_WINDOW_MS : CREATE_WINDOW_MS,
        url.pathname.endsWith('/reply') ? MAX_MAIL_SENDS_PER_SOURCE : MAX_MAIL_READS_PER_WINDOW)) {
        return send(response, 429, { error: 'Too many mail requests' })
      }
      const body = await readJson(request)
      const profile = delegatedMailProfile(body.token)
      if (!profile) return send(response, 403, { error: 'This account cannot manage server mail.' })
      if (url.pathname === '/api/mail/desk') {
        const inbox = developerInbox(store.mail, store.profiles, {
          username: typeof body.username === 'string' ? body.username : undefined,
          markRead: body.markRead === true,
          readThroughAt: body.readThroughAt,
          excludeUsername: profile.username,
        })
        if (inbox.changed) {
          store.mailDirty = true
          queueSave()
        }
        return send(response, 200, { threads: inbox.threads, unread: inbox.unread })
      }
      const incoming = developerInbox(store.mail, store.profiles, { username: body.username, excludeUsername: profile.username }).threads[0]
      if (!incoming?.letters.some((letter) => letter.from === 'player')) {
        return send(response, 404, { error: 'No player letter to answer.' })
      }
      if (!consume(mailAdminReplyRates, ownerOf(profile.token), MAIL_SEND_WINDOW_MS, MAX_MAIL_ADMIN_REPLIES_PER_WINDOW)) {
        return send(response, 429, { error: 'You have sent a lot of replies. Please wait a little.' })
      }
      const { undo, ...reply } = sendDeveloperReply(store.mail, body.username, body.body, store.profiles, { maxCharacters: maxMailCharacters })
      if (!saveMail(undo)) return send(response, 503, { error: 'Could not save the reply. Please try again.' })
      const updated = developerInbox(store.mail, store.profiles, { username: reply.username, excludeUsername: profile.username })
      return send(response, 201, { ...reply, threads: updated.threads, unread: updated.unread })
    }
    if (url.pathname === '/api/mail/admin' || url.pathname === '/api/mail/admin/reply' || url.pathname === '/api/mail/admin/announce') {
      if (!mailAdminKey) return send(response, 404, { error: 'Not found' })
      if (!mailAdminAuthorized(request)) return send(response, 401, { error: 'Unauthorized' })
      if (request.method === 'GET' && url.pathname === '/api/mail/admin') {
        const inbox = developerInbox(store.mail, store.profiles, {
          username: url.searchParams.get('username') ?? undefined, markRead: url.searchParams.get('markRead') === 'true',
        })
        if (inbox.changed) {
          store.mailDirty = true
          queueSave()
        }
        return send(response, 200, { threads: inbox.threads })
      }
      if (request.method === 'POST' && url.pathname === '/api/mail/admin/reply') {
        const body = await readJson(request)
        const { undo, ...reply } = sendDeveloperReply(store.mail, body.username, body.body, store.profiles, { maxCharacters: maxMailCharacters })
        if (!saveMail(undo)) return send(response, 503, { error: 'Could not save the reply. Please try again.' })
        return send(response, 201, reply)
      }
      if (request.method === 'POST' && url.pathname === '/api/mail/admin/announce') {
        // One letter to every registered player except the delegated mailbox accounts.
        const body = await readJson(request)
        // A flag that is not a real boolean must not turn a rehearsal into a live send to everyone.
        if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return send(response, 400, { error: 'dryRun must be true or false.' })
        const dryRun = body.dryRun === true
        const { undo, ...announced } = announceToPlayers(store.mail, store.profiles, body.body, {
          excludeOwners: delegatedMailOwners, dryRun, maxCharacters: maxMailCharacters,
        })
        if (announced.sent > 0 && !saveMail(undo)) return send(response, 503, { error: 'Could not save the announcement. Please try again.' })
        return send(response, dryRun ? 200 : 201, announced)
      }
      return send(response, 405, { error: 'Method not allowed' })
    }
    return false
  }
}
