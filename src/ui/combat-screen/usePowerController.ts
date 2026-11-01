import type { CombatView } from '../../game/combat/view.ts'
import { useEffect, useMemo, useRef } from 'react'
import { activatePower, activePowerWindow, cardNeedsEnemy, livingEnemies, powerAbilityUsed, previewPowerChoice } from '../../game/combat.ts'
import type { PowerContext } from '../../game/combat.ts'
import { cardDef, faceOf } from '../../game/cards.ts'
import type { CardInstance, Enemy } from '../../game/types.ts'
import type { ActionOutcome } from '../../multiplayer/useRoomSession.ts'
import type { CombatScreenProps, PowerSubmission } from './types.ts'
import { powerSubmissionCommitted } from './action-evidence.ts'
import {
  powerActivationChoice, powerRequirements, powerSelectionValues, reconcilePowerSelection,
  restorePowerSelection, transitionPowerSelection,
} from './power-selection.ts'
import type { PowerSelection, PowerSelectionEvent } from './power-selection.ts'
import { useActionLifecycle } from '../actions/useActionLifecycle.ts'
import { useScopedSelection } from './useScopedSelection.ts'
import { combatActor, localCombat } from '../../game/combat/view.ts'

type Options = Pick<CombatScreenProps, 'state' | 'viewerId' | 'onAction' | 'onChange' |
  'powerPreview' | 'authoritativeVersion' | 'authoritativeRefresh'> & {
  reconciliation: (outcome: ActionOutcome) => { combat: CombatView } | null
  triggerId?: number
  endTurnResolving: boolean
}

export function usePowerController(options: Options) {
  const { state, viewerId, onAction, onChange, powerPreview } = options
  const viewer = combatActor(state, viewerId)
  const latest = useRef(options)
  latest.current = options
  const scope = `${state.combatId}:${viewerId}`
  const [selection, setSelection] = useScopedSelection<PowerSelection>(scope, { kind: 'idle' })
  const values = powerSelectionValues(selection)
  const requirements = powerRequirements(state, viewerId, values.pendingPowerUid)
  function dispatch(event: PowerSelectionEvent) {
    setSelection((current) => transitionPowerSelection(current, event))
  }
  function previewFrom(outcome: ActionOutcome) {
    return outcome.snapshot && outcome.snapshot.version > (latest.current.authoritativeVersion ?? -1)
      ? outcome.snapshot.powerPreview : latest.current.powerPreview
  }
  const lifecycle = useActionLifecycle<PowerSubmission, CombatView>({
    scope, board: state, refresh: options.authoritativeRefresh,
    committed: (power, combat) => powerSubmissionCommitted(power, combat, viewerId),
    reconciled: (power, committed, combat) => {
      if (!committed) setSelection(restorePowerSelection(power, combat, viewerId, latest.current.powerPreview, true))
    },
  })
  const previewBoard = useMemo(() => ({ state, powerPreview }), [state, powerPreview])
  // Revealing hidden cards is also irreversible: do not retry an uncertain preview.
  const previewLifecycle = useActionLifecycle<{ powerUid: string }, typeof previewBoard>({
    scope, board: previewBoard, refresh: options.authoritativeRefresh,
    committed: (power, board) => board.powerPreview?.powerUid === power.powerUid,
    reconciled: () => {},
  })
  const locked = () => lifecycle.locked() || previewLifecycle.locked()
  function cancel() { dispatch({ type: 'cancel' }) }

  useEffect(() => {
    cancel()
  }, [scope, state.phase, state.pendingCardCopy?.playerId, options.triggerId])
  useEffect(() => {
    if (options.endTurnResolving) cancel()
  }, [options.endTurnResolving])
  useEffect(() => {
    setSelection((current) => reconcilePowerSelection(current, state, viewerId))
  }, [state, viewerId])
  useEffect(() => {
    if (powerPreview && viewer?.powers.some((power) => power.uid === powerPreview.powerUid) &&
      activePowerWindow(state) && !state.startTurnProgress?.forcedCard &&
      !powerAbilityUsed(state, viewerId, powerPreview.powerUid)) {
      dispatch({ type: 'preview', powerUid: powerPreview.powerUid, cards: powerPreview.cards })
    } else if (onAction) dispatch({ type: 'clearPreview' })
  }, [scope, powerPreview?.id, powerPreview?.powerUid, powerPreview?.cards.map((card) => card.uid).join('\0'), onAction])

  function submit(powerUid: string, context: PowerContext) {
    if (!viewer || locked()) return
    const power = viewer.powers.find((power) => power.uid === powerUid)
    const def = power && faceOf(cardDef(power.defId), power.upgraded)
    const enemies = livingEnemies(state)
    const onlyEnemy = enemies.length === 1 ? enemies[0] : undefined
    if (onlyEnemy && def && context.enemyUid === undefined && context.enemyRow === undefined) {
      if (def.target === 'row') context = { ...context, enemyRow: onlyEnemy.row }
      else if (cardNeedsEnemy(def, viewer, true, undefined, true, power?.attachedGemId)) {
        context = { ...context, enemyUid: onlyEnemy.uid }
      }
    }
    const result = onAction ? undefined : activatePower(localCombat(state), viewer.id, powerUid, context)
    if (result === state) return
    const submitted = { powerUid, powerPreviewId: powerPreview?.id, context }
    cancel()
    lifecycle.submit(submitted, () => onAction ? onAction({
      kind: 'activatePower', powerUid, powerPreviewId: submitted.powerPreviewId, ...context, preflight: true,
    }) : onChange?.(result!), Boolean(onAction), (outcome) => {
      if (outcome.status !== 'refused' && outcome.status !== 'reconciled') return
      const authoritative = latest.current.reconciliation(outcome)
      if (!authoritative) return
      setSelection(restorePowerSelection(submitted, authoritative.combat, viewerId, previewFrom(outcome),
        requirements.pendingPowerNeedsGemChoice))
    })
  }

  function chooseContext(context: PowerContext) {
    if (!values.pendingPowerUid || locked()) return
    if (requirements.pendingPowerDef?.id !== 'guardian_gem_finder' || !requirements.pendingPower?.attachedGemId) {
      submit(values.pendingPowerUid, context)
    } else if (!requirements.pendingPowerNeedsGemChoice || values.powerScryConfirmed) {
      submit(values.pendingPowerUid, { ...context, scryDiscardUids: values.powerScryDiscardUids })
    } else dispatch({ type: 'gemContext', context })
  }
  function confirmScry() {
    if (!values.pendingPowerUid || locked()) return
    const scry = { scryDiscardUids: values.powerScryDiscardUids }
    const { pendingPower, pendingPowerNeedsGemChoice, pendingPowerNeedsEnemy, pendingPowerNeedsAlly } = requirements
    if (!pendingPower?.attachedGemId || !pendingPowerNeedsGemChoice) submit(values.pendingPowerUid, scry)
    else if (values.powerGemContext) submit(values.pendingPowerUid, { ...values.powerGemContext, ...scry })
    else if (livingEnemies(state).length === 1 && pendingPowerNeedsEnemy && !pendingPowerNeedsAlly &&
      pendingPower.attachedGemId !== 'guardian_jasper' && pendingPower.attachedGemId !== 'guardian_amethyst') {
      submit(values.pendingPowerUid, scry)
    } else dispatch({ type: 'confirmScry', confirmed: true })
  }
  function requestPreview(powerUid: string) {
    if (!viewer || locked()) return
    if (!onAction) {
      const preview = previewPowerChoice(localCombat(state), viewer.id, powerUid)
      if (preview) dispatch({ type: 'preview', powerUid, cards: preview.cards })
      return
    }
    previewLifecycle.submit({ powerUid }, () => onAction({ kind: 'previewPowerChoice', powerUid }), true, (outcome) => {
      const preview = previewFrom(outcome)
      const combat = latest.current.reconciliation(outcome)?.combat
      if (!preview || preview.powerUid !== powerUid || !combat) return
      setSelection(restorePowerSelection({ powerUid, powerPreviewId: preview.id, context: {} },
        combat, viewerId, preview, false))
    })
  }
  return {
    ...values, ...requirements, usingPower: lifecycle.busy || previewLifecycle.busy,
    submit, chooseContext, confirmScry,
    cancel: () => { if (!locked()) cancel() },
    canChoose: (powerUid: string) => powerActivationChoice(state, viewerId, powerUid) !== 'blocked',
    open: (powerUid: string) => {
      if (locked()) return
      const choice = powerActivationChoice(state, viewerId, powerUid)
      if (choice === 'blocked') return
      cancel()
      if (values.pendingPowerUid === powerUid) return
      if (choice === 'preview') requestPreview(powerUid)
      else if (choice === 'submit') submit(powerUid, {})
      else dispatch({ type: 'select', powerUid })
    },
    toggleScry: (uid: string) => { if (!locked()) dispatch({ type: 'toggleScry', uid }) },
    chooseChamber: (uid: string) => { if (!locked()) dispatch({ type: 'chamber', uids: [uid] }) },
    chooseExhaust: (uids: string[]) => {
      if (locked()) return
      dispatch({ type: 'exhaust', uids })
      chooseContext({ exhaustUids: uids })
    },
    chooseLoad: (card: CardInstance) => {
      if (locked() || !values.pendingPowerUid) return
      const context = { chamberUids: values.powerChamberUids, loadUids: [card.uid] }
      if (['hermit_grudge', 'hermit_malice', 'hermit_horror'].includes(card.defId)) {
        const enemies = livingEnemies(state)
        if (enemies.length === 1) submit(values.pendingPowerUid, { ...context, hermitEnemyUids: [enemies[0]!.uid] })
        else dispatch({ type: 'load', uids: [card.uid] })
      } else submit(values.pendingPowerUid, context)
    },
    chooseEnemy: (enemy: Enemy) => {
      if (locked() || !values.pendingPowerUid || !requirements.pendingPowerDef) return
      const { pendingPowerDef: def, pendingPower: power } = requirements
      if (def.target === 'row') submit(values.pendingPowerUid, { enemyRow: enemy.row })
      else if (def.id === 'hermit_black_wind' && values.powerLoadUids.length === 1) {
        submit(values.pendingPowerUid, { chamberUids: values.powerChamberUids, loadUids: values.powerLoadUids,
          hermitEnemyUids: [enemy.uid] })
      } else if (def.id !== 'hermit_black_wind' && def.id !== 'hermit_shadow_cloak' &&
        !['guardian_jasper', 'guardian_onyx', 'guardian_amethyst'].includes(power?.attachedGemId ?? '')) {
        chooseContext({ enemyUid: enemy.uid })
      }
    },
    chooseOrb: (slot: number) => {
      if (!requirements.creativeAiEffect || !values.pendingPowerUid || !viewer?.orbs[slot] || locked()) return
      if (!requirements.creativeAiEffect.anyNumber) submit(values.pendingPowerUid, { orbSlots: [slot] })
      else dispatch({ type: 'toggleOrb', slot, maximum: viewer.discard.length })
    },
  }
}
