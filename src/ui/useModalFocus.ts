import { useEffect } from 'react'
import type { RefObject } from 'react'

const CONTROLS = 'button, input, select, textarea, a[href], [tabindex]'

/** Focus ownership for non-native modal screens. Native dialogs keep their browser-managed trap. */
export function useModalFocus(rootRef: RefObject<HTMLElement | null>, {
  active = true, resetKey, initial = 'root', contain = false, allowFocusOutside,
}: {
  active?: boolean
  resetKey?: string | number
  initial?: 'root' | 'first'
  contain?: boolean
  allowFocusOutside?: string
} = {}) {
  useEffect(() => {
    const root = rootRef.current
    if (!active || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controls = () => [...root.querySelectorAll<HTMLElement>(CONTROLS)]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [aria-disabled="true"]') &&
        element.getClientRects().length > 0 && !element.closest('[inert]') &&
        getComputedStyle(element).visibility !== 'hidden')
    const focusInitial = () => (initial === 'first' ? controls()[0] ?? root : root).focus()
    const retain = (event: FocusEvent) => {
      if (event.target instanceof Element && allowFocusOutside && event.target.closest(allowFocusOutside)) return
      if (event.target instanceof Node && !root.contains(event.target)) focusInitial()
    }
    const tab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const items = controls()
      const first = items[0], last = items.at(-1)
      if (!first || !last) {
        event.preventDefault()
        root.focus()
      } else if (event.shiftKey && (document.activeElement === root || document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    focusInitial()
    root.addEventListener('keydown', tab)
    if (contain) document.addEventListener('focusin', retain)
    return () => {
      root.removeEventListener('keydown', tab)
      if (contain) document.removeEventListener('focusin', retain)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [rootRef, active, resetKey, initial, contain, allowFocusOutside])
}
