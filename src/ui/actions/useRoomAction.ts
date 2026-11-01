import type { ActionOutcome, RoomSnapshot } from '../../protocol/room.ts'
import { useActionLifecycle } from './useActionLifecycle.ts'
import { roomActionCommitted, roomActionScope, sendRoomActions } from './room-action.ts'
import type { NoncombatAction, RoomActionSubmission } from './room-action.ts'

export type RoomActionContext = {
  snapshot: RoomSnapshot
  refresh: number
  onResync: () => Promise<boolean>
}

export function useRoomAction({ snapshot, refresh, onAction, onRestore }: {
  snapshot: RoomSnapshot
  refresh: number
  onAction: (action: object) => Promise<ActionOutcome>
  onRestore?: (actions: readonly NoncombatAction[]) => void
}) {
  const lifecycle = useActionLifecycle<RoomActionSubmission, RoomSnapshot>({
    scope: roomActionScope(snapshot), board: snapshot, version: snapshot.version, refresh, awaitCommit: true,
    committed: roomActionCommitted,
    reconciled: (submission, committed) => {
      if (!committed) onRestore?.(submission.actions)
    },
  })
  return {
    ...lifecycle,
    submit(actions: readonly NoncombatAction[]) {
      if (actions.length === 0) return false
      return lifecycle.submit({ actions, before: snapshot },
        isCurrent => sendRoomActions(actions, onAction, isCurrent), true, outcome => {
          if (!outcome.snapshot || !roomActionCommitted({ actions, before: snapshot }, outcome.snapshot)) {
            onRestore?.(actions)
          }
        })
    },
  }
}
