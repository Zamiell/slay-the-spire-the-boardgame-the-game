import { useEffect } from 'react'

/** Touch browsers can defer :active until release; mirror the press without taking over the gesture. */
export function useControlPress() {
  useEffect(() => {
    let pressed: HTMLElement | null = null
    let pointer = -1
    let startX = 0
    let startY = 0
    const clear = () => {
      pressed?.removeAttribute('data-ui-pressed')
      pressed = null
      pointer = -1
    }
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      clear()
      if (!event.isPrimary || !(event.target instanceof Element)) return
      const control = event.target.closest<HTMLElement>('button, summary')
      if (!control || control.matches(':disabled, [aria-disabled="true"]') ||
        control.closest('.card, .enemy, .room, .compendium-card, .power, .pile, .map-drawing__button')) return
      pressed = control
      pointer = event.pointerId
      startX = event.clientX
      startY = event.clientY
      control.setAttribute('data-ui-pressed', '')
    }
    const move = (event: PointerEvent) => {
      if (pressed && event.pointerId === pointer &&
        (Math.hypot(event.clientX - startX, event.clientY - startY) > 12 || !pressed.isConnected)) clear()
    }
    const end = (event: PointerEvent) => { if (event.pointerId === pointer) clear() }
    document.addEventListener('pointerdown', down, { passive: true })
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerup', end, { passive: true })
    document.addEventListener('pointercancel', end, { passive: true })
    window.addEventListener('blur', clear)
    return () => {
      clear()
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', clear)
    }
  }, [])
}
