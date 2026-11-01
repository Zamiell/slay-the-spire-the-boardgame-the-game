import { useLayoutEffect, useRef, useState } from 'react'
import type { ActionOutcome } from '../../multiplayer/useRoomSession.ts'
import { transitionAction } from './action-lifecycle.ts'
import { deliverAction } from './action-delivery.ts'
import type { ActionEvent, ActionLifecycle, ActionResolution } from './action-lifecycle.ts'

type Options<Payload, Board> = {
  scope: string
  board: Board
  refresh?: number
  version?: number
  awaitCommit?: boolean
  lockRef?: { current: boolean }
  committed: (payload: Payload, board: Board) => boolean
  reconciled: (payload: Payload, committed: boolean, board: Board) => void
}

/**
 * One in-flight irreversible operation. Ref-backed transitions close the gap
 * before React renders; scope/token checks discard replies after reset/unmount.
 * Operation-specific evidence and draft restoration stay with the controller.
 */
export function useActionLifecycle<Payload, Board>(options: Options<Payload, Board>) {
  const machine = useRef<ActionLifecycle<Payload, Board>>({ kind: 'idle' })
  const latest = useRef(options)
  latest.current = options
  const sequence = useRef(0)
  const scope = useRef(options.scope)
  const mounted = useRef(true)
  const [phase, setPhase] = useState<ActionLifecycle<Payload, Board>['kind']>('idle')
  const completion = useRef<((outcome: ActionOutcome) => void) | undefined>(undefined)

  function apply(event: ActionEvent<Payload, Board, ActionOutcome>) {
    const result = transitionAction(machine.current, event)
    machine.current = result.state
    if (latest.current.lockRef) latest.current.lockRef.current = result.state.kind !== 'idle'
    setPhase(result.state.kind)
    return result.resolution
  }

  function finish(resolution?: ActionResolution<Payload, ActionOutcome>) {
    if (!resolution) return
    const callback = completion.current
    completion.current = undefined
    if (resolution.kind === 'outcome') callback?.(resolution.outcome)
    if (resolution.kind === 'reconciled') {
      latest.current.reconciled(resolution.payload, resolution.committed, latest.current.board)
    }
  }

  function observe() {
    const current = machine.current
    if (current.kind === 'idle') return
    finish(apply({
      type: 'observe', board: latest.current.board, latestRefresh: latest.current.refresh,
      version: latest.current.version,
      committed: latest.current.committed(current.payload, latest.current.board),
    }))
  }

  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode replays effects without discarding refs. Retain the lock so
      // an automatic action in a later layout effect cannot be sent twice.
      // A real unmount is still fenced by mounted before any reply is applied.
    }
  }, [])

  useLayoutEffect(() => {
    if (scope.current !== options.scope) {
      scope.current = options.scope
      completion.current = undefined
      apply({ type: 'reset' })
    } else observe()
  }, [options.scope, options.board, options.refresh, options.version])

  function submit(
    payload: Payload,
    send: (isCurrent: () => boolean) => void | Promise<ActionOutcome | void>,
    online: boolean,
    onOutcome?: (outcome: ActionOutcome) => void,
  ) {
    if (!mounted.current || machine.current.kind !== 'idle') return false
    const id = ++sequence.current
    const submittedScope = latest.current.scope
    completion.current = onOutcome
    apply({ type: 'start', id, payload, mode: online ? 'online' : 'local', board: latest.current.board,
      awaitCommit: latest.current.awaitCommit })
    const isCurrent = () => mounted.current && latest.current.scope === submittedScope &&
      machine.current.kind !== 'idle' && machine.current.id === id
    const receive = (outcome?: ActionOutcome) => {
      if (!isCurrent()) return
      finish(apply(outcome
        ? { type: 'reply', id, outcome, latestRefresh: latest.current.refresh,
            commitVersion: latest.current.version === undefined ? undefined : outcome.snapshot?.version }
        : { type: 'failed', id, latestRefresh: latest.current.refresh }))
      // A REST render may have arrived before its action callback.
      observe()
    }
    if (online) {
      void deliverAction(() => send(isCurrent), receive, () => receive())
    } else {
      try {
        send(isCurrent)
      } catch (error) {
        completion.current = undefined
        apply({ type: 'reset' })
        throw error
      }
    }
    return true
  }

  return { busy: phase !== 'idle', phase, locked: () => machine.current.kind !== 'idle', submit }
}
