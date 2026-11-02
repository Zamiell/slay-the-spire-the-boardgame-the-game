import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Escape scene containers without losing the run's theme, inert state, or actual HUD boundary. */
export function ChoiceOverlay({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const shell = anchor.current?.closest('.app-shell')
    const layer = document.createElement('div')
    layer.className = 'sts-scope choice-overlay-host'
    layer.style.display = 'contents'
    const header = shell?.querySelector<HTMLElement>(':scope > .app-shell__header')
    const measure = () => layer.style.setProperty('--choice-overlay-top',
      `${Math.max(0, header?.getBoundingClientRect().bottom ?? 0)}px`)
    measure()
    ;(shell ?? document.body).append(layer)
    const observer = new ResizeObserver(measure)
    if (header) observer.observe(header)
    window.addEventListener('resize', measure)
    setHost(layer)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      layer.remove()
    }
  }, [])
  return <><span ref={anchor} hidden data-choice-overlay-anchor />
    {host ? createPortal(children, host) : null}</>
}
