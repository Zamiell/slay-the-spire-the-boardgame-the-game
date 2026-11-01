import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cardDef, faceOf } from '../game/cards.ts'
import type { CardInstance } from '../game/types.ts'
import { Card } from './Card.tsx'
import { CardInspectionDialog } from './CardInspectionDialog.tsx'
import { Tooltip } from './Tooltip.tsx'
import { useButtonShortcut } from './useButtonShortcut.ts'

type CardCollectionOverlayProps = {
  cards: readonly CardInstance[]
  label: string
  triggerClassName: string
  children: ReactNode
  dataPile?: 'draw' | 'discard' | 'exhaust'
  ordered?: boolean
  shortcut?: string
  drawLocked?: boolean
  sharedDrawLocked?: boolean
  stanceChangedThisTurn?: boolean
  inspectable?: boolean
}

/** One read-only card viewer for the deck and combat piles. */
export function CardCollectionOverlay({
  cards, label, triggerClassName, children, dataPile, ordered = true, shortcut, drawLocked, sharedDrawLocked, stanceChangedThisTurn, inspectable = false,
}: CardCollectionOverlayProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useButtonShortcut(trigger, shortcut, !open)
  return <>
    <Tooltip name={shortcut ? `${label} (${shortcut.toUpperCase()})` : label}>{help =>
    <button {...help} type="button" ref={element => { trigger.current = element; help.ref?.(element) }}
      className={triggerClassName} data-pile={dataPile}
      aria-label={`${label}, ${cards.length} card${cards.length === 1 ? '' : 's'}`}
      aria-keyshortcuts={shortcut?.toUpperCase()}
      onClick={() => setOpen(true)}>{children}</button>}</Tooltip>
    <CardCollectionDialog cards={cards} label={label} open={open} ordered={ordered} shortcut={shortcut}
      inspectable={inspectable}
      stanceChangedThisTurn={stanceChangedThisTurn}
      drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} onClose={() => setOpen(false)} />
  </>
}

export function CardCollectionDialog({ cards, label, onClose, open = true, ordered = true, shortcut, drawLocked, sharedDrawLocked, stanceChangedThisTurn, inspectable = false }: {
  cards: readonly CardInstance[]; label: string; onClose: () => void; open?: boolean; ordered?: boolean; shortcut?: string
  drawLocked?: boolean; sharedDrawLocked?: boolean
  stanceChangedThisTurn?: boolean
  inspectable?: boolean
}) {
  const [sort, setSort] = useState<'obtained' | 'type' | 'cost' | 'name'>(() => ordered ? 'obtained' : 'name')
  const [ascending, setAscending] = useState(true)
  const [viewUpgrades, setViewUpgrades] = useState(false)
  const [inspectedUid, setInspectedUid] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const suppressedCloses = useRef(0)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useButtonShortcut(closeButton, shortcut, open)
  const titleId = useId()
  const sortOptions = ordered
    ? ([['obtained', 'Obtained'], ['type', 'Card Type'], ['cost', 'Cost'], ['name', 'A - Z']] as const)
    : ([['type', 'Card Type'], ['cost', 'Cost'], ['name', 'A - Z']] as const)
  const sortedCards = useMemo(() => cards.map((card, index) => ({ card, index })).sort((left, right) => {
    const leftDef = faceOf(cardDef(left.card.defId), left.card.upgraded || viewUpgrades && Boolean(cardDef(left.card.defId).upgrade))
    const rightDef = faceOf(cardDef(right.card.defId), right.card.upgraded || viewUpgrades && Boolean(cardDef(right.card.defId).upgrade))
    const byName = leftDef.name.localeCompare(rightDef.name)
    const byType = leftDef.type.localeCompare(rightDef.type) || byName
    const leftCost = typeof leftDef.cost === 'number' ? leftDef.cost : Number.POSITIVE_INFINITY
    const rightCost = typeof rightDef.cost === 'number' ? rightDef.cost : Number.POSITIVE_INFINITY
    const compared = sort === 'obtained' ? left.index - right.index
      : sort === 'type' ? byType
        : sort === 'cost' ? leftCost - rightCost || byName
          : byName
    const tieBreak = ordered
      ? left.index - right.index
      : left.card.defId.localeCompare(right.card.defId) || left.card.uid.localeCompare(right.card.uid)
    return (compared || tieBreak) * (ascending ? 1 : -1)
  }).map(({ card }) => card),
  [ascending, cards, sort, viewUpgrades])
  const chooseSort = (next: typeof sort) => {
    if (next === sort) setAscending((current) => !current)
    else { setSort(next); setAscending(true) }
  }

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open) {
      if (!element.open) element.showModal()
    } else if (element.open) {
      // The queued close event must not dismiss a deck reopened by the next keypress.
      suppressedCloses.current += 1
      element.close()
    }
  }, [open])

  useEffect(() => { if (!open) setInspectedUid(null) }, [open])

  useEffect(() => {
    if (!open || !inspectable) return
    const grid = dialog.current?.querySelector('.choice-modal__cards')
    if (!grid) return
    let frame = 0
    const followCard = () => {
      document.dispatchEvent(new Event('card-keyword-help-reposition'))
      frame = grid.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')
        ? requestAnimationFrame(followCard) : 0
    }
    const start = (event: Event) => {
      if (event instanceof TransitionEvent && event.propertyName === 'transform' &&
        event.target instanceof Element && event.target.classList.contains('card') && !frame) {
        frame = requestAnimationFrame(followCard)
      }
    }
    grid.addEventListener('transitionrun', start)
    return () => {
      cancelAnimationFrame(frame)
      grid.removeEventListener('transitionrun', start)
    }
  }, [open, inspectable])

  return <dialog ref={dialog} className={`choice-modal card-collection${inspectable ? ' card-collection--deck' : ''}`} aria-labelledby={titleId}
      onClose={(event) => {
        if (event.target !== event.currentTarget) return
        if (suppressedCloses.current > 0) suppressedCloses.current -= 1
        else onClose()
      }}>
      <div className="choice-modal__panel">
        <header className="card-collection__header"><h2 id={titleId}>{label}</h2>
          <span>{cards.length} card{cards.length === 1 ? '' : 's'}</span></header>
        <div className={`card-collection__sort${ordered ? '' : ' card-collection__sort--unordered'}`}
          role="group" aria-label="Sort cards">
          {sortOptions.map(([key, text]) =>
            <button type="button" key={key} aria-pressed={sort === key} onClick={() => chooseSort(key)}>
              {text} <span aria-hidden="true">{sort === key ? ascending ? '↑' : '↓' : '↕'}</span>
            </button>)}
        </div>
        <div className="choice-modal__cards">
          {open ? sortedCards.map((card) => <Card key={card.uid}
            card={viewUpgrades && cardDef(card.defId).upgrade ? { ...card, upgraded: true } : card}
            playable={inspectable} hoverHelp onClick={inspectable ? () => setInspectedUid(card.uid) : undefined}
            onInspect={() => setInspectedUid(card.uid)}
            stanceChangedThisTurn={stanceChangedThisTurn}
            drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} />) : null}
          {open && cards.length === 0 ? <span className="muted">No cards.</span> : null}
        </div>
        <footer className="card-collection__footer">
          <button type="button" ref={closeButton}
            className="ribbon-back" aria-label="Back"
            aria-keyshortcuts={shortcut?.toUpperCase()} onClick={onClose}><span aria-hidden="true" /></button>
          <label><input type="checkbox" aria-label={`${label} upgrade preview`} checked={viewUpgrades}
          onChange={(event) => setViewUpgrades(event.target.checked)} /> View Upgrades</label>
        </footer>
      </div>
      {open && inspectedUid !== null ? <CardInspectionDialog cards={sortedCards} initialCardUid={inspectedUid}
        viewAllUpgraded={viewUpgrades} onClose={() => setInspectedUid(null)}
        drawLocked={drawLocked} sharedDrawLocked={sharedDrawLocked} stanceChangedThisTurn={stanceChangedThisTurn} /> : null}
    </dialog>
}
