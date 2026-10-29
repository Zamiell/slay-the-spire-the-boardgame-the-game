import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Activate the real button so shortcuts share its guards, sound and run logging. */
export function useButtonShortcut(ref: RefObject<HTMLButtonElement | null>, key: string | undefined, enabled = true) {
  useEffect(() => {
    if (!key || !enabled) return
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.key.toLowerCase() !== key) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [role="textbox"]') ||
        target instanceof HTMLElement && target.isContentEditable) return
      // Space keeps its native activation behavior when a control has focus.
      if (key === ' ' && target?.closest('button, a[href], summary, [role="button"], [role="slider"]')) return
      const button = ref.current
      if (!button || button.matches(':disabled, [aria-disabled="true"]') ||
        button.closest('[inert], [hidden], [aria-hidden="true"]') || !button.getClientRects().length ||
        getComputedStyle(button).visibility === 'hidden') return
      const dialogs = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')
      // Card rewards allow read-only deck/map inspection, but not gameplay shortcuts.
      const inspectingRun = button.matches('.deck-peek__open, .card-collection .ribbon-back, .map-peek__open, .map-peek__close')
      if ([...dialogs].some((dialog) => !dialog.contains(button) &&
        !(inspectingRun && dialog.matches('section.reward-screen--card-choice')))) return
      event.preventDefault()
      button.click()
    }
    document.addEventListener('keydown', press)
    return () => document.removeEventListener('keydown', press)
  }, [enabled, key, ref])
}
