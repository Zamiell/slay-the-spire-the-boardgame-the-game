import { test, expect, startStandardCampaign } from '../lib/browser-test.mjs'

test.use({ appKey: import.meta.url })

test('restarting an unrecorded campaign uses the new recording even when its run ID is reused', async ({ page, appURL }) => {
  await startStandardCampaign(page, appURL)
  const previousId = await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    window.__STS_DEBUG__.setRun({ ...run, phase: 'map', neow: null, log: [...run.log, 'previous attempt marker'] })
    return run.campaign.runId
  })
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Return to main menu', exact: true }).click()
  for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
    await page.getByRole('button', { name, exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
  const next = await page.evaluate(async () => {
    const { readRunLog } = await import('/src/ui/run-log.ts')
    const run = window.__STS_DEBUG__.getRun()
    return { runId: run.campaign.runId, recording: JSON.stringify(await readRunLog(run.campaign.runId)) }
  })
  expect(next.runId).toBe(previousId)
  expect(JSON.parse(next.recording).runId).toBe(previousId)
  expect(next.recording).not.toContain('previous attempt marker')
})

test('failed transitions stay queued and flush recovers the complete recording', async ({ page, appURL }) => {
  await page.goto(appURL)
  const result = await page.evaluate(async () => {
    const storage = await import('/src/ui/run-log/storage.ts')
    const { createRun } = await import('/src/game/run.ts')
    const run = createRun(12, [{ id: 'p', name: 'Probe', character: 'ironclad' }])
    await storage.startRecording(run)
    const log = await storage.persistedLog(run.campaign.runId)
    const put = IDBObjectStore.prototype.put
    let fail = true
    const attempted = []
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'events') {
        attempted.push(value.index)
        if (fail) queueMicrotask(() => this.transaction.abort())
      }
      return put.call(this, value, ...args)
    }
    let refused = false
    try {
      storage.appendRunLogEvent(log, { patch: [{ path: ['log'], value: ['first'] }] })
      storage.appendRunLogEvent(log, { patch: [{ path: ['log'], value: ['first', 'second'] }] })
      try { await storage.flushRunLog() } catch { refused = true }
      const beforeRecovery = [...attempted]
      fail = false
      await storage.flushRunLog()
      return { runId: run.campaign.runId, refused, beforeRecovery, recovered: attempted.slice(beforeRecovery.length) }
    } finally { IDBObjectStore.prototype.put = put }
  })
  expect(result.refused).toBe(true)
  expect(result.beforeRecovery.length).toBeGreaterThan(0)
  expect(result.beforeRecovery.every(index => index === 0)).toBe(true)
  expect(result.recovered).toEqual([0, 1])
  await page.reload()
  expect(await page.evaluate(async runId => {
    const { readRunLog } = await import('/src/ui/run-log/storage.ts')
    const { applyRunLogEvent } = await import('/src/ui/run-log/codec.ts')
    const log = await readRunLog(runId)
    return log.events.reduce(applyRunLogEvent, log.initial).log
  }, result.runId)).toEqual(['first', 'second'])
})

test('reload rejects a persisted chain with a missing predecessor', async ({ page, appURL }) => {
  await page.goto(appURL)
  const runId = await page.evaluate(async () => {
    const storage = await import('/src/ui/run-log/storage.ts')
    const { createRun } = await import('/src/game/run.ts')
    const run = createRun(14, [{ id: 'p', name: 'Probe', character: 'ironclad' }])
    await storage.startRecording(run)
    const request = indexedDB.open('sts-run-vod-v2', 1)
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('events', 'readwrite')
    transaction.objectStore('events').put({ runId: run.campaign.runId, index: 1, event: { patch: [] } })
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    return run.campaign.runId
  })
  await page.reload()
  expect(await page.evaluate(async runId => {
    try {
      await (await import('/src/ui/run-log/storage.ts')).readRunLog(runId)
      return 'unexpected success'
    } catch (error) { return error.message }
  }, runId)).toContain('missing transitions')
})

test('a failed database open can recover without reloading or dropping queued events', async ({ page, appURL }) => {
  await page.goto(appURL)
  expect(await page.evaluate(async () => {
    const storage = await import('/src/ui/run-log/storage.ts')
    const { createRun } = await import('/src/game/run.ts')
    const run = createRun(16, [{ id: 'p', name: 'Probe', character: 'ironclad' }])
    Object.defineProperty(indexedDB, 'open', { configurable: true, value: () => {
      const request = new EventTarget()
      request.error = new DOMException('Storage unavailable', 'UnknownError')
      queueMicrotask(() => request.dispatchEvent(new Event('error')))
      return request
    } })
    let started
    try { started = await storage.startRecording(run) } finally { delete indexedDB.open }
    const log = await storage.persistedLog(run.campaign.runId)
    storage.appendRunLogEvent(log, { patch: [] })
    await storage.flushRunLog()
    return { started, count: (await storage.readRunLog(run.campaign.runId)).events.length }
  })).toEqual({ started: false, count: 1 })
})
