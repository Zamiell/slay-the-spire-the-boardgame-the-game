import type { CombatView } from '../../game/combat/view.ts'
import { useEffect, useRef } from 'react'
import { activateRelic, livingEnemies, overflowShivCount } from '../../game/combat.ts'
import type { RelicContext } from '../../game/combat.ts'
import { relicDef } from '../../game/relics.ts'
import type { ActionOutcome } from '../../multiplayer/useRoomSession.ts'
import type { CombatScreenProps } from './types.ts'
import { relicSubmissionCommitted } from './action-evidence.ts'
import type { RelicSubmissionEvidence } from './action-evidence.ts'
import { reconcileRelicSelection, relicUsable, restoreRelicSelection, toggleRelicCard } from './relic-selection.ts'
import type { RelicSelection } from './relic-selection.ts'
import { useActionLifecycle } from '../actions/useActionLifecycle.ts'
import { useScopedSelection } from './useScopedSelection.ts'
import { gainedShivs } from './card-play-requirements.ts'
import { combatActor, localCombat } from '../../game/combat/view.ts'

type Submission = RelicSubmissionEvidence & { selection: RelicSelection; context: RelicContext }
type Options = Pick<CombatScreenProps, 'state' | 'viewerId' | 'onAction' | 'onChange' |
  'authoritativeRefresh' | 'partyStartTurnPostRollLocked'> & {
  reconciliation: (outcome: ActionOutcome) => { combat: CombatView } | null
}

export function useRelicController(options: Options) {
  const { state, viewerId, onAction, onChange, partyStartTurnPostRollLocked = false } = options
  const viewer = combatActor(state, viewerId)
  const latest = useRef(options)
  latest.current = options
  const scope = `${state.combatId}:${viewerId}`
  const [selection, setSelection] = useScopedSelection<RelicSelection>(scope, { kind: 'idle' })
  function restore(submitted: Submission, combat: CombatView) {
    setSelection(restoreRelicSelection(submitted.selection, submitted.context, combat, viewerId,
      relicUsable(latest.current.state, viewerId, submitted.relicIndex, latest.current.partyStartTurnPostRollLocked)))
  }
  const lifecycle = useActionLifecycle<Submission, CombatView>({
    scope, board: state, refresh: options.authoritativeRefresh,
    committed: (submitted, combat) => relicSubmissionCommitted(submitted, combat, viewerId),
    reconciled: (submitted, committed, combat) => {
      if (committed) setSelection(reconcileRelicSelection({ kind: 'idle' }, combat, viewerId))
      else restore(submitted, combat)
    },
  })
  useEffect(() => {
    setSelection((current) => reconcileRelicSelection(current, state, viewerId,
      current.kind === 'idle' || relicUsable(state, viewerId, current.relicIndex, partyStartTurnPostRollLocked)))
  }, [scope, state, partyStartTurnPostRollLocked])

  const canUse = (index: number) => relicUsable(state, viewerId, index, partyStartTurnPostRollLocked)
  function activate(relicIndex: number, context: RelicContext = {}) {
    if (!viewer || lifecycle.locked() || !canUse(relicIndex)) return
    const held = viewer.relics[relicIndex]!
    const enemies = livingEnemies(state)
    if (enemies.length === 1 && held.defId.replace(/^downfall_/, '') === 'ninja_scroll' && !context.shivEnemyUids) {
      const amount = gainedShivs(relicDef(held.defId).effects) || 2
      context = { ...context, shivEnemyUids: Array<string>(overflowShivCount(state, amount)).fill(enemies[0]!.uid) }
    }
    const result = onAction ? undefined : activateRelic(localCombat(state), viewer.id, relicIndex, context)
    if (result === state) return
    const submitted: Submission = {
      relicIndex, defId: held.defId, spentBefore: held.spent === true, cubesBefore: held.cubes,
      scryId: state.pendingRelicScry?.id, selection, context,
    }
    if (!onAction) setSelection({ kind: 'idle' })
    lifecycle.submit(submitted, () => onAction ? onAction({
      kind: 'activateRelic', relicIndex, relicScryId: submitted.scryId, ...context,
    }) : onChange?.(result!), Boolean(onAction), (outcome) => {
      if (outcome.status === 'accepted') {
        setSelection(reconcileRelicSelection({ kind: 'idle' }, latest.current.state, viewerId))
      } else if (outcome.status === 'refused' || outcome.status === 'reconciled') {
        const combat = outcome.snapshot ? latest.current.reconciliation(outcome)?.combat : latest.current.state
        if (!combat) { setSelection({ kind: 'idle' }); return }
        if (relicSubmissionCommitted(submitted, combat, viewerId)) {
          setSelection(reconcileRelicSelection({ kind: 'idle' }, combat, viewerId))
        } else restore(submitted, combat)
      }
    })
  }
  return {
    usingRelic: lifecycle.busy, canUse, activate,
    relicCardChoiceIndex: selection.kind === 'cards' ? selection.relicIndex : null,
    relicCardUids: selection.kind === 'cards' || selection.kind === 'scry' ? selection.picked : [],
    targetsFor: (relicIndex: number) => selection.kind === 'overflow' && selection.relicIndex === relicIndex ? selection.targets : [],
    stageCards: (relicIndex: number) => {
      if (!viewer || lifecycle.locked() || !canUse(relicIndex)) return
      setSelection({ kind: 'cards', relicIndex, defId: viewer.relics[relicIndex]!.defId, picked: [] })
    },
    toggleCard: (uid: string, maximum: number) => {
      if (lifecycle.locked()) return
      const pool = selection.kind === 'scry' && state.pendingRelicScry?.playerId === viewerId
        ? state.pendingRelicScry.cards : selection.kind === 'cards' ? viewer?.hand : undefined
      if (pool?.some((card) => card.uid === uid)) setSelection((current) => toggleRelicCard(current, uid, maximum))
    },
    chooseTarget: (relicIndex: number, enemyUid: string) => {
      if (!viewer || lifecycle.locked() || !canUse(relicIndex) ||
        !state.enemies.some((enemy) => enemy.uid === enemyUid && !enemy.dead)) return
      const held = viewer.relics[relicIndex]!
      const amount = gainedShivs(relicDef(held.defId).effects) || 2
      const required = overflowShivCount(state, amount)
      setSelection((current) => {
        const targets = current.kind === 'overflow' && current.relicIndex === relicIndex &&
          current.required === required ? current.targets : []
        return { kind: 'overflow', relicIndex, defId: held.defId, required,
          targets: targets.length < required ? [...targets, enemyUid] : targets }
      })
    },
    cancel: () => { if (!lifecycle.locked()) setSelection({ kind: 'idle' }) },
  }
}
