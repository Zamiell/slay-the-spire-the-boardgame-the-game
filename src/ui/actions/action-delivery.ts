import { completedActionOutcome } from './action-lifecycle.ts'
import type { DeliveryOutcome } from './action-lifecycle.ts'
import type { ActionOutcome } from '../../protocol/room.ts'

/** Preserve synchronous local updates; never continue an uncertain online sequence. */
export function sequenceActions(
  steps: readonly (() => void | Promise<ActionOutcome>)[],
  isCurrent: () => boolean,
): void | Promise<ActionOutcome> {
  for (let index = 0; index < steps.length; index++) {
    if (!isCurrent()) return Promise.resolve({ status: 'unknown' })
    const result = steps[index]!()
    if (result) return result.then(outcome => {
      if (outcome.status !== 'accepted') return outcome
      return sequenceActions(steps.slice(index + 1), isCurrent) ?? outcome
    })
  }
}

/** Preserve synchronous exceptions for the caller while fencing uncertain delivery. */
export function deliverAction<Outcome extends DeliveryOutcome>(
  send: () => void | Promise<Outcome | void>,
  received: (outcome: Outcome | { status: 'accepted' }) => void,
  failed: () => void,
): Promise<void> {
  let result
  try {
    result = send()
  } catch (error) {
    failed()
    throw error
  }
  return Promise.resolve(result).then((outcome) => received(completedActionOutcome(outcome)), failed)
}
