export type DeliveryOutcome = {
  status: 'accepted' | 'refused' | 'reconciled' | 'unknown'
  refreshAttempt?: number
}

/** Legacy callback contract: fulfillment without a result acknowledges completion.
 * Rejection is a separate failure event, never a successful void completion. */
export function completedActionOutcome<Outcome extends DeliveryOutcome>(
  outcome: Outcome | void,
): Outcome | { status: 'accepted' } {
  return outcome ?? { status: 'accepted' }
}

type Submission<Payload, Board> = { id: number; payload: Payload; board: Board; awaitCommit?: boolean }
export type ActionLifecycle<Payload, Board> =
  | { kind: 'idle' }
  | Submission<Payload, Board> & { kind: 'pending'; mode: 'local' | 'online' }
  | Submission<Payload, Board> & { kind: 'unknown' | 'accepted'; mode: 'online'; refreshAttempt?: number; commitVersion?: number }

export type ActionEvent<Payload, Board, Outcome extends DeliveryOutcome> =
  | { type: 'start'; id: number; payload: Payload; mode: 'local' | 'online'; board: Board; awaitCommit?: boolean }
  | { type: 'reply'; id: number; outcome: Outcome; latestRefresh?: number; commitVersion?: number }
  | { type: 'failed'; id: number; latestRefresh?: number }
  | { type: 'observe'; board: Board; committed: boolean; latestRefresh?: number; version?: number }
  | { type: 'reset' }

export type ActionResolution<Payload, Outcome> =
  | { kind: 'outcome'; payload: Payload; outcome: Outcome }
  | { kind: 'reconciled'; payload: Payload; committed: boolean }
  | { kind: 'local'; payload: Payload }

/** Missing refresh metadata is not evidence that an irreversible action failed. */
export function unknownActionDecision(committed: boolean, attempt?: number, latest?: number) {
  if (committed) return 'committed'
  if (attempt !== undefined && latest !== undefined && latest > attempt) return 'restore'
  return 'wait'
}

export function transitionAction<Payload, Board, Outcome extends DeliveryOutcome>(
  state: ActionLifecycle<Payload, Board>,
  event: ActionEvent<Payload, Board, Outcome>,
): { state: ActionLifecycle<Payload, Board>; resolution?: ActionResolution<Payload, Outcome> } {
  const stay = { state }
  if (event.type === 'reset') return { state: { kind: 'idle' } }
  if (event.type === 'start') return state.kind !== 'idle' ? stay : {
    state: { kind: 'pending', id: event.id, payload: event.payload, mode: event.mode, board: event.board,
      awaitCommit: event.awaitCommit },
  }
  if (state.kind === 'idle') return stay
  if (event.type === 'reply' || event.type === 'failed') {
    if (state.kind !== 'pending' || state.mode !== 'online' || event.id !== state.id) return stay
    if (event.type === 'failed' || event.outcome.status === 'unknown') return {
      state: { ...state, kind: 'unknown', mode: 'online',
        refreshAttempt: event.type === 'reply'
          ? event.outcome.refreshAttempt ?? event.latestRefresh : event.latestRefresh },
    }
    if (state.awaitCommit && event.outcome.status === 'accepted') return {
      state: { ...state, kind: 'accepted', mode: 'online', refreshAttempt: event.latestRefresh,
        commitVersion: event.commitVersion },
    }
    return { state: { kind: 'idle' }, resolution: { kind: 'outcome', payload: state.payload, outcome: event.outcome } }
  }
  if (state.mode === 'local' && event.board !== state.board) {
    return { state: { kind: 'idle' }, resolution: { kind: 'local', payload: state.payload } }
  }
  if (state.kind !== 'unknown' && state.kind !== 'accepted') return stay
  if (state.kind === 'accepted' && state.commitVersion !== undefined) {
    return event.version !== undefined && event.version >= state.commitVersion
      ? { state: { kind: 'idle' }, resolution: { kind: 'reconciled', payload: state.payload, committed: true } }
      : stay
  }
  const decision = unknownActionDecision(event.committed, state.refreshAttempt, event.latestRefresh)
  return decision === 'wait' ? stay : {
    state: { kind: 'idle' },
    resolution: { kind: 'reconciled', payload: state.payload, committed: decision === 'committed' },
  }
}
