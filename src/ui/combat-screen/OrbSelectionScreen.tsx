import { useLayoutEffect, useRef, useState } from 'react'
import type { CardInstance, Player } from '../../game/types.ts'
import type { CardBlockPreview } from '../../game/combat.ts'
import type { EvokeChoice } from '../../game/combat/types.ts'
import { Card, CardKeywordHelp } from '../Card.tsx'
import { orbDisplayText, orbDisplayValue } from '../TokenRow.tsx'
import { useButtonShortcut } from '../useButtonShortcut.ts'
import { SelectionScreen } from './SelectionScreen.tsx'
import '../styles/orb-selection.css'

type OrbOption = EvokeChoice['options'][number]

function OrbSelectionOption({ option, player, selected, disabled, onSelect }: {
  option: OrbOption
  player: Player
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const shortcut = !selected && option.slot < 9 ? String(option.slot + 1) : undefined
  useButtonShortcut(button, shortcut, !disabled)
  const name = `${option.orb.charAt(0).toUpperCase()}${option.orb.slice(1)} Orb`
  const text = orbDisplayText(player, option.orb)
  return <CardKeywordHelp hover extraTips={[{ name, text }]}>
    {help => <button {...help} ref={element => { button.current = element; help.ref?.(element) }}
      type="button" className="orb-selection__option" data-orb-slot={option.slot}
      disabled={disabled} aria-pressed={selected} aria-label={`Evoke ${option.orb} Orb ${option.slot + 1}`}
      aria-description={`${text}${selected ? ' Selected; activate to put back.' : ''}`}
      aria-keyshortcuts={shortcut} onClick={onSelect} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.click()
        }
      }}>
      <span className={`token token--orb token--orb-${option.orb}`} aria-hidden="true">
        <span className="orb__value">{orbDisplayValue(player, option.orb, true)}</span>
      </span>
      <span aria-hidden="true">{name}</span>
      <span className="orb-selection__slot" aria-hidden="true">Slot {option.slot + 1}</span>
    </button>}
  </CardKeywordHelp>
}

export function OrbSelectionScreen({ sourceCard, sourceBlock, player, options, disabled, active, onConfirm, onCancel }: {
  sourceCard: CardInstance
  sourceBlock?: CardBlockPreview
  player: Player
  options: readonly OrbOption[]
  disabled: boolean
  active: boolean
  onConfirm: (slot: number) => void
  onCancel?: () => void
}) {
  const [picked, setPicked] = useState<OrbOption | null>(null)
  const [viewingBoard, setViewingBoard] = useState(false)
  const selection = useRef<HTMLDivElement>(null)
  const available = useRef<HTMLDivElement>(null)
  const previousSlot = useRef<number | undefined>(undefined)
  const selected = options.find(option => option.slot === picked?.slot && option.orb === picked.orb)
  useLayoutEffect(() => {
    const button = selected ? selection.current?.querySelector<HTMLButtonElement>('button')
      : available.current?.querySelector<HTMLButtonElement>(`button[data-orb-slot="${previousSlot.current}"]`)
    previousSlot.current = selected?.slot
    if (picked && !selected) setPicked(null)
    button?.focus({ preventScroll: true })
  }, [selected?.slot, selected?.orb])
  const renderOrb = (option: OrbOption, chosen: boolean) => <OrbSelectionOption key={option.slot}
    option={option} player={player} selected={chosen} disabled={disabled}
    onSelect={() => setPicked(chosen ? null : option)} />
  return <SelectionScreen action="Evoke" layout="orbs" label="Choose an Orb to Evoke"
    title={<>Choose an Orb to <strong>Evoke</strong>.</>}
    description="Select a channeled Orb, then confirm. Activate a selected Orb to put it back."
    source={!selected ? <Card card={sourceCard} liveBlock={sourceBlock} playable={false} immediateArt fullArt tabIndex={-1} /> : undefined}
    selectedCount={selected ? 1 : 0} minimum={1} maximum={1} disabled={disabled} active={active}
    onConfirm={() => { if (selected) onConfirm(selected.slot) }} onCancel={onCancel}
    viewingBoard={viewingBoard} onViewingBoardChange={setViewingBoard} returnLabel="Return to Orb selection">
    <div ref={selection} className="hand-discard__selection" role="group" aria-label="Selected Orb">
      {selected ? renderOrb(selected, true) : null}
    </div>
    <div ref={available} className="orb-selection__choices" role="group" aria-label="Orbs available to Evoke">
      {options.filter(option => option.slot !== selected?.slot).map(option => renderOrb(option, false))}
    </div>
  </SelectionScreen>
}
