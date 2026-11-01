import * as v from 'valibot'

export class HttpResponseError extends Error {
  readonly status?: number
  readonly kind: 'http' | 'invalid-json' | 'invalid-response' | 'timeout'
  constructor(message: string, status?: number, kind: HttpResponseError['kind'] = 'http', cause?: unknown) {
    super(message, { cause })
    this.status = status
    this.kind = kind
  }
}

export type ResponseSchema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
export type DecodedResponse<Schema extends ResponseSchema> = v.InferOutput<Schema>

export function decodeResponse<Schema extends ResponseSchema>(
  schema: Schema, body: unknown, failure: string, status?: number,
): DecodedResponse<Schema> {
  const parsed = v.safeParse(schema, body)
  if (!parsed.success) throw new HttpResponseError(`${failure} Invalid server response.`, status, 'invalid-response')
  return parsed.output
}

export function responseMessage(body: unknown, fallback: string) {
  return body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error : fallback
}

/** One attempt only. Endpoint discovery, mutation idempotency, and retry policy belong to the caller. */
export async function requestJson(url: string | (() => Promise<string>), options: {
  timeoutMs: number
  failure: string
  method?: 'GET' | 'POST'
  body?: object
  cache?: RequestCache
  signal?: AbortSignal
  headers?: HeadersInit
}) {
  if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.timeoutMs)
  try {
    const endpoint = typeof url === 'function' ? await url() : url
    if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    const response = await fetch(endpoint, {
      method: options.method ?? 'GET', cache: options.cache,
      headers,
      ...(options.body === undefined ? {} : {
        body: JSON.stringify(options.body),
      }),
      signal: controller.signal,
    })
    let body: unknown
    let parseError: HttpResponseError | undefined
    try { body = await response.json() }
    catch (error) {
      if (error instanceof SyntaxError) {
        parseError = new HttpResponseError(options.failure, response.status, 'invalid-json', error)
        if (response.ok) throw parseError
      } else throw error
    }
    if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    if (timedOut) throw new HttpResponseError(options.failure, undefined, 'timeout')
    return { status: response.status, ok: response.ok, body, parseError }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    if (timedOut) throw new HttpResponseError(options.failure, undefined, 'timeout', error)
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
