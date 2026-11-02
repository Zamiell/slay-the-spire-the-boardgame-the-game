import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useModalFocus } from './useModalFocus.ts'
import { ChoiceOverlay } from './ChoiceOverlay.tsx'

type Props = {
  title: string
  description?: string
  choiceKey: string
  className?: string
  style?: CSSProperties
  disabled?: boolean
  onBack?: () => void
  children: ReactNode
}

export function RewardChoiceScreen(props: Props) {
  return <ChoiceOverlay><RewardChoiceContent {...props} /></ChoiceOverlay>
}

function RewardChoiceContent({ title, description, choiceKey, className = '', style, disabled, onBack, children }: Props) {
  const picker = useRef<HTMLElement>(null)
  const id = useId()
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
