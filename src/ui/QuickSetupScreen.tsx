import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cardIsCurse } from '../game/cards.ts'
import type { QuickStartStep } from '../game/meta.ts'
import { availableTransformRewards, canUpgradeCard } from '../game/run.ts'
import type { CardInstance, Player } from '../game/types.ts'
import type { ActionOutcome } from '../multiplayer/useRoomSession.ts'
import { Card } from './Card.tsx'
import { useActionLifecycle } from './actions/useActionLifecycle.ts'
import { RoomActionStatus } from './actions/RoomActionStatus.tsx'
import type { RoomActionContext } from './actions/useRoomAction.ts'
import { roomActionScope } from './actions/room-action.ts'
import { setupStepKey } from './actions/setup-choice.ts'

type QuickSetup = Readonly<{
  kind: 'quick-start' | 'catch-up'
  targetAct: 2 | 3 | 4
  playerIds: string[]
  rowIndex: number
  repeatIndex: number
  playerIndex: number
  die: null | Readonly<{ value: 1 | 2 | 3 | 4 | 5 | 6; effectIndex: number }>
}>

type Props = Readonly<{
  setup: QuickSetup
  players: readonly Player[]
  currentStep: QuickStartStep | null
  enabled?: boolean
  transformAvailable?: boolean
  disabledMessage?: string
  onAdvance: (cardUids?: string[]) => void | Promise<ActionOutcome>
  delivery?: RoomActionContext
}>

const STEP_LABELS: Record<QuickStartStep['kind'], string> = {
  neow: 'Neow Bonus',
  gold: 'Gold',
  cardReward: 'Card Reward',
  transform: 'Transform a card',
  rollDie: 'Roll the die',
  potion: 'Potion',
  relic: 'Relic',
  rareReward: 'Rare Card Reward',
  bossRelic: 'Boss Relic',
  cardRemove: 'Remove a card',
  upgrade: 'Upgrade a card',
  merchant: 'Merchant',
}

function selectableCards(player: Player | undefined, kind: QuickStartStep['kind'] | undefined): CardInstance[] {
  if (!player) return []
  if (kind === 'upgrade') return player.deck.filter(canUpgradeCard)
  if (kind === 'cardRemove') return player.deck.filter((card) => card.defId !== 'ascenders_bane')
  if (kind === 'transform') return player.deck.filter((card) => !cardIsCurse(card.defId))
  return []
}

export function QuickSetupScreen({ setup, players, currentStep, enabled = true, transformAvailable,
  disabledMessage, onAdvance, delivery }: Props) {
  const titleId = useId()
  const activePlayerId = setup.playerIds[setup.playerIndex]
  const activePlayer = players.find((player) => player.id === activePlayerId)
  const selectionKind = currentStep?.kind === 'transform' || currentStep?.kind === 'cardRemove' || currentStep?.kind === 'upgrade'
    ? currentStep.kind
    : undefined
  const eligible = useMemo(
    () => selectableCards(activePlayer, selectionKind),
    [activePlayer, selectionKind],
  )
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const submittedAutomaticStep = useRef('')
  const [retryRequired, setRetryRequired] = useState(false)
  const automaticStep = setupStepKey(setup)
  useEffect(() => { setSelectedUid(null); setRetryRequired(false) }, [automaticStep])
  const lifecycle = useActionLifecycle<string, typeof setup>({
    scope: delivery ? roomActionScope(delivery.snapshot) : `setup/${setup.kind}/${setup.targetAct}`,
    board: setup, refresh: delivery?.refresh, version: delivery?.snapshot.version,
    awaitCommit: Boolean(delivery),
    committed: (step, current) => setupStepKey(current) !== step,
    reconciled: (_step, committed) => { if (!committed) setRetryRequired(true) },
  })
  const advance = (cardUids?: string[]) => {
    if (!enabled || lifecycle.locked()) return
    setRetryRequired(false)
    lifecycle.submit(automaticStep, () => onAdvance(cardUids), true, outcome => {
      const next = outcome.snapshot?.run
      if (outcome.status !== 'accepted' && (!next ||
        next.phase === 'setup' && setupStepKey(next.setup) === automaticStep)) setRetryRequired(true)
    })
  }

  const selectionRequired = selectionKind !== undefined && eligible.length > 0 &&
    (selectionKind !== 'transform' || (transformAvailable ?? Boolean(activePlayer &&
      availableTransformRewards(activePlayer) > 0)))
  useEffect(() => {
    if (!enabled || lifecycle.locked() || retryRequired || !currentStep || selectionRequired ||
      submittedAutomaticStep.current === automaticStep) return
    submittedAutomaticStep.current = automaticStep
    advance()
  }, [automaticStep, currentStep, enabled, selectionRequired, lifecycle.busy, retryRequired])
  const stepLabel = currentStep ? STEP_LABELS[currentStep.kind] : 'Setup complete'
  const quantity = currentStep?.kind === 'gold' ? ` · ${currentStep.count} Gold`
    : currentStep && currentStep.count > 1 ? ` · ${setup.repeatIndex + 1} of ${currentStep.count}` : ''

  return <section className="quick-setup" aria-labelledby={titleId}>
    <header className="quick-setup__header">
      <p className="quick-setup__eyebrow">{setup.kind === 'catch-up' ? 'Catch Up' : 'Quick Start'} · Act {setup.targetAct}</p>
      <h2 id={titleId}>{stepLabel}{quantity}</h2>
      <p className="quick-setup__progress" role="status">
        Step {setup.rowIndex + 1}
        {activePlayer ? ` · ${activePlayer.name} · player ${setup.playerIndex + 1} of ${setup.playerIds.length}` : ''}
      </p>
    </header>

    {setup.die ? <p className="quick-setup__die" aria-live="polite">
      <strong>Die result: {setup.die.value}</strong>
      <span> · effect {setup.die.effectIndex + 1}</span>
    </p> : null}

    {selectionKind && enabled ? <fieldset className="quick-setup__selection" disabled={lifecycle.busy}>
      <legend>{STEP_LABELS[selectionKind]}{activePlayer ? ` for ${activePlayer.name}` : ''}</legend>
      {eligible.length > 0
        ? <div className="quick-setup__cards">
            {eligible.map((card) => <Card
              key={card.uid}
              card={card}
              playable={enabled && !lifecycle.busy}
              selected={selectedUid === card.uid}
              onClick={() => { if (!lifecycle.locked()) setSelectedUid((current) => current === card.uid ? null : card.uid) }}
            />)}
          </div>
        : <p className="quick-setup__empty" role="status">No eligible card. Continue to resolve this reward as a no-op.</p>}
    </fieldset> : null}

    {selectionRequired ? <button
      type="button"
      className="quick-setup__advance"
      disabled={!enabled || lifecycle.busy || selectedUid === null}
      onClick={() => advance(selectedUid ? [selectedUid] : [])}
    >
      Confirm
    </button> : enabled && retryRequired ? <button type="button" className="quick-setup__advance"
      disabled={lifecycle.busy} onClick={() => advance()}>Retry setup step</button>
      : enabled ? <p className="quick-setup__empty" role="status">Resolving automatically…</p> : null}
    {lifecycle.phase === 'unknown' || lifecycle.phase === 'accepted'
      ? delivery ? <RoomActionStatus uncertain={lifecycle.phase === 'unknown'} onResync={delivery.onResync} />
        : <p role="status">Delivery could not be confirmed. Reconnect before trying again.</p>
      : null}
    {!enabled && disabledMessage ? <p className="quick-setup__empty" role="status">{disabledMessage}</p> : null}
  </section>
}
