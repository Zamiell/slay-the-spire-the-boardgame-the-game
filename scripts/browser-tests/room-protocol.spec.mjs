import { test, expect } from '../lib/browser-test.mjs'
import { createRoom, createStore, joinRoom, snapshotFor } from '../lib/rooms.mjs'

test.use({ appKey: import.meta.url })

test('invalid socket frames close with a browser-valid code and recover through a new connection', async ({ page, appURL }) => {
  const room = createRoom(createStore())
  const owner = joinRoom(room, { name: 'Owner', character: 'ironclad' })
  const initial = snapshotFor(room, owner.token)
  const recovered = { ...initial, version: initial.version + 1 }
  const sockets = []
  const closed = []
  await page.addInitScript(credentials => sessionStorage.setItem('sts-room-session', JSON.stringify(credentials)),
    { code: room.code, token: owner.token })
  await page.route('**/src/main.tsx', route => route.fulfill({ contentType: 'text/javascript', body: '' }))
  await page.route(`**/api/rooms/${room.code}`, route => route.fulfill({ json: { snapshot: initial } }))
  await page.routeWebSocket('**/ws*', socket => {
    sockets.push(socket)
    socket.onClose((code, reason) => {
      closed.push({ code, reason })
      socket.close({ code, reason })
    })
    socket.onMessage(message => {
      if (JSON.parse(String(message)).type === 'authenticate') socket.send(JSON.stringify({
        type: 'snapshot', snapshot: sockets.length === 1 ? initial : recovered,
      }))
    })
  })
  await page.goto(appURL)
  await page.evaluate(async () => {
    const ReactModule = await import('/@id/react')
    const ReactDOMModule = await import('/@id/react-dom/client')
    const React = ReactModule.default ?? ReactModule
    const ReactDOM = ReactDOMModule.default ?? ReactDOMModule
    const { useRoomSession } = await import('/src/multiplayer/useRoomSession.ts')
    function Session() {
      const room = useRoomSession()
      window.__PROTOCOL_ROOM__ = room
      return React.createElement('p', { role: 'status' }, room.error || room.connection)
    }
    ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(Session))
  })
  await expect.poll(() => page.evaluate(() => window.__PROTOCOL_ROOM__?.snapshot?.version)).toBe(initial.version)
  sockets[0].send(JSON.stringify({ type: 'snapshot', snapshot: { ...initial, version: 'invalid' } }))
  await expect.poll(() => closed).toContainEqual({ code: 4002, reason: 'Invalid room update' })
  await expect.poll(() => sockets.length).toBeGreaterThan(1)
  await expect.poll(() => page.evaluate(() => ({
    connection: window.__PROTOCOL_ROOM__?.connection, version: window.__PROTOCOL_ROOM__?.snapshot?.version,
  }))).toEqual({ connection: 'connected', version: recovered.version })
})
