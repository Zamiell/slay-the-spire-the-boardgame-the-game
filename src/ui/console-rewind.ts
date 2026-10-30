import type { RunState } from '../game/run.ts'
import { applyRunLogEvent, type RunLog } from './run-log.ts'

/** Find the opening on the current timeline, not a discarded future after an earlier rewind. */
export function previousTurnStart(run: RunState, log: RunLog | null | undefined): RunState | undefined {
  const combat = run.combat
  if (run.phase !== 'combat' || !combat || combat.turn < 2 || !log || log.runId !== run.campaign.runId) return undefined
  const target = combat.turn - 1
  let opening: RunState | undefined
  let previousTurn: number | undefined
  const inspect = (state: RunState) => {
    if (state.phase !== 'combat' || !state.combat || state.campaign.runId !== run.campaign.runId ||
      state.seed !== run.seed || state.act !== run.act ||
      state.map.position !== run.map.position || state.combat.combatId !== combat.combatId) {
      opening = undefined
      previousTurn = undefined
      return
    }
    const turn = state.combat.turn
    if (turn < target) opening = undefined
    // A restore into the middle of a turn must not replace its original opening.
    if (turn === target && (previousTurn === undefined || previousTurn < target)) opening = state
    previousTurn = turn
  }
  let state = log.initial
  inspect(state)
  for (const event of log.events) {
    state = applyRunLogEvent(state, event)
    inspect(state)
  }
  return opening ? structuredClone(opening) : undefined
}
