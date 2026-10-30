import { captureAssistantGame } from './useWebMcp.ts'

type SharingStatus = { state: 'off' | 'connecting' | 'connected' | 'error'; message: string; remembered?: boolean }
type Pairing = { code: string; tabId: string }
const STORAGE_KEY = 'sts-live-run-pairing'
const CODE_PATTERN = /^([1-9]\d{0,4}):([A-Za-z0-9_-]{43})$/
let status: SharingStatus = { state: 'off', message: 'Not sharing.' }
const listeners = new Set<() => void>()
let disconnect: (() => void) | undefined
let remembered: Pairing | undefined

export const liveRunStatus = () => status
export function subscribeLiveRun(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notify(next: SharingStatus) {
  status = { ...next, remembered: Boolean(remembered) }
  for (const listener of listeners) listener()
}

export function stopSharingRun() {
  disconnect?.()
  disconnect = undefined
  try { sessionStorage.removeItem(STORAGE_KEY) }
  catch {
    notify({ state: 'error', message: 'Sharing stopped, but the browser could not clear its saved pairing. Clear session storage for this tab before refreshing.' })
    return false
  }
  remembered = undefined
  notify({ state: 'off', message: 'Not sharing.' })
  return true
}

export function shareRun(pairingCode: string) {
  if (!stopSharingRun()) return
  connect({ code: pairingCode.trim(), tabId: crypto.randomUUID() })
}

function connect(pairing: Pairing, retries = 0) {
  const match = CODE_PATTERN.exec(pairing.code)
  if (!match || Number(match[1]) > 65535) {
    notify({ state: 'error', message: 'Paste the pairing code printed by the local live-run companion.' })
    return
  }
  const port = match[1]
  let token = match[2]!
  const tabId = pairing.tabId
  notify({ state: 'connecting', message: 'Connecting to the local companion...' })
  let socket: WebSocket
  try { socket = new WebSocket(`ws://127.0.0.1:${port}/feed`) }
  catch {
    notify({ state: 'error', message: 'This browser blocked the local connection. Use a local game tab on the same computer.' })
    return
  }
  let timer: number | undefined
  let previous = ''
  let stopped = false
  const timeout = window.setTimeout(() => fail('Pairing timed out. Check the companion and its allowed game origin.'), 6_000)
  const cleanup = () => {
    stopped = true
    token = ''
    window.clearTimeout(timeout)
    window.clearInterval(timer)
    socket.close()
  }
  disconnect = cleanup
  const fail = (message: string) => {
    if (stopped) return
    cleanup()
    disconnect = undefined
    notify({ state: 'error', message })
  }
  const publish = (requestId?: string) => {
    try {
      const state = captureAssistantGame()
      const signature = JSON.stringify(state)
      if (requestId || signature !== previous) {
        socket.send(JSON.stringify({ type: 'snapshot', requestId, state }))
        previous = signature
      }
    } catch {
      fail('Could not inspect this screen. Sharing stopped; reconnect to try again.')
    }
  }
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'pair', token, tabId }))
    token = ''
  }
  socket.onmessage = (event) => {
    if (stopped) return
    try {
      const message = JSON.parse(String(event.data))
      if (message.type === 'paired' && !timer) {
        window.clearTimeout(timeout)
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pairing)) }
        catch {
          fail('The browser could not save the pairing for this tab. Sharing stopped; allow session storage and try again.')
          return
        }
        remembered = pairing
        notify({ state: 'connected', message: 'Sharing this tab, read-only. Refreshes reconnect automatically. Use Stop sharing to revoke access.' })
        publish()
        if (!stopped) timer = window.setInterval(() => publish(), 1_000)
      } else if (message.type === 'inspect' && typeof message.requestId === 'string' && timer) {
        publish(message.requestId)
      } else {
        fail('The companion sent an unexpected message. Sharing stopped.')
      }
    } catch {
      fail('The companion sent an invalid message. Sharing stopped.')
    }
  }
  socket.onerror = () => fail('Cannot connect. Check that the companion is running and allows this game origin.')
  socket.onclose = (event) => {
    // The previous document's socket can still be closing during a fast refresh.
    if (!stopped && !timer && event.code === 1008 && retries > 0) {
      cleanup()
      const retry = window.setTimeout(() => connect(pairing, retries - 1), 250)
      disconnect = () => window.clearTimeout(retry)
      return
    }
    fail('Sharing disconnected. Check the pairing code and that no other tab is paired, then reconnect.')
  }
}

function restoreSharing() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (!stored) return
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    // New tabs can inherit a copy of their opener's sessionStorage; that is not consent.
    if (navigation?.type !== 'reload' && !import.meta.hot?.data.resumeSharing) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    const pairing: unknown = JSON.parse(stored)
    if (!pairing || typeof pairing !== 'object' || !('code' in pairing) || typeof pairing.code !== 'string' ||
      !CODE_PATTERN.test(pairing.code) || !('tabId' in pairing) || typeof pairing.tabId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(pairing.tabId)) {
      throw new Error('Invalid saved pairing')
    }
    remembered = { code: pairing.code, tabId: pairing.tabId }
    connect(remembered, 4)
  } catch {
    notify({ state: 'error', message: 'Could not restore the saved pairing for this tab. Enter a pairing code to share again.' })
  }
}

const suspendSharing = () => { disconnect?.(); disconnect = undefined }
const resumePage = (event: PageTransitionEvent) => { if (event.persisted && remembered) connect(remembered, 4) }
window.addEventListener('pagehide', suspendSharing)
window.addEventListener('pageshow', resumePage)
restoreSharing()

if (import.meta.hot) import.meta.hot.dispose((data) => {
  data.resumeSharing = true
  suspendSharing()
  window.removeEventListener('pagehide', suspendSharing)
  window.removeEventListener('pageshow', resumePage)
})
