export type ScopedSelection<Selection> = { scope: string; value: Selection }

/** A new owner/combat must never render the previous scope's private draft. */
export function selectionForScope<Selection>(
  current: ScopedSelection<Selection>, scope: string, initial: Selection,
): ScopedSelection<Selection> {
  return current.scope === scope ? current : { scope, value: initial }
}

export function updateScopedSelection<Selection>(
  current: ScopedSelection<Selection>, scope: string, update: (selection: Selection) => Selection,
): ScopedSelection<Selection> {
  if (current.scope !== scope) return current
  const value = update(current.value)
  return value === current.value ? current : { scope, value }
}
