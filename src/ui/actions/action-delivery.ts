import { completedActionOutcome } from './action-lifecycle.ts'
import type { DeliveryOutcome } from './action-lifecycle.ts'

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
