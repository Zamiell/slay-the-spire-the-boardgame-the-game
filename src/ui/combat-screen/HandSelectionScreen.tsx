import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CardInstance } from '../../game/types.ts'
import { Card } from '../Card.tsx'
import { useReducedEffects } from './hooks.ts'
import { useHandLayout } from './useHandLayout.ts'
import '../styles/hand-discard-selection.css'

export function HandSelectionScreen({
  cards, selectedUids, minimum, maximum, source, sourceCard, action, disabled, active = true,
  drawLocked, sharedDrawLocked, stanceChangedThisTurn, onSelect, onConfirm, onCancel,
}: {
  cards: readonly CardInstance[]
  selectedUids: readonly string[]
  minimum: number
  maximum: number
  source: string
  sourceCard?: CardInstance
  action: 'Discard' | 'Exhaust'
  disabled: boolean
  active?: boolean
  drawLocked?: boolean
  sharedDrawLocked?: boolean
  stanceChangedThisTurn?: boolean
  onSelect: (card: CardInstance) => void
  onConfirm: () => void
  onCancel?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const selection = useRef<HTMLDivElement>(null)
  const hand = useRef<HTMLDivElement>(null)
  const previousSelection = useRef<readonly string[]>([])
  const descriptionId = useId()
  const [viewingBoard, setViewingBoard] = useState(false)
  const reducedMotion = useReducedEffects(false)
  const selected = selectedUids.map(uid => cards.find(card => card.uid === uid))
    .filter(card => card !== undefined)
  const available = cards.filter(card => !selectedUids.includes(card.uid))
  const selectedKey = selected.map(card => card.uid).join('\0')
  const verb = action.toLowerCase()
  const count = minimum === maximum ? String(maximum)
    : minimum === 0 ? `up to ${maximum}`
    : minimum + 1 === maximum ? `${minimum} or ${maximum}` : `${minimum} to ${maximum}`
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    if (active && !element.open) {
      element.showModal()
      element.focus({ preventScroll: true })
    }
    else if (!active && element.open) element.close()
  }, [active])
  useLayoutEffect(() => {
    const root = dialog.current
    const header = root?.closest('.app-shell')?.querySelector('.app-shell__header')
    if (!root || !header) return
    const measure = () => root.style.setProperty('--selection-header-bottom', `${header.getBoundingClientRect().bottom}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    window.addEventListener('resize', measure)
    measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useHandLayout(hand, reducedMotion, disabled || viewingBoard)
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
  return <dialog ref={dialog} className="hand-discard" data-action={verb} tabIndex={-1}
    data-viewing-board={viewingBoard || undefined} aria-label={`${action} ${count} card${maximum === 1 ? '' : 's'}`}
    aria-describedby={descriptionId} onCancel={(event) => {
      event.preventDefault()
      if (viewingBoard) setViewingBoard(false)
      else if (!disabled) onCancel?.()
    }}>
    <header className="hand-discard__heading">
      <h2>Choose {maximum === 1 && minimum === 1 ? 'a card' : `${count} card${maximum === 1 ? '' : 's'}`} to <strong>{action}</strong>.</h2>
      <p id={descriptionId} className="visually-hidden">{source} · Choose cards from your hand, then confirm.</p>
    </header>
    {!selected.length && sourceCard ? <div className="hand-discard__source" aria-hidden="true">
      <Card card={sourceCard} playable={false} immediateArt fullArt tabIndex={-1} />
    </div> : null}
    <div ref={selection} className="hand-discard__selection" role="group" aria-label={`Selected ${verb}`}>
      {selected.map(card => <Card key={card.uid} card={card} selected playable={!disabled} immediateArt fullArt hoverHelp
        drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} stanceChangedThisTurn={stanceChangedThisTurn}
        accessibleNote={`selected for ${verb}; activate to put back`} onClick={() => onSelect(card)} />)}
    </div>
    <div className="hand-discard__hand-scroll">
    <div ref={hand} className="hand hand-discard__hand" role="group" aria-label={`Cards available to ${verb}`}>
      {available.map((card, index) =>
        <Card key={card.uid} card={card} playable={!disabled} immediateArt fullArt hoverHelp inspectOnTouch
          shortcutKey={index < 9 ? String(index + 1) : undefined}
          drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} stanceChangedThisTurn={stanceChangedThisTurn}
          accessibleNote={`choose for ${verb}`} onClick={() => onSelect(card)} />)}
    </div>
    </div>
    <button type="button" className="hand-discard__view" aria-label={viewingBoard ? 'Return to card selection' : 'View battlefield'}
      aria-pressed={viewingBoard} onClick={() => setViewingBoard(!viewingBoard)}>
      <svg viewBox="0 0 48 32" aria-hidden="true"><path d="M2 16C12-2 36-2 46 16 36 34 12 34 2 16Z" />
        <circle cx="24" cy="16" r="8" /></svg>
    </button>
    <footer className="hand-discard__footer" data-has-selection={selected.length > 0 || minimum === 0 || undefined}>
      {onCancel ? <button type="button" disabled={disabled} onClick={onCancel}>Cancel play</button> : <span />}
      <span aria-live="polite">{selected.length}/{maximum} selected</span>
      <button type="button" disabled={disabled || selected.length < minimum || selected.length > maximum}
        onClick={onConfirm}>Confirm {verb}</button>
    </footer>
  </dialog>
}
