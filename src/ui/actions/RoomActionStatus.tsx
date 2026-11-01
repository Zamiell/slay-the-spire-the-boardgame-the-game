import { useState } from 'react'
import './room-action-status.css'

export function RoomActionStatus({ uncertain, onResync }: {
  uncertain: boolean
  onResync: () => Promise<boolean>
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setError('')
    try {
      if (!await onResync()) setError('Could not refresh the room. Your action remains locked.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh the room.')
    } finally {
      setRefreshing(false)
    }
  }
  return <div className="room-action-status" role="status">
    <p>{uncertain ? 'Delivery could not be confirmed. Check the room before trying again.' : 'Waiting for the confirmed room state…'}</p>
    <button type="button" disabled={refreshing} onClick={() => void refresh()}>
      {refreshing ? 'Checking…' : 'Check room state'}
    </button>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
