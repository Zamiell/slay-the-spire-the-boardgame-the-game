import { useState } from 'react'
import type { SetStateAction } from 'react'
import { selectionForScope, updateScopedSelection } from './selection-scope.ts'

/** Draft resets are independent of action delivery; reconnects must not release unknown locks. */
export function useScopedSelection<Selection>(scope: string, initial: Selection) {
  const [stored, setStored] = useState(() => ({ scope, value: initial }))
  const current = selectionForScope(stored, scope, initial)
  if (current !== stored) setStored(current)
  function setSelection(update: SetStateAction<Selection>) {
    setStored((previous) => updateScopedSelection(previous, scope, (selection) =>
      typeof update === 'function' ? (update as (value: Selection) => Selection)(selection) : update))
  }
  return [current.value, setSelection] as const
}
