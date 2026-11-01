import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useModalFocus } from './useModalFocus.ts'

export function RewardChoiceScreen({ title, description, choiceKey, className = '', style, disabled, onBack, children }: {
  title: string
  description?: string
  choiceKey: string
  className?: string
  style?: CSSProperties
  disabled?: boolean
  onBack?: () => void
  children: ReactNode
}) {
  const picker = useRef<HTMLElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    const root = picker.current
    const header = root?.closest('.app-shell')?.querySelector<HTMLElement>(':scope > .app-shell__header')
    if (!root || !header) return
    const measure = () => root.style.setProperty('--reward-header-bottom', `${header.getBoundingClientRect().bottom}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useModalFocus(picker, { resetKey: choiceKey })
  useEffect(() => {
    if (!onBack) return
    const back = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !picker.current?.getClientRects().length ||
        document.querySelector('dialog[open]')) return
      event.preventDefault()
      if (!disabled) onBack()
    }
    document.addEventListener('keydown', back)
    return () => document.removeEventListener('keydown', back)
  }, [disabled, onBack])
  return <section ref={picker} className={`reward-screen reward-screen--card-choice ${className}`.trim()} style={style}
    role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={`${id}-title`}
    aria-describedby={description ? `${id}-description` : undefined} aria-busy={disabled || undefined}>
    <h2 className="reward-screen__title" id={`${id}-title`}>{title}</h2>
    {description ? <p className="muted" id={`${id}-description`}>{description}</p> : null}
    {children}
  </section>
}
