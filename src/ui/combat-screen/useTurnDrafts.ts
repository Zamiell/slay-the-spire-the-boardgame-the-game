import { useState } from 'react'
import {
  createStartTurnDraft, reconcileStartTurnDraft, updateStartTurnField,
  type StartTurnDraft, type StartTurnDraftInput, type StartTurnFieldUpdate,
} from './start-turn-draft.ts'
import {
  createEndTurnDraft, reconcileEndTurnDraft, updateEndTurnField,
  type EndTurnDraft, type EndTurnDraftInput, type EndTurnFieldUpdate,
} from './end-turn-draft.ts'

/** Reconciliation runs before paint. Delivery locks belong to the action lifecycle, not these drafts. */
export function useStartTurnDraft(input: StartTurnDraftInput) {
  const [stored, setStored] = useState(() => createStartTurnDraft(input))
  const current = reconcileStartTurnDraft(stored, input)
  if (stored !== current) setStored(current)
  return {
    field<Key extends keyof StartTurnDraft>(key: Key) {
      return [current.value[key], (update: StartTurnFieldUpdate<Key>) =>
        setStored(previous => updateStartTurnField(previous, current.scopes, key, update))] as const
    },
  }
}

export function useEndTurnDraft(input: EndTurnDraftInput) {
  const [stored, setStored] = useState(() => createEndTurnDraft(input))
  const current = reconcileEndTurnDraft(stored, input)
  if (stored !== current) setStored(current)
  return {
    field<Key extends keyof EndTurnDraft>(key: Key) {
      return [current.value[key], (update: EndTurnFieldUpdate<Key>) =>
        setStored(previous => updateEndTurnField(previous, current.scopes, key, update))] as const
    },
  }
}
