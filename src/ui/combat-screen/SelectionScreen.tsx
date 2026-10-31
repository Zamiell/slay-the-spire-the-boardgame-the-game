import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import '../styles/hand-discard-selection.css'

export function SelectionScreen({
  action, label, title, description, showDescription = false, layout, source, children,
  selectedCount, minimum, maximum, disabled, active = true,
  onConfirm, confirmLabel, confirmDisabled = false, confirmControls,
  onCancel, cancelLabel = 'Cancel play', viewingBoard, onViewingBoardChange, viewLabel = 'View battlefield',
  returnLabel = 'Return to card selection',
}: {
  action: string
  label: string
  title: ReactNode
  description: ReactNode
  showDescription?: boolean
  layout: 'hand' | 'grid' | 'custom' | 'orbs'
  source?: ReactNode
  children: ReactNode
  selectedCount: number
  minimum: number
  maximum: number
  disabled: boolean
  active?: boolean
  onConfirm?: () => void
  confirmLabel?: string
  confirmDisabled?: boolean
  confirmControls?: ReactNode
  onCancel?: () => void
  cancelLabel?: string
  viewingBoard: boolean
  onViewingBoardChange: (viewing: boolean) => void
  viewLabel?: string
  returnLabel?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLElement>(null)
  const suspendedClose = useRef(false)
  const descriptionId = useId()
  const dismiss = () => {
    if (viewingBoard) onViewingBoardChange(false)
    else if (!disabled) onCancel?.()
  }
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    if (active && !element.open) {
      element.showModal()
      element.focus({ preventScroll: true })
    } else if (!active && element.open) {
      suspendedClose.current = true
      element.close()
    }
  }, [active])
  useLayoutEffect(() => {
    const root = dialog.current
    const header = root?.closest('.app-shell')?.querySelector('.app-shell__header')
    const title = heading.current
    if (!root || !title) return
    const measure = () => {
      if (header) root.style.setProperty('--selection-header-bottom', `${header.getBoundingClientRect().bottom}px`)
      root.style.setProperty('--selection-content-top', `${Math.max(innerHeight * 0.24, title.getBoundingClientRect().bottom + 8)}px`)
    }
    const observer = new ResizeObserver(measure)
    if (header) observer.observe(header)
    observer.observe(title)
    window.addEventListener('resize', measure)
    measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  return <dialog ref={dialog} className="hand-discard" data-action={action.toLowerCase()} data-layout={layout}
    tabIndex={-1} data-viewing-board={viewingBoard || undefined} aria-label={label}
    aria-describedby={descriptionId} onCancel={event => {
      event.preventDefault()
      dismiss()
    }} onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented && (viewingBoard || !onCancel)) {
        event.preventDefault()
        dismiss()
      }
    }} onClose={() => {
      if (suspendedClose.current) { suspendedClose.current = false; return }
      if (!active) return
      if (onCancel && !disabled) onCancel()
      else dialog.current?.showModal()
    }}>
    <header ref={heading} className="hand-discard__heading">
      <h2>{title}</h2>
      <p id={descriptionId} className={showDescription ? undefined : 'visually-hidden'}>{description}</p>
    </header>
    {source ? <div className="hand-discard__source" aria-hidden="true">{source}</div> : null}
    {children}
    <button type="button" className="hand-discard__view" aria-label={viewingBoard ? returnLabel : viewLabel}
      aria-pressed={viewingBoard} onClick={() => onViewingBoardChange(!viewingBoard)}>
      <svg viewBox="0 0 48 32" aria-hidden="true"><path d="M2 16C12-2 36-2 46 16 36 34 12 34 2 16Z" />
        <circle cx="24" cy="16" r="8" /></svg>
    </button>
    <footer className="hand-discard__footer" data-has-selection={selectedCount > 0 || minimum === 0 ||
      !onConfirm && !confirmControls || undefined}>
      {onCancel ? <button type="button" disabled={disabled} onClick={onCancel}>{cancelLabel}</button> : <span />}
      <span aria-live="polite">{onConfirm || confirmControls ? `${selectedCount}/${maximum} selected` : ''}</span>
      {confirmControls ? <div className="hand-discard__confirm-controls" inert={disabled}>{confirmControls}</div>
        : onConfirm ? <button type="button" disabled={disabled || confirmDisabled || selectedCount < minimum || selectedCount > maximum}
          onClick={onConfirm}>{confirmLabel ?? `Confirm ${action.toLowerCase()}`}</button> : null}
    </footer>
  </dialog>
}
