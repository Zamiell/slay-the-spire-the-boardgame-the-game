import { useState, useSyncExternalStore } from 'react'
import { liveRunStatus, shareRun, stopSharingRun, subscribeLiveRun } from './live-run.ts'
import './assistant-settings.css'

export function AssistantSettings() {
  const status = useSyncExternalStore(subscribeLiveRun, liveRunStatus)
  const [code, setCode] = useState('')
  const sharing = status.state === 'connecting' || status.state === 'connected'
  return <section className="assistant-settings" data-webmcp-passive aria-label="Live run sharing">
    <h3>Share run with assistant</h3>
    <p>Let your local assistant read this tab's visible game information when you ask for advice.
      It cannot play cards or change your run. Hidden cards and saved account credentials are not shared.</p>
    <p>Start <code>node scripts/live-run.mjs serve</code> on this computer and paste its pairing code.
      The companion must allow this game's origin: <code>{location.origin}</code>.</p>
    {!sharing ? <form onSubmit={(event) => { event.preventDefault(); shareRun(code); setCode('') }}>
      <label>Pairing code
        <input type="password" autoComplete="off" spellCheck={false} value={code}
          onChange={(event) => setCode(event.target.value)} />
      </label>
      <button type="submit" className="settings-dialog__key" disabled={!code.trim()}>Share this tab</button>
    </form> : <button type="button" className="settings-dialog__key" onClick={stopSharingRun}>Stop sharing</button>}
    <p role={status.state === 'error' ? 'alert' : 'status'}
      className={status.state === 'error' ? 'settings-dialog__error' : undefined}>{status.message}</p>
  </section>
}
