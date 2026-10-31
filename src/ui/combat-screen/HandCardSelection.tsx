import { useLayoutEffect, useRef, useState } from 'react'
import type { CardInstance } from '../../game/types.ts'
import type { CardBlockPreview } from '../../game/combat.ts'
import { Card } from '../Card.tsx'
import { HandSelectionScreen } from './HandSelectionScreen.tsx'

export function HandCardSelection({
  cards, minimum, maximum, source, sourceCard, blockPreviews, initialSelected = [], disabled, active = true,
  action = 'Exhaust', drawLocked, sharedDrawLocked, stanceChangedThisTurn, onConfirm, onCancel,
}: {
  cards: readonly CardInstance[]
  minimum: number
  maximum: number
  source: string
  sourceCard?: CardInstance
  blockPreviews?: ReadonlyMap<string, CardBlockPreview>
  initialSelected?: readonly string[]
  disabled: boolean
  active?: boolean
  action?: 'Exhaust' | 'Discard' | 'Put on bottom'
  drawLocked?: boolean
  sharedDrawLocked?: boolean
  stanceChangedThisTurn?: boolean
  onConfirm: (uids: string[]) => void
  onCancel?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [picked, setPicked] = useState(initialSelected)
  const selected = picked.filter(uid => cards.some(card => card.uid === uid)).slice(0, maximum)
  const toggle = (card: CardInstance) => setPicked(selected.includes(card.uid)
    ? selected.filter(uid => uid !== card.uid)
    : [...selected, card.uid].slice(-maximum))
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    if (active && !element.open) element.showModal()
    else if (!active && element.open) element.close()
  }, [active])
  if (action === 'Exhaust') return <HandSelectionScreen
    cards={cards} selectedUids={selected} minimum={minimum} maximum={maximum} source={source} sourceCard={sourceCard} action={action}
    blockPreviews={blockPreviews}
    disabled={disabled} active={active} drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked}
    stanceChangedThisTurn={stanceChangedThisTurn} onSelect={toggle}
    onConfirm={() => onConfirm(selected)} onCancel={onCancel} />
  const count = minimum === maximum ? maximum === 1 ? 'a card' : `${maximum} cards`
    : minimum === 0 ? `up to ${maximum} card${maximum === 1 ? '' : 's'}`
    : minimum + 1 === maximum ? `${minimum} or ${maximum} cards`
    : `${minimum} to ${maximum} cards`
  return <dialog ref={dialog} className="choice-modal choice-modal--hand-exhaust"
    aria-labelledby="hand-exhaust-title" aria-describedby="hand-exhaust-description"
    onCancel={event => {
      event.preventDefault()
      if (!disabled) onCancel?.()
    }}>
    <div className="choice-modal__panel">
      <h2 id="hand-exhaust-title">Choose {count} in your hand to {
        action === 'Put on bottom' ? 'put on the bottom of your draw pile' : action}</h2>
      <p id="hand-exhaust-description" aria-live="polite">
        {source} — {selected.length}/{maximum} selected.
        {' '}Only the selected cards will be {action === 'Discard' ? 'discarded' : 'put on the bottom of your draw pile'}.
      </p>
      <div className="choice-modal__cards">
        {cards.map(card => <Card key={card.uid} card={card}
          liveBlock={blockPreviews?.get(card.uid)}
          selected={selected.includes(card.uid)} playable={!disabled}
          drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked}
          stanceChangedThisTurn={stanceChangedThisTurn}
          onClick={() => toggle(card)} />)}
      </div>
      <div className="hand-exhaust__actions">
        <button type="button" disabled={disabled || selected.length < minimum || selected.length > maximum}
          onClick={() => onConfirm(selected)}>
          {action === 'Put on bottom'
            ? selected.length === 0 ? 'Put none back' : `Put ${selected.length} on the bottom`
            : selected.length === 0 && minimum === 0 ? `${action} none`
            : `${action} ${selected.length || 'selected'} card${selected.length === 1 ? '' : 's'}`}
        </button>
        {onCancel ? <button type="button" disabled={disabled} onClick={onCancel}>Cancel</button> : null}
      </div>
    </div>
  </dialog>
}
