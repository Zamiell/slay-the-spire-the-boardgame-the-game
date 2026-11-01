import type { CharacterId } from './game/types.ts'
import { resetRoomEndpoint, roomUrl } from './multiplayer/room-endpoint.ts'
import { decodeResponse, HttpResponseError, requestJson } from './http.ts'
import type { DecodedResponse, ResponseSchema } from './http.ts'
import { SampleDeckReply, StatsReply } from './protocol/responses.ts'

export type StatsQuery =
  | { op: 'card'; id: string; upgraded: boolean | null }
  | { op: 'not'; value: StatsQuery }
  | { op: 'and' | 'or'; left: StatsQuery; right: StatsQuery }

export type StatsSnapshot = DecodedResponse<typeof StatsReply>
export type StatsMetrics = Pick<StatsSnapshot, 'runs' | 'averageFloors' | 'averageDamage' | 'averageBlock'>

export type StatsFilters = { character: CharacterId | 'all'; ascension: number | 'all' | `${number}+`; mode: 'all' | 'standard' | 'daily' | 'custom' | 'multiplayer'; query: StatsQuery | null }
export type SampleDeck = DecodedResponse<typeof SampleDeckReply>

function paramsFor(filters: StatsFilters) {
  const params = new URLSearchParams({ character: filters.character, ascension: String(filters.ascension), mode: filters.mode })
  if (filters.query) params.set('q', JSON.stringify(filters.query))
  return params
}

async function request<Schema extends ResponseSchema>(path: string, signal: AbortSignal, schema: Schema): Promise<DecodedResponse<Schema>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
    try {
      const endpoint = await roomUrl(path)
      const failure = 'Could not open the stats archive.'
      const reply = await requestJson(endpoint, { cache: 'no-store', signal, timeoutMs: 8_000, failure })
      if (!reply.ok) throw new HttpResponseError(reply.status === 404 ? 'That deck is no longer available.' : failure, reply.status)
      return decodeResponse(schema, reply.body, failure, reply.status)
    } catch (error) {
      if (signal.aborted) throw error
      resetRoomEndpoint()
      if (attempt === 1) throw error
    }
  }
  throw new Error('Could not open the stats archive.')
}

export const loadStats = (filters: StatsFilters, signal: AbortSignal) =>
  request(`/api/stats?${paramsFor(filters)}`, signal, StatsReply)

export const loadSampleDeck = (type: string, filters: StatsFilters, signal: AbortSignal) => {
  const params = paramsFor(filters)
  params.set('type', type)
  return request(`/api/stats/deck?${params}`, signal, SampleDeckReply)
}
