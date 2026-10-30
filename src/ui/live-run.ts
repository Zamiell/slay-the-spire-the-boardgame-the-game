import { captureAssistantGame } from './useWebMcp.ts'

type SharingStatus = { state: 'off' | 'connecting' | 'connected' | 'error'; message: string }
let status: SharingStatus = { state: 'off', message: 'Not sharing.' }
const listeners = new Set<() => void>()
let disconnect: (() => void) | undefined

export const liveRunStatus = () => status
export function subscribeLiveRun(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notify(next: SharingStatus) {
  status = next
  for (const listener of listeners) listener()
}

export function stopSharingRun() {
  disconnect?.()
  disconnect = undefined
  notify({ state: 'off', message: 'Not sharing.' })
}

export function shareRun(pairingCode: string) {
  stopSharingRun()
  const match = /^([1-9]\d{0,4}):([A-Za-z0-9_-]{43})$/.exec(pairingCode.trim())
  if (!match || Number(match[1]) > 65535) {
    notify({ state: 'error', message: 'Paste the pairing code printed by the local live-run companion.' })
    return
  }
  const port = match[1]
  let token = match[2]!
  const tabId = crypto.randomUUID()
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
        notify({ state: 'connected', message: 'Sharing this tab, read-only. Closing or reloading it stops sharing.' })
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
  socket.onclose = () => fail('Sharing disconnected. Check the pairing code and that no other tab is paired, then reconnect.')
}

if (import.meta.hot) import.meta.hot.dispose(stopSharingRun)
