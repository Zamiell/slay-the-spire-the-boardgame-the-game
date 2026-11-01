import { autoUpdate, computePosition, flip, offset, shift, useFloating } from '@floating-ui/react'

const middleware = [offset(8), flip({ padding: 16 }), shift({ padding: 16, crossAxis: true })]

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
