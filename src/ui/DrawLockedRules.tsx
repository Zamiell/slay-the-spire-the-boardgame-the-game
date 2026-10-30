import { useLayoutEffect, useRef } from 'react'
import { KeywordText } from './KeywordText.tsx'
import './styles/draw-locked-rules.css'

/** Scanned lettering cannot take text decoration; replace only its rules panel. */
export function DrawLockedRules({ rules }: { rules: string }) {
  const panel = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const fit = () => {
      if (!element.isConnected || !element.clientWidth || !element.clientHeight) return
      let size = element.clientWidth * 0.09
      element.style.fontSize = `${size}px`
      while (size > 4 && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)) {
        size = Math.max(4, size - 0.5)
        element.style.fontSize = `${size}px`
      }
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    void document.fonts.ready.then(fit)
    fit()
    return () => observer.disconnect()
  }, [rules])
  return <span ref={panel} className="card__draw-locked-rules" aria-hidden="true">
    <KeywordText text={rules} drawLocked />
  </span>
}
