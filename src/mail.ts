import { savedProfile, type Profile } from './profile.ts'
import { resetRoomEndpoint, roomUrl } from './multiplayer/room-endpoint.ts'
import { decodeResponse, HttpResponseError, requestJson, responseMessage } from './http.ts'
import type { DecodedResponse } from './http.ts'
import { MailboxReply, MailDeskReply } from './protocol/responses.ts'

const REQUEST_TIMEOUT_MS = 8_000
/** Matches the room server's limit in scripts/lib/mail.mjs. */
export const MAX_LETTER_LENGTH = 2_000

export type Letter = DecodedResponse<typeof MailboxReply>['letters'][number]
export type Mailbox = DecodedResponse<typeof MailboxReply> & { personalUnread: number }
export type MailThread = DecodedResponse<typeof MailDeskReply>['threads'][number]
export type MailDesk = DecodedResponse<typeof MailDeskReply>

/**
 * Only a hosted build polls on its own. A local build's `/api` is a dev proxy
 * that is usually pointing at nothing, and a background request failing on
 * every menu visit would be noise; opening the mailbox still asks.
 */
export const MAIL_POLLING = import.meta.env.VITE_HOSTED_SESSION === 'true' || import.meta.env.VITE_MAIL === 'true'

type Reply = { status: number; body: unknown }

async function post(path: string, body: Record<string, unknown>): Promise<Reply> {
  try {
    return await requestJson(await roomUrl(path), {
      method: 'POST', body, timeoutMs: REQUEST_TIMEOUT_MS,
      failure: 'The post office is closed right now. Try again later.',
    })
  } catch (cause) {
    resetRoomEndpoint()
    throw new Error('The post office is closed right now. Try again later.', { cause })
  }
}

function mailbox({ status, body }: Reply): Mailbox {
  const failure = 'The letter could not be delivered.'
  if (status < 200 || status >= 300) throw new HttpResponseError(responseMessage(body, failure), status)
  const parsed = decodeResponse(MailboxReply, body, failure, status)
  // Older servers have one unread count, rather than a separate personal count.
  return { ...parsed, personalUnread: parsed.personalUnread ?? parsed.unread }
}

function desk({ status, body }: Reply): MailDesk {
  const failure = 'The server mail could not be opened.'
  if (status < 200 || status >= 300) throw new HttpResponseError(responseMessage(body, failure), status)
  return decodeResponse(MailDeskReply, body, failure, status)
}

function profile(): Profile {
  const saved = savedProfile()
  if (!saved) throw new Error('Choose a name before writing a letter.')
  return saved
}

export async function fetchMailbox(markRead = false, readThroughAt?: number): Promise<Mailbox> {
  return mailbox(await post('/api/mail', { token: profile().token, markRead, readThroughAt }))
}

export async function sendLetter(body: string): Promise<Mailbox> {
  const sent = await post('/api/mail/send', { token: profile().token, body })
  // A server that has lost this browser's name (a reset store, another host) cannot
  // re-claim it without the password, which this browser never keeps.
  if (sent.status === 409 && sent.body && typeof sent.body === 'object' &&
    'code' in sent.body && sent.body.code === 'profile') throw new Error('This server does not know your account. Log out from your profile, then create it again or log in.')
  return mailbox(sent)
}

export async function fetchMailDesk(username?: string, markRead = false, readThroughAt?: number): Promise<MailDesk> {
  return desk(await post('/api/mail/desk', { token: profile().token, ...(username ? { username } : {}), markRead, readThroughAt }))
}

export async function sendMailDeskReply(username: string, body: string): Promise<MailDesk> {
  return desk(await post('/api/mail/desk/reply', { token: profile().token, username, body }))
}
