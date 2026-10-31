import { useId, useLayoutEffect, useRef } from 'react'
import type { CardInstance } from '../../game/types.ts'
import { Card } from '../Card.tsx'
import '../styles/hand-discard-selection.css'

export function HandSelectionScreen({
  cards, selectedUids, minimum, maximum, source, action, disabled, active = true,
  drawLocked, sharedDrawLocked, stanceChangedThisTurn, onSelect, onConfirm, onCancel,
}: {
  cards: readonly CardInstance[]
  selectedUids: readonly string[]
  minimum: number
  maximum: number
  source: string
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
  const titleId = useId()
  const descriptionId = useId()
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
    if (active && !element.open) element.showModal()
    else if (!active && element.open) element.close()
  }, [active])
  useLayoutEffect(() => {
    const added = selected.find(card => !previousSelection.current.includes(card.uid))
    const removed = previousSelection.current.find(uid => !selected.some(card => card.uid === uid))
    const button = added
      ? selection.current?.querySelectorAll<HTMLButtonElement>('.card')[selected.indexOf(added)]
      : removed ? hand.current?.querySelectorAll<HTMLButtonElement>('.card')[available.findIndex(card => card.uid === removed)]
        : undefined
    previousSelection.current = selected.map(card => card.uid)
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedKey])
  return <dialog ref={dialog} className="hand-discard" data-action={verb} aria-labelledby={titleId}
    aria-describedby={descriptionId} onCancel={(event) => {
      event.preventDefault()
      if (!disabled) onCancel?.()
    }}>
    <header className="hand-discard__heading">
      <h2 id={titleId}>{action} {count} card{maximum === 1 ? '' : 's'}</h2>
      <p id={descriptionId}>{source} · Choose {maximum === 1 ? 'a card' : 'cards'} from your hand to {verb}.</p>
    </header>
    <div ref={selection} className="hand-discard__selection" role="group" aria-label={`Selected ${verb}`}>
      {selected.length ? selected.map(card => <Card key={card.uid} card={card} selected playable={!disabled} immediateArt
        drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} stanceChangedThisTurn={stanceChangedThisTurn}
        accessibleNote={`selected for ${verb}; activate to put back`} onClick={() => onSelect(card)} />)
        : <p>Select {maximum === 1 ? 'a card' : 'cards'} below</p>}
    </div>
    <div ref={hand} className="hand-discard__hand" role="group" aria-label={`Cards available to ${verb}`}>
      {available.map((card) =>
        <Card key={card.uid} card={card} playable={!disabled} immediateArt
          drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} stanceChangedThisTurn={stanceChangedThisTurn}
          accessibleNote={`choose for ${verb}`} onClick={() => onSelect(card)} />)}
    </div>
    <footer className="hand-discard__footer">
      {onCancel ? <button type="button" disabled={disabled} onClick={onCancel}>Cancel play</button> : <span />}
      <span aria-live="polite">{selected.length}/{maximum} selected</span>
      <button type="button" disabled={disabled || selected.length < minimum || selected.length > maximum}
        onClick={onConfirm}>Confirm {verb}</button>
    </footer>
  </dialog>
}
