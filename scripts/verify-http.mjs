import assert from 'node:assert/strict'
import { decodeResponse, HttpResponseError, requestJson } from '../src/http.ts'
import { LeaderboardReply, MailboxReply, ProfileClaimReply, StatsReply, WalletReplySchema } from '../src/protocol/responses.ts'
import { createRoomServer } from './room-server.mjs'

const originalFetch = globalThis.fetch
const originalTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const options = { timeoutMs: 1000, failure: 'Request failed.' }
try {
  let requests = 0
  let captured
  globalThis.fetch = async (_url, init) => {
    requests++
    captured = init
    return { status: 200, ok: true, json: async () => ({ username: 'Ann' }) }
  }
  const reply = await requestJson('http://fixture', { ...options, method: 'POST', body: { choice: 1 } })
  assert.equal(decodeResponse(ProfileClaimReply, reply.body, options.failure).username, 'Ann')
  assert.equal(captured.body, '{"choice":1}')
  const aborted = new AbortController()
  aborted.abort()
  let discoveries = 0
  await assert.rejects(requestJson(async () => { discoveries++; return 'http://fixture' },
    { ...options, signal: aborted.signal }), error => error.name === 'AbortError')
  assert.equal(requests, 1)
  assert.equal(discoveries, 0)

  globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('HTML') } })
  await assert.rejects(requestJson('http://fixture', options),
    error => error instanceof HttpResponseError && error.status === 200 && error.kind === 'invalid-json')
  globalThis.fetch = async () => ({ status: 429, ok: false, json: async () => { throw new SyntaxError('HTML') } })
  const refused = await requestJson('http://fixture', options)
  assert.equal(refused.ok, false)
  assert.equal(refused.status, 429, 'a non-JSON refusal must retain its HTTP classification')
  assert.equal(refused.parseError.kind, 'invalid-json')
  let attempts = 0
  globalThis.fetch = async () => { attempts++; throw new Error('offline') }
  await assert.rejects(requestJson('http://fixture', { ...options, method: 'POST', body: { choice: 1 } }), /offline/)
  assert.equal(attempts, 1, 'the shared transport must never retry a mutation on its own')

  let timeout
  let cleared = 0
  globalThis.setTimeout = callback => { timeout = callback; return 1 }
  globalThis.clearTimeout = () => { cleared++ }
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  const timed = requestJson('http://fixture', options)
  timeout()
  await assert.rejects(timed, error => error instanceof HttpResponseError && error.kind === 'timeout')
  const controller = new AbortController()
  const cancelled = requestJson('http://fixture', { ...options, signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled, error => error.name === 'AbortError' && !(error instanceof HttpResponseError))
  assert.equal(cleared, 2, 'both timeout and cancellation must clean up the deadline')

  let resolveEndpoint
  let fetched = false
  globalThis.fetch = async () => { fetched = true; throw new Error('must not fetch') }
  const delayed = requestJson(() => new Promise(resolve => { resolveEndpoint = resolve }), options)
  timeout()
  resolveEndpoint('http://fixture')
  await assert.rejects(delayed, error => error.kind === 'timeout')
  assert.equal(fetched, false, 'expired endpoint discovery cannot start a mutation')
} finally {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalTimeout
  globalThis.clearTimeout = originalClearTimeout
}

assert.throws(() => decodeResponse(MailboxReply, { letters: 'wrong', unread: 2 }, 'Mail failed.'),
  error => error.kind === 'invalid-response')
assert.throws(() => decodeResponse(WalletReplySchema, { wallet: { coins: '100' } }, 'Wallet failed.'),
  error => error.kind === 'invalid-response')
const legacyMail = decodeResponse(MailboxReply, { letters: [], unread: 2 }, 'Mail failed.')
assert.equal(legacyMail.personalUnread, undefined, 'legacy personal unread remains optional for the caller to normalize')
const compatibleWallet = decodeResponse(WalletReplySchema, { wallet: {
  version: 1, coins: 7, packs: ['future-pack'], skins: ['future-skin'], credited: {}, addPacksToRuns: true,
} }, 'Wallet failed.')
assert.equal(compatibleWallet.wallet.coins, 7, 'unknown future catalogue ids must not discard a valid balance')

const server = createRoomServer({ classifierEnabled: false })
const { port } = await server.listen(0)
try {
  const endpoint = path => `http://127.0.0.1:${port}${path}`
  for (const [path, schema] of [
    ['/api/leaderboard', LeaderboardReply],
    ['/api/stats?character=all&ascension=all&mode=all', StatsReply],
  ]) {
    const reply = await requestJson(endpoint(path), options)
    assert(reply.ok)
    decodeResponse(schema, reply.body, options.failure)
  }
  const token = crypto.randomUUID()
  const profile = await requestJson(endpoint('/api/profile'), {
    ...options, method: 'POST', body: { username: 'TransportTest', token, password: 'transport-test-password' },
  })
  assert(profile.ok)
  decodeResponse(ProfileClaimReply, profile.body, options.failure)
  const mailbox = await requestJson(endpoint('/api/mail'), { ...options, method: 'POST', body: { token } })
  assert(mailbox.ok)
  decodeResponse(MailboxReply, mailbox.body, options.failure)
} finally {
  await server.close()
}
console.log('PASS HTTP mechanics: typed replies, invalid JSON, cancellation, deadlines, and current server compatibility')
