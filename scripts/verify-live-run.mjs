import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WebSocket } from 'ws'
import { parseHistoryQuery, startLiveRunServer } from './lib/live-run-server.mjs'

const origin = 'http://localhost:5180'
const bridge = await startLiveRunServer({ port: 0, requestTimeout: 150 })
const url = `http://127.0.0.1:${bridge.port}/current`
const sockets = []
const state = {
  run: { id: 'campaign-1', phase: 'combat', mode: 'local' }, pending: false,
  screen: { headings: ['Ironclad'], text: 'Health 7 of 9', observations: [], announcements: [] },
  choices: [{ label: 'Strike', available: true, count: 2 }],
}
function historyPage(query) {
  const through = query.through ?? 3
  const end = Math.min(through, query.offset + query.limit)
  return { status: 'ready', runId: state.run.id, recordingId: 'test-recording', offset: query.offset,
    through, recordedTransitions: 3, initial: query.offset === 0 ? { frame: { phase: 'map' } } : undefined,
    transitions: Array.from({ length: end - query.offset }, (_, index) => ({ index: query.offset + index + 1 })),
    next: end < through ? { offset: end, limit: query.limit, through, runId: state.run.id, recordingId: 'test-recording' } : null,
  }
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
  const historyUrl = `http://127.0.0.1:${bridge.port}/history`
  assert.equal((await fetch(historyUrl)).status, 401)
  assert.equal((await fetch(historyUrl, { headers: { ...headers, Origin: origin } })).status, 403)
  assert.equal((await fetch(historyUrl, { headers, method: 'POST' })).status, 404)
  assert.equal((await fetch(historyUrl, { headers })).status, 503)
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=1.5', 'offset=9007199254740992',
    'offset=2&through=1', 'limit=1&limit=2', 'action=end_turn', 'through=nope']) {
    assert.equal((await fetch(`${historyUrl}?${query}`, { headers })).status, 400, query)
  }
  for (const input of [null, [], { limit: '1' }, { offset: null }, { runId: '' }, { action: 'end_turn' }]) {
    assert.throws(() => parseHistoryQuery(input))
  }

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
  let historyError
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (answer && message.type === 'inspect') socket.send(JSON.stringify({ type: 'snapshot', requestId: message.requestId, state: latest }))
    if (answer && message.type === 'inspect_history') socket.send(JSON.stringify(historyError
      ? { type: 'history_error', requestId: message.requestId, error: historyError }
      : { type: 'history', requestId: message.requestId, history: historyPage(message.query) }))
  })
  const first = await bridge.current()
  assert.equal(first.fresh, true)
  assert.equal(first.origin, origin)
  assert.deepEqual(first.state, state)
  assert.equal(first.revision, 1)
  const stable = await bridge.current()
  assert.equal(stable.revision, first.revision, 'fresh reads need not invent state changes')
  const [recorded, concurrentCurrent] = await Promise.all([bridge.history({ limit: 1 }), bridge.current()])
  assert.equal(recorded.history.transitions.length, 1)
  assert.equal(recorded.history.next.offset, 1)
  assert.equal(recorded.fresh, true)
  assert.equal(recorded.state, undefined, 'full history must not be added to regular snapshots')
  assert.equal(concurrentCurrent.revision, stable.revision, 'history requests must not change observation history')
  const nextPage = await (await fetch(`${historyUrl}?offset=1&limit=1`, { headers })).json()
  assert.equal(nextPage.history.transitions[0].index, 2)
  historyError = 'Recording is unavailable.'
  await assert.rejects(bridge.history(), /Recording is unavailable/)
  assert.equal((await bridge.current()).fresh, true, 'a history error must not disconnect the feed')
  historyError = undefined
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
  await assert.rejects(bridge.history(), /did not answer/)
  answer = true
  latest = { ...state, run: { ...state.run, id: 'campaign-2' } }
  const nextRun = await bridge.current()
  assert.equal(nextRun.recentObservations.length, 1, 'history does not mix runs')
  answer = false
  const pending = Promise.all([assert.rejects(bridge.current(), /disconnected/),
    assert.rejects(bridge.history(), /disconnected/)])
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
assert.deepEqual(replies[2].result.tools.map((tool) => tool.name), ['get_current_run', 'get_run_history'])
assert(replies[2].result.tools.every(tool => tool.annotations.readOnlyHint === true))
assert.equal(replies[3].result.isError, true)
assert.match(replies[3].result.content[0].text, /no arguments/)
console.log('Live-run pairing, fresh reads, disconnects, tab isolation, and read-only MCP passed.')

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'tmp'), { recursive: true })
const checkout = await mkdtemp(resolve(root, 'tmp/live-run-cli-'))
let companion
let development
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
  let refuseHistoryContinuation = false
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'inspect') socket.send(JSON.stringify({ type: 'snapshot', requestId: message.requestId, state }))
    if (message.type === 'inspect_history') socket.send(JSON.stringify(refuseHistoryContinuation && message.query.offset > 0
      ? { type: 'history_error', requestId: message.requestId, error: 'History continuation unavailable.' }
      : { type: 'history', requestId: message.requestId, history: historyPage(message.query) }))
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
  const historyReader = spawn(process.execPath, [script, 'history', '--all', '--limit=1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let historyOutput = '', historyErrors = ''
  historyReader.stdout.on('data', data => { historyOutput += data })
  historyReader.stderr.on('data', data => { historyErrors += data })
  assert.equal((await once(historyReader, 'close'))[0], 0, historyErrors)
  const entire = JSON.parse(historyOutput).history
  assert.deepEqual(entire.transitions.map(entry => entry.index), [1, 2, 3])
  assert.equal(entire.initial.frame.phase, 'map')
  assert.equal(entire.offset, 0)
  assert.equal(entire.next, null)
  const [toolRead] = await run('mcp', JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_current_run', arguments: {} },
  }) + '\n')
  assert.equal(toolRead.result.isError, undefined)
  assert.deepEqual(JSON.parse(toolRead.result.content[0].text).state, state)
  const [historyRead, invalidHistory] = await run('mcp', [
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_run_history', arguments: { limit: 1 } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_run_history', arguments: { limit: 101 } } },
  ].map(request => JSON.stringify(request)).join('\n') + '\n')
  assert.equal(historyRead.result.isError, undefined)
  assert.equal(JSON.parse(historyRead.result.content[0].text).history.next.offset, 1)
  assert.equal(invalidHistory.result.isError, true)
  refuseHistoryContinuation = true
  const interrupted = spawn(process.execPath, [script, 'history', '--all', '--limit=1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let partialOutput = '', interruption = ''
  interrupted.stdout.on('data', data => { partialOutput += data })
  interrupted.stderr.on('data', data => { interruption += data })
  assert.equal((await once(interrupted, 'close'))[0], 1)
  assert.equal(partialOutput, '', '--all must not print success-shaped partial history')
  assert.match(interruption, /History continuation unavailable/)
  socket.terminate()
  companion.kill('SIGTERM')
  assert.equal((await once(companion, 'close'))[0], 0, diagnostics)
  companion = undefined
  await assert.rejects(readFile(credentialsPath), { code: 'ENOENT' })
  console.log('Standalone companion, owner-only credentials, CLI/MCP fresh reads, and shutdown cleanup passed.')

  const { scripts } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  await writeFile(resolve(checkout, 'package.json'), JSON.stringify({
    private: true,
    scripts: {
      dev: scripts.dev,
      'dev:assistant': `${scripts['dev:assistant']} --port=${bridge.port}`,
      'dev:client': 'node -e "console.log(\'fixture client ready\'); setInterval(() => {}, 1000)"',
      'dev:rooms': 'node -e "console.log(\'fixture rooms ready\'); setInterval(() => {}, 1000)"',
    },
  }))
  development = spawn('pnpm', ['run', 'dev'], { cwd: checkout, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let devOutput = ''
  development.stdout.on('data', (data) => { devOutput += data })
  development.stderr.on('data', (data) => { devOutput += data })
  const started = AbortSignal.timeout(10_000)
  while (!['fixture client ready', 'fixture rooms ready', 'Settings > Assistant pairing code:'].every((text) => devOutput.includes(text))) {
    await once(development.stdout, 'data', { signal: started })
  }
  const devCredentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
  const notShared = await fetch(`http://127.0.0.1:${devCredentials.port}/current`, {
    headers: { Authorization: `Bearer ${devCredentials.token}` },
  })
  assert.equal(notShared.status, 503)
  assert.equal((await notShared.json()).code, 'not_paired', 'pnpm dev must not opt the browser into sharing')
  // Signal the isolated process group just as Ctrl+C signals a terminal's foreground job.
  const stopped = once(development, 'close', { signal: AbortSignal.timeout(10_000) })
  process.kill(-development.pid, 'SIGINT')
  await stopped
  await assert.rejects(readFile(credentialsPath), { code: 'ENOENT' }, 'stopping pnpm dev removes the companion credentials')
  await assert.rejects(fetch(`http://127.0.0.1:${devCredentials.port}/current`, { signal: AbortSignal.timeout(1_000) }),
    'stopping pnpm dev also stops the listener')
  console.log('pnpm dev starts the companion without sharing and Ctrl+C stops it cleanly.')
} finally {
  for (const socket of sockets) socket.terminate()
  if (development) {
    try { process.kill(-development.pid, 'SIGKILL') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
    if (development.exitCode === null && development.signalCode === null) await once(development, 'close')
  }
  if (companion && companion.exitCode === null) {
    companion.kill('SIGTERM')
    await once(companion, 'close')
  }
  await rm(checkout, { recursive: true, force: true })
}
