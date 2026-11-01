import { resetRoomEndpoint, roomUrl } from './multiplayer/room-endpoint.ts'
import type { Wallet } from './wallet.ts'
import type { BossCoinAward } from './game/coins.ts'
import { decodeResponse, HttpResponseError, requestJson, responseMessage } from './http.ts'
import type { DecodedResponse, ResponseSchema } from './http.ts'
import { AscensionReply, LoginReply, ProfileClaimReply, ProfileStatsReply, StandingReply, WalletReplySchema } from './protocol/responses.ts'

export type WalletCredit = { runKey: string; awards: BossCoinAward[]; joinedAfter: number }
export type WalletMigration = { id: string; wallet: Wallet }
/** What one request buys: a pack or a skin, by id. */
export type WalletPurchase = { pack: string } | { skin: string }
export type WalletReply = { wallet: Wallet; purchase?: { ok: boolean; reason?: string } }
export const syncProfileWallet = (profile: Profile, migration: WalletMigration | undefined, credits: WalletCredit[], purchase?: WalletPurchase) =>
  post('/api/profile/wallet', { token: profile.token, migration, credits, ...purchase }, 'Could not sync your coins. Please try again.', WalletReplySchema)
    .then((reply) => {
      if ('registered' in reply) throw new Error('Your account is not registered on this server. Please log in again.')
      return reply
    })

export const syncProfileAscension = (profile: Profile, highestAscension: number) =>
  post('/api/profile/ascension', { token: profile.token, highestAscension }, 'Could not sync your Ascension. Please try again.', AscensionReply)

/** Where the signed-in profile is stored; other modules listen for it in `storage` events. */
export const PROFILE_KEY = 'sts-profile'
const KEY = PROFILE_KEY
const TOKEN_KEY = 'sts-profile-token'
const CLAIM_NAME_KEY = 'sts-profile-claim-name'
const CHANGE_EVENT = 'sts-profile-change'
// Set when the server restricts the account; it stays on the browser after the profile is gone.
const RESTRICTED_KEY = 'sts-restricted'
export const SPIRE_REJECTION = 'Spire rejects room-temperature IQ'
const REQUEST_TIMEOUT_MS = 5_000
// Both lengths match the server's limits in scripts/lib/profiles.mjs.
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128
/** `secured` is set once the account has a password; older profiles are asked for one on the next visit. */
export type Profile = { username: string; token: string; secured?: true }

export type ProfileStats = DecodedResponse<typeof ProfileStatsReply>

/** Usernames compare like the server compares them. */
export const normalizeUsername = (username: string): string => username.normalize('NFKC').trim().toLowerCase()

/** True where a room server holds the accounts; standalone games have none to ask. */
export const ACCOUNT_SERVER = import.meta.env?.VITE_HOSTED_SESSION === 'true' || import.meta.env?.VITE_MAIL === 'true' ||
  import.meta.env?.VITE_COIN_GRANTS === 'true'

export function isRestricted() {
  try { return localStorage.getItem(RESTRICTED_KEY) === '1' } catch { return false }
}

function setRestricted(restricted: boolean) {
  if (isRestricted() === restricted) return
  if (restricted) localStorage.setItem(RESTRICTED_KEY, '1')
  else localStorage.removeItem(RESTRICTED_KEY)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function savedProfile(): Profile | null {
  try {
    const profile = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return typeof profile?.username === 'string' && profile.username.trim().length >= 2 &&
      typeof profile?.token === 'string' && /^[0-9a-f-]{36}$/.test(profile.token) ? profile : null
  } catch { return null }
}

// Play in progress belongs to the account that started it: another account must not resume it.
const ACCOUNT_PLAY_KEYS = ['sts-solo-run', 'sts-room-recoveries']
// The seat a tab is in lives in sessionStorage, not localStorage.
const ACCOUNT_SESSION_KEY = 'sts-room-session'
const clearAccountPlay = () => {
  for (const key of ACCOUNT_PLAY_KEYS) localStorage.removeItem(key)
  sessionStorage.removeItem(ACCOUNT_SESSION_KEY)
}

/** True while this browser holds a saved run or room seat that logging out would discard. */
export const hasAccountPlay = () => ACCOUNT_PLAY_KEYS.some((key) => localStorage.getItem(key) !== null) ||
  sessionStorage.getItem(ACCOUNT_SESSION_KEY) !== null

function saveProfile(profile: Profile) {
  if (savedProfile()?.token !== profile.token) clearAccountPlay()
  localStorage.setItem(KEY, JSON.stringify(profile))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Calls `listener` whenever the signed-in profile, or this browser's restricted marker, changes. */
export function onProfileChange(listener: () => void) {
  // Another tab marking this browser restricted is a change here too.
  const storage = (event: StorageEvent) => { if (event.key === RESTRICTED_KEY) listener() }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(CHANGE_EVENT, listener); window.removeEventListener('storage', storage) }
}

// One retry on a network failure; a 4xx answer is final and its message is shown to the player.
async function post<Schema extends ResponseSchema>(
  path: string, body: Record<string, unknown>, failure: string, schema: Schema,
): Promise<DecodedResponse<Schema>> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reply = await requestJson(await roomUrl(path), {
        method: 'POST', body, timeoutMs: REQUEST_TIMEOUT_MS, failure,
      })
      if (!reply.ok) throw new HttpResponseError(responseMessage(reply.body, failure), reply.status)
      return decodeResponse(schema, reply.body, failure, reply.status)
    } catch (error) {
      const status = error instanceof HttpResponseError ? error.status : undefined
      const terminal = status !== undefined && status >= 400 && status < 500
      resetRoomEndpoint()
      if (terminal) throw error
      lastError = error
    }
  }
  throw lastError
}

const UNREACHABLE = 'The Spire is out of reach. Please try again.'

/** Creates a new account, or gives an existing name-only profile its first password. */
async function claim(username: string, token: string, password: string): Promise<Profile> {
  const reply = await post('/api/profile', { username, token, password }, 'Could not save your account. Please try again.', ProfileClaimReply)
  const profile: Profile = { username: reply.username, token, secured: true }
  saveProfile(profile)
  return profile
}

export function registerProfile(username: string, password: string): Promise<Profile> {
  if (isRestricted()) return Promise.reject(new Error(SPIRE_REJECTION))
  // Persist the claim token first so retrying a lost response cannot strand a name. It is only
  // reused for the same name: another name would be refused, and the token of the profile
  // being replaced would claim the old name.
  const stored = localStorage.getItem(TOKEN_KEY)
  const name = normalizeUsername(username)
  const token = stored && stored !== savedProfile()?.token && localStorage.getItem(CLAIM_NAME_KEY) === name ? stored : crypto.randomUUID()
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(CLAIM_NAME_KEY, name)
  return claim(username, token, password)
}

export const secureProfile = (profile: Profile, password: string) => claim(profile.username, profile.token, password)

export async function logIn(username: string, password: string): Promise<Profile> {
  const reply = await post('/api/login', { username, password }, UNREACHABLE, LoginReply)
  setRestricted(reply.restricted === true)
  const profile: Profile = { username: reply.username, token: reply.token, secured: true }
  saveProfile(profile)
  return profile
}

/** Asks the server whether the signed-in account is restricted, and marks or clears this browser to match. */
export async function checkStanding() {
  const profile = savedProfile()
  if (!profile || !ACCOUNT_SERVER) return
  try {
    const { restricted } = await post('/api/profile/status', { token: profile.token }, UNREACHABLE, StandingReply)
    // The answer is about the account asked; a different one may have signed in meanwhile.
    if (savedProfile()?.token === profile.token) setRestricted(restricted)
  } catch { /* The next visit asks again. */ }
}

export function logOut() {
  if (isRestricted()) return
  localStorage.removeItem(KEY)
  // A new account must not reuse this account's claim token.
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(CLAIM_NAME_KEY)
  clearAccountPlay()
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export const loadProfileStats = (profile: Profile) =>
  post('/api/profile/stats', { token: profile.token }, 'Could not open your record. Please try again.', ProfileStatsReply)
