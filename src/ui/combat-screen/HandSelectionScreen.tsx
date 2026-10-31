import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CardInstance } from '../../game/types.ts'
import type { CardBlockPreview } from '../../game/combat.ts'
import { Card } from '../Card.tsx'
import { useReducedEffects } from './hooks.ts'
import { useHandLayout } from './useHandLayout.ts'
import '../styles/hand-discard-selection.css'

export function HandSelectionScreen({
  cards, selectedUids, minimum, maximum, source, sourceCard, blockPreviews, action, disabled, active = true,
  drawLocked, sharedDrawLocked, stanceChangedThisTurn, onSelect, onConfirm, onCancel,
  title, description, confirmLabel, cancelLabel = 'Cancel play', confirmDisabled = false,
  cardSource = 'hand', canSelect, renderCardAction, cost, confirmControls, children, viewLabel = 'View battlefield',
}: {
  cards: readonly CardInstance[]
  selectedUids: readonly string[]
  minimum: number
  maximum: number
  source: string
  sourceCard?: CardInstance
  blockPreviews?: ReadonlyMap<string, CardBlockPreview>
  action: string
  title?: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmDisabled?: boolean
  cardSource?: 'hand' | 'draw' | 'discard' | 'exhaust' | 'revealed' | 'chamber'
  canSelect?: (card: CardInstance) => boolean
  renderCardAction?: (card: CardInstance) => ReactNode
  cost?: number
  confirmControls?: ReactNode
  children?: ReactNode
  viewLabel?: string
  disabled: boolean
  active?: boolean
  drawLocked?: boolean
  sharedDrawLocked?: boolean
  stanceChangedThisTurn?: boolean
  onSelect: (card: CardInstance) => void
  onConfirm?: () => void
  onCancel?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLElement>(null)
  const selection = useRef<HTMLDivElement>(null)
  const hand = useRef<HTMLDivElement>(null)
  const previousSelection = useRef<readonly string[]>([])
  const suspendedClose = useRef(false)
  const descriptionId = useId()
  const [viewingBoard, setViewingBoard] = useState(false)
  const reducedMotion = useReducedEffects(false)
  const grid = cardSource !== 'hand' || renderCardAction !== undefined
  const selected = selectedUids.map(uid => cards.find(card => card.uid === uid))
    .filter(card => card !== undefined)
  const available = cards.filter(card => !selectedUids.includes(card.uid))
  const selectedKey = selected.map(card => card.uid).join('\0')
  const verb = action.toLowerCase()
  const count = minimum === maximum ? String(maximum)
    : minimum === 0 ? `up to ${maximum}`
    : minimum + 1 === maximum ? `${minimum} or ${maximum}` : `${minimum} to ${maximum}`
  const dismiss = () => {
    if (viewingBoard) setViewingBoard(false)
    else if (!disabled) onCancel?.()
  }
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    if (active && !element.open) {
      element.showModal()
      element.focus({ preventScroll: true })
    }
    else if (!active && element.open) {
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
  useHandLayout(hand, reducedMotion, disabled || viewingBoard, !grid && !children)
  useLayoutEffect(() => {
    const added = selected.find(card => !previousSelection.current.includes(card.uid))
    const removed = previousSelection.current.find(uid => !selected.some(card => card.uid === uid))
    const button = added
      ? selection.current?.querySelectorAll<HTMLButtonElement>('.card')[selected.indexOf(added)]
      : removed ? hand.current?.querySelectorAll<HTMLButtonElement>('.card')[available.findIndex(card => card.uid === removed)]
        : undefined
    previousSelection.current = selected.map(card => card.uid)
    button?.focus({ preventScroll: true })
    if (added) button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedKey])
  const renderCard = (card: CardInstance, picked: boolean, index?: number) => <Card
    key={card.uid} card={card} cost={cost} selected={picked}
    playable={!disabled && (picked || maximum > 0 && canSelect?.(card) !== false)} immediateArt fullArt={picked || !grid}
    hoverHelp inspectOnTouch={!picked && !grid} liveBlock={blockPreviews?.get(card.uid)}
    shortcutKey={index !== undefined && index < 9 ? String(index + 1) : undefined}
    drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} stanceChangedThisTurn={stanceChangedThisTurn}
    accessibleNote={picked ? `selected for ${verb}; activate to put back` : verb === 'choose' ? 'choose this card' : `choose for ${verb}`}
    onClick={() => onSelect(card)} />
  return <dialog ref={dialog} className="hand-discard" data-action={verb} data-layout={children ? 'custom' : grid ? 'grid' : 'hand'} tabIndex={-1}
    data-viewing-board={viewingBoard || undefined} aria-label={title ?? `${action} ${count} card${maximum === 1 ? '' : 's'}`}
    aria-describedby={descriptionId} onCancel={(event) => {
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
      <h2>{title ?? <>Choose {maximum === 1 && minimum === 1 ? 'a card' : `${count} card${maximum === 1 ? '' : 's'}`}{action === 'Choose'
        ? null : <> to <strong>{action}</strong></>}.</>}</h2>
      <p id={descriptionId} className={description ? undefined : 'visually-hidden'}>
        {description ?? `${source} · Choose cards from ${cardSource === 'hand' ? 'your hand' : cardSource === 'revealed' ? 'the revealed cards' : `your ${cardSource} pile`}${onConfirm ? ', then confirm' : ''}.`}
      </p>
    </header>
    {children ? <div className="hand-discard__custom" inert={disabled}>{children}</div> : <>
    {!selected.length && sourceCard ? <div className="hand-discard__source" aria-hidden="true">
      <Card card={sourceCard} liveBlock={blockPreviews?.get(sourceCard.uid)} playable={false} immediateArt fullArt tabIndex={-1} />
    </div> : null}
    <div ref={selection} className="hand-discard__selection" role="group" aria-label={`Selected ${verb}`}>
      {selected.map(card => renderCardAction ? <div key={card.uid} className="hand-discard__option">
        {renderCard(card, true)}<div inert={disabled}>{renderCardAction(card)}</div>
      </div> : renderCard(card, true))}
    </div>
    <div className="hand-discard__hand-scroll">
    <div ref={hand} className={`${grid ? '' : 'hand '}hand-discard__hand`} role="group" aria-label={`Cards available to ${verb}`}>
      {available.map((card, index) => renderCardAction ? <div key={card.uid} className="hand-discard__option">
        {renderCard(card, false, index)}<div inert={disabled}>{renderCardAction(card)}</div>
      </div> : renderCard(card, false, index))}
      {!cards.length && !disabled ? <p>No eligible cards.</p> : null}
    </div>
    </div>
    </>}
    <button type="button" className="hand-discard__view" aria-label={viewingBoard ? 'Return to card selection' : viewLabel}
      aria-pressed={viewingBoard} onClick={() => setViewingBoard(!viewingBoard)}>
      <svg viewBox="0 0 48 32" aria-hidden="true"><path d="M2 16C12-2 36-2 46 16 36 34 12 34 2 16Z" />
        <circle cx="24" cy="16" r="8" /></svg>
    </button>
    <footer className="hand-discard__footer" data-has-selection={selected.length > 0 || minimum === 0 ||
      !onConfirm && !confirmControls || undefined}>
      {onCancel ? <button type="button" disabled={disabled} onClick={onCancel}>{cancelLabel}</button> : <span />}
      <span aria-live="polite">{onConfirm || confirmControls ? `${selected.length}/${maximum} selected` : ''}</span>
      {confirmControls ? <div className="hand-discard__confirm-controls" inert={disabled}>{confirmControls}</div>
        : onConfirm ? <button type="button" disabled={disabled || confirmDisabled || selected.length < minimum || selected.length > maximum}
        onClick={onConfirm}>{confirmLabel ?? `Confirm ${verb}`}</button> : null}
    </footer>
  </dialog>
}
