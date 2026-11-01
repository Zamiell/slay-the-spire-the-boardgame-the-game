import type { ActionOutcome, RoomSnapshot } from '../../protocol/room.ts'
import type { NoncombatAction } from '../../protocol/decisions.ts'
export type { NoncombatAction } from '../../protocol/decisions.ts'

export type RoomActionSubmission = { actions: readonly NoncombatAction[]; before: RoomSnapshot }

export function roomActionScope(snapshot: RoomSnapshot) {
  const run = snapshot.run
  return JSON.stringify([snapshot.code, snapshot.epoch, snapshot.you.playerId,
    run?.campaign.runId, run?.act, run?.map.position, run?.phase])
}

/** Stop on refusal or uncertain delivery; never replay a partially completed batch. */
export async function sendRoomActions(
  actions: readonly NoncombatAction[],
  send: (action: NoncombatAction) => Promise<ActionOutcome>,
  isCurrent: () => boolean,
): Promise<ActionOutcome> {
  let outcome: ActionOutcome = { status: 'accepted' }
  for (const action of actions) {
    if (!isCurrent()) return { status: 'unknown' }
    outcome = await send(action)
    if (outcome.status !== 'accepted') break
  }
  return outcome
}

export function roomActionCommitted({ actions, before }: RoomActionSubmission, current: RoomSnapshot) {
  const playerId = before.you.playerId
  const offer = current.run?.rewards.find(candidate => candidate.playerId === playerId)
  const previous = before.run?.rewards.find(candidate => candidate.playerId === playerId)
  return actions.every(action => {
    if (action.kind === 'campfire') return current.campfireDecided.includes(playerId) ||
      current.run?.phase !== 'room' || current.run.map.position !== before.run?.map.position
    if (current.run?.phase !== 'reward' || !offer) return true
    switch (action.kind) {
      case 'cardReward': return !offer.cardReward || action.choice === 'reveal' && Array.isArray(offer.choices)
      case 'goldReward': return !offer.gold
      case 'relicReward': return !offer.relic
      case 'bossRelicReward': return !offer.bossRelics
      case 'transformReward': return !offer.transformReward
      case 'potionReward': return !offer.potion || offer.potion !== previous?.potion ||
        (offer.potionQueue?.length ?? 0) < (previous?.potionQueue?.length ?? 0)
    }
  })
}
