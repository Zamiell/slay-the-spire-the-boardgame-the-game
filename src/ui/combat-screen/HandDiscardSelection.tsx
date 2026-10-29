import { useLayoutEffect, useRef } from 'react'
import type { CardInstance } from '../../game/types.ts'
import { Card } from '../Card.tsx'
import '../styles/hand-discard-selection.css'

/** Hand selection is distinct from playing the cards offered as discard candidates. */
export function HandDiscardSelection({ cards, selectedUid, disabled, onSelect, onConfirm, onCancel }: {
  cards: readonly CardInstance[]
  selectedUid?: string
  disabled: boolean
  onSelect: (card: CardInstance) => void
  onConfirm: () => void
  onCancel?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const selection = useRef<HTMLDivElement>(null)
  const selected = cards.find((card) => card.uid === selectedUid)
  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [])
  useLayoutEffect(() => {
    if (selected) selection.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [selected?.uid])
  return <dialog ref={dialog} className="hand-discard" aria-labelledby="hand-discard-title"
    aria-describedby="hand-discard-description" onCancel={(event) => {
      event.preventDefault()
      if (!disabled) onCancel?.()
    }}>
    <header className="hand-discard__heading">
      <h2 id="hand-discard-title">Discard 1 card</h2>
      <p id="hand-discard-description">Survivor · Choose a card from your hand to discard.</p>
    </header>
    <div ref={selection} className="hand-discard__selection" role="group" aria-label="Selected discard">
      {selected ? <Card card={selected} selected playable={!disabled} immediateArt
        accessibleNote="selected for discard; activate to put back" onClick={() => onSelect(selected)} />
        : <p>Select a card below</p>}
    </div>
    <div className="hand-discard__hand" role="group" aria-label="Cards available to discard">
      {cards.filter((card) => card.uid !== selected?.uid).map((card) =>
        <Card key={card.uid} card={card} playable={!disabled} immediateArt
          accessibleNote="choose for discard" onClick={() => onSelect(card)} />)}
    </div>
    <footer className="hand-discard__footer">
      {onCancel ? <button type="button" disabled={disabled} onClick={onCancel}>Cancel play</button> : <span />}
      <span aria-live="polite">{selected ? 1 : 0}/{Math.min(1, cards.length)} selected</span>
      <button type="button" disabled={disabled || cards.length > 0 && !selected}
        onClick={onConfirm}>Confirm discard</button>
    </footer>
  </dialog>
}
