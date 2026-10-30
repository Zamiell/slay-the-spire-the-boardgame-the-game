import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WebSocket } from 'ws'
import { startLiveRunServer } from './lib/live-run-server.mjs'

const origin = 'http://localhost:5180'
const bridge = await startLiveRunServer({ port: 0, requestTimeout: 150 })
const url = `http://127.0.0.1:${bridge.port}/current`
const sockets = []
const state = {
  run: { id: 'campaign-1', phase: 'combat', mode: 'local' }, pending: false,
  screen: { headings: ['Ironclad'], text: 'Health 7 of 9', observations: [], announcements: [] },
  choices: [{ label: 'Strike', available: true, count: 2 }],
}
async function open(token = bridge.token, tabId = '00000000-0000-4000-8000-000000000001') {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/feed`, { origin })
  sockets.push(socket)
  await once(socket, 'open')
  const response = Promise.race([
    once(socket, 'message').then(([raw]) => JSON.parse(raw.toString())),
    once(socket, 'close').then(([code]) => ({ closed: code })),
  ])
  socket.send(JSON.stringify({ type: 'pair', token, tabId }))
  return { socket, response: await response }
}
try {
  assert.equal((await fetch(url)).status, 401, 'state is not public')
  const headers = { Authorization: `Bearer ${bridge.token}` }
  assert.equal((await fetch(url, { headers: { ...headers, Origin: origin } })).status, 403, 'browser HTTP reads are forbidden')
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 404, 'no mutation endpoint')
  const absent = await fetch(url, { headers })
  assert.equal(absent.status, 503)
  assert.equal((await absent.json()).code, 'not_paired')

  const hostile = new WebSocket(`ws://127.0.0.1:${bridge.port}/feed`, { origin: 'https://unrelated.invalid' })
  await once(hostile, 'error')
  const denied = await open('incorrect')
  assert.equal(denied.response.closed, 1008, 'a code is required even on an allowed origin')

  const { socket, response } = await open()
  assert.equal(response.type, 'paired')
  const duplicate = await open(bridge.token, '00000000-0000-4000-8000-000000000002')
  assert.equal(duplicate.response.closed, 1008, 'another tab cannot silently replace the paired tab')
  let answer = true
  let latest = state
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (answer && message.type === 'inspect') socket.send(JSON.stringify({ type: 'snapshot', requestId: message.requestId, state: latest }))
  })
  const first = await bridge.current()
  assert.equal(first.fresh, true)
  assert.equal(first.origin, origin)
  assert.deepEqual(first.state, state)
  assert.equal(first.revision, 1)
  const stable = await bridge.current()
  assert.equal(stable.revision, first.revision, 'fresh reads need not invent state changes')
  latest = { ...state, pending: true, screen: { ...state.screen, text: 'Enemy turn' } }
  const changed = await (await fetch(url, { headers })).json()
  assert.equal(changed.state.pending, true)
  assert.equal(changed.revision, 2)
  assert.equal(changed.recentObservations.length, 2)
  answer = false
  const unavailable = await fetch(url, { headers })
  const stale = await unavailable.json()
  assert.equal(unavailable.status, 503)
  assert.equal(stale.code, 'tab_unresponsive')
  assert.equal(stale.state, undefined, 'never return cached state as current')
  assert(stale.lastSeenAt)
  answer = true
  latest = { ...state, run: { ...state.run, id: 'campaign-2' } }
  const nextRun = await bridge.current()
  assert.equal(nextRun.recentObservations.length, 1, 'history does not mix runs')
  answer = false
  const pending = assert.rejects(bridge.current(), /disconnected/)
  const closed = once(socket, 'close')
  socket.close()
  await closed
  await pending
  await assert.rejects(bridge.current(), /No game tab/)
} finally {
  for (const socket of sockets) socket.terminate()
  await bridge.close()
}

const child = spawn(process.execPath, [new URL('./live-run.mjs', import.meta.url).pathname, 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
let output = '', errors = ''
child.stdout.on('data', (data) => { output += data })
child.stderr.on('data', (data) => { errors += data })
child.stdin.end([
  '{broken',
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_current_run', arguments: { action: 'end_turn' } } }),
].join('\n') + '\n')
assert.equal((await once(child, 'close'))[0], 0, errors)
const replies = output.trim().split('\n').map((line) => JSON.parse(line))
assert.equal(replies[0].error.code, -32700)
assert.equal(replies[1].result.protocolVersion, '2024-11-05')
assert.deepEqual(replies[2].result.tools.map((tool) => tool.name), ['get_current_run'])
assert.equal(replies[2].result.tools[0].annotations.readOnlyHint, true)
assert.equal(replies[3].result.isError, true)
assert.match(replies[3].result.content[0].text, /no arguments/)
console.log('Live-run pairing, fresh reads, disconnects, tab isolation, and read-only MCP passed.')

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'tmp'), { recursive: true })
const checkout = await mkdtemp(resolve(root, 'tmp/live-run-cli-'))
let companion
try {
  await mkdir(resolve(checkout, 'scripts', 'lib'), { recursive: true })
  for (const file of ['live-run.mjs', 'lib/live-run-server.mjs']) {
    await copyFile(resolve(import.meta.dirname, file), resolve(checkout, 'scripts', file))
  }
  const script = resolve(checkout, 'scripts/live-run.mjs')
  companion = spawn(process.execPath, [script, 'serve', `--port=${bridge.port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  companion.stderr.on('data', (data) => { diagnostics += data })
  let ready = ''
  const deadline = AbortSignal.timeout(5_000)
  while (!ready.includes('Settings > Assistant pairing code:')) {
    ready += (await once(companion.stdout, 'data', { signal: deadline }))[0]
  }
  const credentialsPath = resolve(checkout, 'tmp/live-run/connection.json')
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
  assert.equal((await stat(credentialsPath)).mode & 0o777, 0o600)
  assert.equal((await stat(resolve(credentialsPath, '..'))).mode & 0o777, 0o700)
  const { socket, response } = await open(credentials.token)
  assert.equal(response.type, 'paired')
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'inspect') socket.send(JSON.stringify({ type: 'snapshot', requestId: message.requestId, state }))
  })
  const run = async (command, input = '') => {
    const client = spawn(process.execPath, [script, command], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    client.stdout.on('data', (data) => { stdout += data })
    client.stderr.on('data', (data) => { stderr += data })
    client.stdin.end(input)
    assert.equal((await once(client, 'close'))[0], 0, stderr)
    return stdout.trim().split('\n').map((line) => JSON.parse(line))
  }
  // `read` is pretty-printed; exercise its actual CLI independently of the MCP adapter.
  const reader = spawn(process.execPath, [script, 'read'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let readOutput = '', readErrors = ''
  reader.stdout.on('data', (data) => { readOutput += data })
  reader.stderr.on('data', (data) => { readErrors += data })
  assert.equal((await once(reader, 'close'))[0], 0, readErrors)
  assert.deepEqual(JSON.parse(readOutput).state, state)
  const [toolRead] = await run('mcp', JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_current_run', arguments: {} },
  }) + '\n')
  assert.equal(toolRead.result.isError, undefined)
  assert.deepEqual(JSON.parse(toolRead.result.content[0].text).state, state)
  socket.terminate()
  companion.kill('SIGTERM')
  assert.equal((await once(companion, 'close'))[0], 0, diagnostics)
  companion = undefined
  await assert.rejects(readFile(credentialsPath), { code: 'ENOENT' })
  console.log('Standalone companion, owner-only credentials, CLI/MCP fresh reads, and shutdown cleanup passed.')
} finally {
  for (const socket of sockets) socket.terminate()
  if (companion && companion.exitCode === null) {
    companion.kill('SIGTERM')
    await once(companion, 'close')
  }
  await rm(checkout, { recursive: true, force: true })
}
