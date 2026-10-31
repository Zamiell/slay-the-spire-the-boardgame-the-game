import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CardInstance } from '../../game/types.ts'
import type { CardBlockPreview } from '../../game/combat.ts'
import { Card } from '../Card.tsx'
import { useReducedEffects } from './hooks.ts'
import { useHandLayout } from './useHandLayout.ts'
import { SelectionScreen } from './SelectionScreen.tsx'

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
  const selection = useRef<HTMLDivElement>(null)
  const hand = useRef<HTMLDivElement>(null)
  const previousSelection = useRef<readonly string[]>([])
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
  return <SelectionScreen action={action} layout={children ? 'custom' : grid ? 'grid' : 'hand'}
    label={title ?? `${action} ${count} card${maximum === 1 ? '' : 's'}`}
    title={title ?? <>Choose {maximum === 1 && minimum === 1 ? 'a card' : `${count} card${maximum === 1 ? '' : 's'}`}{action === 'Choose'
      ? null : <> to <strong>{action}</strong></>}.</>}
    description={description ?? `${source} · Choose cards from ${cardSource === 'hand' ? 'your hand' : cardSource === 'revealed'
      ? 'the revealed cards' : `your ${cardSource} pile`}${onConfirm ? ', then confirm' : ''}.`}
    showDescription={Boolean(description)} selectedCount={selected.length} minimum={minimum} maximum={maximum}
    disabled={disabled} active={active} onConfirm={onConfirm} confirmLabel={confirmLabel}
    confirmDisabled={confirmDisabled} confirmControls={confirmControls} onCancel={onCancel} cancelLabel={cancelLabel}
    viewingBoard={viewingBoard} onViewingBoardChange={setViewingBoard} viewLabel={viewLabel}
    source={!children && !selected.length && sourceCard
      ? <Card card={sourceCard} liveBlock={blockPreviews?.get(sourceCard.uid)} playable={false} immediateArt fullArt tabIndex={-1} />
      : undefined}>
    {children ? <div className="hand-discard__custom" inert={disabled}>{children}</div> : <>
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
  </SelectionScreen>
}
