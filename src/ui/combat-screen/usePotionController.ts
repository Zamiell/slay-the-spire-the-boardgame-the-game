import { useEffect, useRef } from 'react'
import {
  activatePotion, canActivatePotion, isPostRollStartTurnPotionChoice, livingEnemies, overflowShivCount,
} from '../../game/combat.ts'
import type { CombatState, PotionContext } from '../../game/combat.ts'
import { potionDef } from '../../game/relics.ts'
import type { ActionOutcome, VisibleCombat, VisiblePlayer } from '../../multiplayer/useRoomSession.ts'
import type { Player } from '../../game/types.ts'
import { gainedShivs } from './helpers.ts'
import { transitionPotionSelection } from './potion-selection.ts'
import type { PotionSelection, PotionSelectionEvent } from './potion-selection.ts'
import { useActionLifecycle } from './useActionLifecycle.ts'
import { useScopedSelection } from './useScopedSelection.ts'
import { potionSubmissionCommitted } from './action-evidence.ts'
import type { CombatScreenProps } from './types.ts'

type PotionSubmission = { potionId: string; countBefore: number }
type Options = Pick<CombatScreenProps, 'state' | 'viewerId' | 'onAction' | 'onChange' |
  'authoritativeRefresh' | 'partyStartTurnPostRollLocked'> & {
  clearOtherActions: () => void
  reconciliation: (outcome: ActionOutcome) => {
    combat: CombatState | VisibleCombat
    player: Player | VisiblePlayer
  } | null
}

export function potionNeedsSelection(state: CombatState | VisibleCombat, viewer: Player | VisiblePlayer, potionId: string) {
  const potion = potionDef(potionId)
  const onlyEnemy = state.enemies.filter((enemy) => !enemy.dead).length === 1
  const capacity = state.potionLimit + (viewer.relics.some((relic) => relic.defId === 'potion_belt') ? 2 : 0)
  return ['gamblers_brew', 'liquid_memories', 'liquid_void', 'transforming_brew', 'purity_potion', 'destiny_draught'].includes(potionId) ||
    potionId === 'mystery_potion' && state.die <= 2 && !onlyEnemy ||
    potionId === 'entropic_brew' && !viewer.relics.some((relic) => relic.defId === 'sozu') &&
      viewer.potions.length - 1 + 2 > capacity || Boolean(potion.target) && !onlyEnemy ||
    potion.supportTarget === 'anyPlayer' && state.players.filter((player) => !player.dead).length > 1 ||
    overflowShivCount(state, gainedShivs(potion.effects)) > 0
}

export function usePotionController(options: Options) {
  const { state, viewerId, onAction, onChange, partyStartTurnPostRollLocked } = options
  const viewer = state.players.find((player) => player.id === viewerId)
  const scope = `${state.combatId}:${viewerId}`
  const [selection, setSelection] = useScopedSelection<PotionSelection>(scope, { kind: 'idle' })
  function dispatch(event: PotionSelectionEvent) {
    setSelection((current) => transitionPotionSelection(current, event))
  }
  const lifecycle = useActionLifecycle<PotionSubmission, CombatState>({
    scope,
    board: state,
    refresh: options.authoritativeRefresh,
    committed: (potion, board) => potionSubmissionCommitted(potion, board, viewerId),
    // Unknown potion delivery unlocks without replaying or reopening a drink.
    reconciled: () => {},
  })
  const pendingPotion = selection.kind === 'idle' ? null : selection.potionId
  const canUse = (potionId: string) => Boolean(viewer &&
    canActivatePotion(state, viewer, potionId) && !(partyStartTurnPostRollLocked &&
      isPostRollStartTurnPotionChoice(state, viewer, potionId)))
  const previousDie = useRef(state.die)
  useEffect(() => {
    const dieChanged = previousDie.current !== state.die
    previousDie.current = state.die
    if (!pendingPotion) return
    dispatch({
      type: 'refresh',
      usable: canUse(pendingPotion) && Boolean(viewer?.potions.includes(pendingPotion)) &&
        !(pendingPotion === 'mystery_potion' && dieChanged && state.die > 2) &&
        !(pendingPotion === 'entropic_brew' && viewer?.relics.some((relic) => relic.defId === 'sozu')),
      overflow: overflowShivCount(state, gainedShivs(potionDef(pendingPotion).effects)),
      alive: new Set(state.enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.uid)),
      cards: new Set(viewer?.hand.map((card) => card.uid)),
    })
  }, [state, viewer, pendingPotion, partyStartTurnPostRollLocked])

  function cancel() { dispatch({ type: 'cancel' }) }
  function stage(potionId: string) {
    if (lifecycle.locked() || !canUse(potionId)) return
    dispatch({ type: 'stage', potionId, overflow: overflowShivCount(state, gainedShivs(potionDef(potionId).effects)) })
  }
  function consume(potionId: string, context: PotionContext = {}, overflow?: { expected: number; skip: boolean }) {
    if (!viewer || lifecycle.locked() || !canUse(potionId)) return
    const potion = potionDef(potionId)
    const enemies = livingEnemies(state)
    const onlyEnemy = enemies.length === 1 ? enemies[0] : undefined
    if (onlyEnemy && context.enemyUid === undefined && context.enemyRow === undefined) {
      if (potion.target === 'enemy' || potionId === 'mystery_potion' && state.die <= 2) {
        context = { ...context, enemyUid: onlyEnemy.uid }
      } else if (potion.target === 'row') context = { ...context, enemyRow: onlyEnemy.row }
    }
    const result = activatePotion(state, viewer.id, potionId, context)
    if (result === state) {
      if (context.shivEnemyUids?.length) dispatch({ type: 'targets', targets: [] })
      return
    }
    const countBefore = viewer.potions.filter((held) => held === potionId).length
    options.clearOtherActions()
    cancel()
    lifecycle.submit({ potionId, countBefore }, () => onAction ? onAction({
      kind: 'usePotion', potionId, ...context, preflight: true,
      expectedShivOverflow: overflow?.expected, skipOverflow: overflow?.skip,
    }) : onChange?.(result), Boolean(onAction), (outcome) => {
      if (outcome.status !== 'refused' && outcome.status !== 'reconciled') return
      const authoritative = options.reconciliation(outcome)
      if (!authoritative) return
      const count = authoritative.player.potions.filter((held) => held === potionId).length
      const needsTarget = Boolean(potion.target) || potionId === 'mystery_potion' && authoritative.combat.die <= 2
      if (count === 0 || outcome.status === 'reconciled' && count < countBefore ||
        !needsTarget && !potionNeedsSelection(authoritative.combat, authoritative.player, potionId)) return
      dispatch({ type: 'stage', potionId,
        overflow: overflowShivCount(authoritative.combat, gainedShivs(potion.effects)) })
    })
  }
  return {
    pendingPotion,
    usingPotion: lifecycle.busy,
    potionCardUids: selection.kind === 'cards' ? selection.picked : [],
    potionShivEnemyUids: selection.kind === 'overflow' ? selection.targets : [],
    potionOverflowRequired: selection.kind === 'overflow' ? selection.required : 0,
    canUse, stage, cancel, consume,
    needsSelection: (potionId: string) => Boolean(viewer && potionNeedsSelection(state, viewer, potionId)),
    setTargets: (targets: string[]) => dispatch({ type: 'targets', targets }),
    toggleCard: (uid: string) => dispatch({ type: 'toggleCard', uid }),
  }
}
