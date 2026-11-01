import { useEffect, useLayoutEffect, useMemo, useReducer } from 'react'
import type { CardInstance } from '../../game/types.ts'
import { evaluateCombatQuery, type CombatQuery, type CombatQueryResult } from '../../game/combat/preview-queries.ts'
import { hasCombatSimulation, type CombatView } from '../../game/combat/view.ts'
import type { CombatScreenProps } from './types.ts'

type Revealed = readonly CardInstance[] | undefined
const queryKey = (query: CombatQuery, revealed?: Revealed) => JSON.stringify([query, revealed])
const cancelled = () => new DOMException('The combat query changed.', 'AbortError')

export function useCombatQueries(state: CombatView, viewerId: string,
  version: number | undefined, refresh: number | undefined, restoration: number | undefined,
  onQuery: CombatScreenProps['onQuery']) {
  const [, notify] = useReducer(value => value + 1, 0)
  const simulation = hasCombatSimulation(state) ? state : undefined
  const api = useMemo(() => {
    const values = new Map<string, CombatQueryResult>()
    let latestHud: Extract<CombatQueryResult, { kind: 'hud' }> | undefined
    const pending = new Map<string, { controller: AbortController; promise: Promise<CombatQueryResult> }>()
    const store = {
      active: true, generation: 0, error: '',
      get latestHud() { return latestHud },
      report(error: unknown) {
        if (!store.active || error instanceof DOMException && error.name === 'AbortError') return
        const message = error instanceof Error ? error.message : 'Could not calculate combat choices.'
        if (store.error === message) return
        store.error = message
        console.error('Could not calculate combat choices.', error)
        notify()
      },
      read(query: CombatQuery, revealed?: Revealed) {
        const key = queryKey(query, revealed)
        if (simulation && !values.has(key)) {
          values.set(key, evaluateCombatQuery(simulation, viewerId, query, { revealedCards: revealed }))
        }
        return values.get(key)
      },
      load(query: CombatQuery, revealed?: Revealed): CombatQueryResult | Promise<CombatQueryResult> {
        const cached = store.read(query, revealed)
        if (cached) return cached
        const key = queryKey(query, revealed)
        const existing = pending.get(key)
        if (existing) return existing.promise
        const generation = store.generation
        const controller = new AbortController()
        const promise = Promise.resolve().then(() => {
          if (!store.active || store.generation !== generation || controller.signal.aborted) throw cancelled()
          if (!onQuery || version === undefined) throw new Error('This room does not support authoritative combat previews.')
          return onQuery({ combatId: state.combatId, version, query }, controller.signal)
        }).then(result => {
          if (!store.active || store.generation !== generation || controller.signal.aborted) throw cancelled()
          if (result.kind !== query.kind) throw new Error('The combat preview does not match the requested choice.')
          values.set(key, result)
          if (result.kind === 'hud') latestHud = result
          return result
        }).catch((error: unknown) => {
          if (controller.signal.aborted || store.generation !== generation) throw cancelled()
          if (store.generation === generation) store.report(error)
          throw error
        }).finally(() => {
          if (pending.get(key)?.promise === promise) {
            pending.delete(key)
            if (store.active) notify()
          }
        })
        pending.set(key, { controller, promise })
        return promise
      },
      cancel(query: CombatQuery, revealed: Revealed, promise: CombatQueryResult | Promise<CombatQueryResult>) {
        const key = queryKey(query, revealed)
        const request = pending.get(key)
        if (request?.promise !== promise) return
        pending.delete(key)
        request.controller.abort()
      },
      stop() {
        store.active = false
        store.generation += 1
        for (const request of pending.values()) request.controller.abort()
        pending.clear()
      },
    }
    return store
  }, [simulation, state, viewerId, version, refresh, restoration, onQuery])
  useLayoutEffect(() => {
    api.active = true
    return () => api.stop()
  }, [api])
  return api
}

export function useCombatQuery(
  api: ReturnType<typeof useCombatQueries>, query: CombatQuery | null, revealed?: Revealed,
) {
  const key = query ? queryKey(query, revealed) : null
  const result = query ? api.read(query, revealed) : undefined
  useEffect(() => {
    if (!query || result) return
    // The query owner reports failures; cancellation is expected during restoration.
    const request = api.load(query, revealed)
    void Promise.resolve(request).catch(() => {})
    return () => api.cancel(query, revealed, request)
  }, [api, key, result])
  return result
}
