import { autoUpdate, computePosition, flip, offset, shift, useFloating, type Middleware } from '@floating-ui/react'
import { avoidTooltipControls } from './tooltip-position.ts'

export function tooltipControlBounds(floating: HTMLElement) {
  return [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"]')]
    .filter(element => !floating.contains(element) && element.getClientRects().length > 0 &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
      (!element.closest('details:not([open])') || element.closest('summary')) &&
      getComputedStyle(element).visibility !== 'hidden')
    .map(element => (element.querySelector('.enemy__hit-area') ?? element).getBoundingClientRect())
    .filter(box => box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight)
}

const avoidControls: Middleware = {
  name: 'avoidControls',
  fn({ x, y, rects, elements }) {
    const placed = avoidTooltipControls({ ...rects.floating, x, y },
      { width: window.innerWidth, height: window.innerHeight }, tooltipControlBounds(elements.floating))
    return { x: placed.x, y: placed.y, data: { overlap: placed.overlap } }
  },
}
const middleware = [offset(8), flip({ padding: 16 }), shift({ padding: 16, crossAxis: true }), avoidControls]

export { autoUpdate }

export function positionTooltip(reference: HTMLElement, floating: HTMLElement) {
  return computePosition(reference, floating, { placement: 'bottom-start', strategy: 'fixed', middleware })
}

/** Positioning only: game-specific confirmation and dismissal remain with the owner. */
export function useTooltipPosition(open: boolean) {
  return useFloating({
    open,
    placement: 'bottom-start',
    strategy: 'fixed',
    transform: false,
    middleware,
    whileElementsMounted: autoUpdate,
  })
}
