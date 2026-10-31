import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { startLiveRunServer } from './lib/live-run-server.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { dragCardTo } from './lib/card-interactions.mjs'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'artifacts/live-run')
mkdirSync(out, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
const origin = `http://localhost:${server.httpServer.address().port}`
const bridge = await startLiveRunServer({ port: 0, origins: [origin] })
const browser = await chromium.launch()
try {
  for (const [screen, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }]]) {
    const page = await browser.newPage({ viewport, hasTouch: screen === 'horizontal-phone', isMobile: screen === 'horizontal-phone' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      const tools = new Map()
      Object.defineProperty(document, 'modelContext', { value: {
        registerTool(tool, options) {
          tools.set(tool.name, tool)
          options.signal?.addEventListener('abort', () => tools.delete(tool.name))
          return Promise.resolve()
        },
        tools,
      } })
    })
    await page.goto(origin)
    await assert.rejects(bridge.current(), /No game tab/, 'off by default')
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun()?.phase === 'neow')
    const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    const roomId = run.map.rows[0][0]
    run.map.rooms[roomId].kind = 'encounter'
    const combat = enterRoom(run, roomId)
    combat.campaign.runId = `assistant-history-${screen}`
    const player = combat.combat.players[0]
    player.energy = 3
    player.hand = ['strike_ironclad', 'defend_ironclad'].map((defId, i) => ({ uid: `live-${i}`, defId, upgraded: false }))
    player.draw[0].uid = 'history-private-draw-sentinel'
    await page.evaluate(async (run) => {
      await (await import('/src/ui/run-log.ts')).startRunLog(run)
      window.__STS_DEBUG__.setRun(run)
    }, combat)
    await page.locator('.hand .card').first().waitFor()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'assistant', exact: true }).click()
    await page.getByLabel('Pairing code', { exact: true }).fill(bridge.pairingCode)
    await page.getByRole('button', { name: 'Share this tab', exact: true }).click()
    await page.getByText('Sharing this tab, read-only.', { exact: false }).waitFor()
    assert.equal(await page.getByLabel('Pairing code', { exact: true }).count(), 0, 'credential is removed after pairing')
    await page.screenshot({ path: resolve(out, `${screen}-sharing.png`) })
    const bounds = await page.locator('dialog[open]').evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const view = visualViewport
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: node.scrollWidth > node.clientWidth,
        viewport: { left: view?.offsetLeft ?? 0, top: view?.offsetTop ?? 0, width: view?.width ?? innerWidth, height: view?.height ?? innerHeight } }
    })
    assert(bounds.left >= bounds.viewport.left - 1 && bounds.right <= bounds.viewport.left + bounds.viewport.width + 1 &&
      bounds.top >= bounds.viewport.top - 1 && bounds.bottom <= bounds.viewport.top + bounds.viewport.height + 1 && !bounds.overflow,
      `${screen}: sharing controls must fit the supported screen: ${JSON.stringify(bounds)}`)
    const settings = await bridge.current()
    assert(!JSON.stringify(settings).includes(bridge.token), 'pairing code is never exported')
    await page.locator('dialog[open]').getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[data-webmcp-pending="true"]'))
    const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const webMcpBefore = await page.evaluate(() => document.modelContext.tools.get('inspect_game').execute({}))
    const first = await bridge.current()
    assert.equal(first.state.run.id, combat.campaign.runId)
    assert.equal(first.state.run.phase, 'combat')
    assert(first.state.choices.some((choice) => choice.label.startsWith('Strike')))
    for (const choices of [first.state.choices, webMcpBefore.controls]) {
      assert(choices.some((choice) => choice.label === `End Turn ${combat.combat.turn}`), 'the current turn is exposed by its end-turn control')
      assert(choices.some((choice) => /^Draw pile, \d+ cards$/.test(choice.label)), 'visible draw-pile count is exposed')
    }
    assert.match(first.state.screen.text, /\b3 Energy\b/)
    assert.match(webMcpBefore.screen.text, /\b3 Energy\b/)
    assert(!JSON.stringify(first).includes('00000000-0000-4000-8000-000000000001'), 'account token is not exported')
    assert.equal(first.state.rng, undefined)
    assert.equal(first.state.players, undefined, 'no raw engine state')
    const webMcpAfter = await page.evaluate(() => document.modelContext.tools.get('inspect_game').execute({}))
    assert.deepEqual(webMcpAfter.controls, webMcpBefore.controls, 'passive reads preserve active WebMCP IDs')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before, 'inspection is read-only')

    await page.evaluate(() => {
      const hidden = document.createElement('p')
      hidden.hidden = true
      hidden.textContent = 'hidden-draw-order-sentinel'
      document.getElementById('root').append(hidden)
    })
    assert(!JSON.stringify(await bridge.current()).includes('hidden-draw-order-sentinel'))
    await dragCardTo(page, 'Defend')
    await page.waitForFunction(() => !document.querySelector('.hand .card[aria-label^="Defend"]'))
    const afterPlay = await bridge.current()
    assert(afterPlay.revision > first.revision)
    assert(!afterPlay.state.choices.some((choice) => choice.context === 'Hand' && choice.label.startsWith('Defend')))
    assert.notEqual(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before)
    assert.equal(afterPlay.state.history.status, 'ready')
    assert.equal(afterPlay.state.history.caughtUp, true)
    const defend = afterPlay.state.history.transitions.find(entry => entry.cards.some(card => card.cardId === 'defend_ironclad'))
    assert.equal(defend.before.players[0].energy, 3)
    assert.equal(defend.after.players[0].energy, 2)
    await page.screenshot({ path: resolve(out, `${screen}-combat.png`) })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'assistant', exact: true }).click()
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
    await page.getByText('Not sharing.', { exact: true }).waitFor()
    await assert.rejects(bridge.current(), /disconnected|No game tab/)
    await page.locator('dialog[open]').getByRole('button', { name: 'Back', exact: true }).click()
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      const player = run.combat.players[0]
      player.energy = 3
      player.enemyNextCardCost = 2
      player.hand.push({ uid: 'disconnected-crescendo', defId: 'crescendo', upgraded: false })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.locator('.hand .card[data-card-name="Crescendo"]').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].energy === 1)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'assistant', exact: true }).click()
    await page.getByLabel('Pairing code', { exact: true }).fill(bridge.pairingCode)
    await page.getByRole('button', { name: 'Share this tab', exact: true }).click()
    await page.getByText('Sharing this tab, read-only.', { exact: false }).waitFor()
    const reconnected = await bridge.current()
    const pairedTab = reconnected.tabId
    const disconnectedPlay = reconnected.state.history.transitions.find(entry => entry.cards.some(card => card.cardId === 'crescendo'))
    assert(disconnectedPlay, 'recorded plays made while disconnected must be available after pairing')
    assert.equal(disconnectedPlay.before.players[0].energy, 3)
    assert.equal(disconnectedPlay.after.players[0].energy, 1)
    assert.equal(disconnectedPlay.cards[0].printedCost, 0)
    assert.deepEqual(disconnectedPlay.cardEnergySpent, [{ playerId: 'p1', amount: 2 }])
    for (let index = 0; index < 42; index++) {
      await page.evaluate(index => {
        const run = structuredClone(window.__STS_DEBUG__.getRun())
        run.combat.players[0].energy = index % 2 + 1
        run.combat.players[0].gold = index
        run.players[0].gold = index
        run.log.push(`Public recorded note ${index}`)
        window.__STS_DEBUG__.setRun(run)
      }, index)
      await page.waitForFunction(index => window.__STS_DEBUG__.getRun().players[0].gold === index, index)
    }
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      const card = { uid: 'history-added-card', defId: 'anger', upgraded: false }
      run.players[0].deck.push(card)
      run.combat.players[0].deck.push(card)
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().players[0].deck.some(card => card.uid === 'history-added-card'))
    const recordedCount = await page.evaluate(async () => {
      const log = await (await import('/src/ui/run-log.ts')).readRunLog(window.__STS_DEBUG__.getRun().campaign.runId)
      log.events.at(-1).choice = { source: {
        name: 'Public recorded choice', selector: 'history-private-selector-sentinel', value: 'history-private-input-sentinel',
      } }
      return log.events.length
    })
    const recent = await bridge.current()
    assert.equal(recent.state.history.truncated, true)
    assert.equal(recent.state.history.transitions.length, 32)
    const readPages = async first => {
      const transitions = []
      let response = first
      while (true) {
        assert(Buffer.byteLength(JSON.stringify(response)) < 512 * 1024, 'history pages must fit the transport budget')
        transitions.push(...response.history.transitions)
        if (!response.history.next) break
        response = await bridge.history(response.history.next)
      }
      return { ...response.history, initial: first.history.initial, offset: first.history.offset, transitions }
    }
    const firstPage = await bridge.history({ limit: 7 })
    assert.equal(firstPage.history.through, recordedCount)
    assert.equal(firstPage.history.transitions.length, 7)
    const beforeHistory = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const beforeRecording = await page.evaluate(async () => JSON.stringify(
      await (await import('/src/ui/run-log.ts')).readRunLog(window.__STS_DEBUG__.getRun().campaign.runId)))
    await assert.rejects(bridge.history({ runId: 'not-the-active-run' }), /run or recording changed/)
    const all = await readPages(firstPage)
    assert.equal(all.transitions.length, recordedCount, 'full history must include every recorder event, not only changed public frames')
    assert.deepEqual(all.transitions.map(entry => entry.index), Array.from({ length: recordedCount }, (_, index) => index + 1))
    assert(all.transitions.some(entry => entry.cards.some(card => card.cardId === 'defend_ironclad')))
    assert(all.transitions.some(entry => entry.cards.some(card => card.cardId === 'crescendo')))
    assert(all.transitions.some(entry => entry.choice?.source?.startsWith('Defend')))
    assert(all.transitions.some(entry => entry.deckChanges.some(change => change.added.some(card => card.cardId === 'anger'))))
    assert(all.transitions.some(entry => entry.messages.run.entries.includes('Public recorded note 0')))
    assert(all.transitions.some(entry => entry.messages.run.entries.includes('Public recorded note 41')))
    assert.equal(all.caughtUp, true)
    for (const hidden of [bridge.token, 'history-private-draw-sentinel', 'history-private-selector-sentinel',
      'history-private-input-sentinel', '"patch"', '"rng"', '"seed"', '"hand"', '"draw"', '"rareRewards"', '"cardRewards"']) {
      assert(!JSON.stringify(all).includes(hidden), `${hidden} must not leave the public history projection`)
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeHistory,
      'full history queries must not change the game or RNG')
    assert.equal(await page.evaluate(async () => JSON.stringify(
      await (await import('/src/ui/run-log.ts')).readRunLog(window.__STS_DEBUG__.getRun().campaign.runId))), beforeRecording,
    'history queries must not rewrite the recording they read')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.log.push('Appended after the pinned history query')
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().log.at(-1) === 'Appended after the pinned history query')
    const pinned = await readPages(await bridge.history({ ...firstPage.history.next, offset: 0 }))
    assert.equal(pinned.transitions.length, recordedCount, 'continuations must keep their original upper bound')
    assert.equal(pinned.caughtUp, false)
    const appended = await bridge.history({ runId: all.runId, recordingId: all.recordingId, offset: recordedCount })
    assert(appended.history.transitions.some(entry => entry.messages.run.entries.includes('Appended after the pinned history query')))
    await page.reload()
    await page.getByRole('button', { name: 'Single Player', exact: true }).waitFor()
    await page.waitForFunction(async () => (await import('/src/ui/live-run.ts')).liveRunStatus().state === 'connected')
    const restored = await bridge.current()
    assert.equal(restored.tabId, pairedTab, 'refresh automatically restores the same tab without opening Settings')
    assert(restored.state.choices.some((choice) => choice.label === 'Single Player'), 'refresh returns the new screen, not cached combat')
    assert(!JSON.stringify(restored).includes(bridge.token))
    assert.equal(restored.state.history.status, 'idle', 'menus must not leak the previous run history')
    await assert.rejects(bridge.history(), /active local run/, 'menus must not expose the complete recording either')

    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.locator('.hand .card').first().waitFor()
    await page.waitForFunction(async () => (await import('/src/ui/run-log.ts')).readAssistantRunHistory(
      window.__STS_DEBUG__.getRun().campaign.runId, 'local').status === 'ready')
    const resumed = await bridge.current()
    assert.equal(resumed.state.history.status, 'ready')
    await assert.rejects(bridge.history({ runId: all.runId, recordingId: all.recordingId }), /recording changed/,
      'a reload must not silently reuse a continuation from the previous loaded recording')
    const fullResumed = await readPages(await bridge.history())
    assert(fullResumed.transitions.some(entry => entry.cards.some(card => card.cardId === 'crescendo')),
      'the existing persisted recording must recover the card history after refresh and Resume')
    const largeStart = fullResumed.through
    for (let index = 0; index < 8; index++) {
      await page.evaluate(index => {
        const run = structuredClone(window.__STS_DEBUG__.getRun())
        run.log.push(`Long public note ${index}: ${'x'.repeat(60_000)}`)
        window.__STS_DEBUG__.setRun(run)
      }, index)
      await page.waitForFunction(index => window.__STS_DEBUG__.getRun().log.at(-1).startsWith(`Long public note ${index}:`), index)
    }
    const large = await bridge.history({ offset: largeStart, limit: 100 })
    assert(large.history.next, 'large histories must paginate by bytes as well as event count')
    assert.equal((await readPages(large)).transitions.length, 8)

    const opened = page.waitForEvent('popup')
    await page.evaluate(() => { window.open(location.href, '_blank') })
    const duplicate = await opened
    await duplicate.getByRole('button', { name: 'Single Player', exact: true }).waitFor()
    assert.equal(await duplicate.evaluate(async () => (await import('/src/ui/live-run.ts')).liveRunStatus().state), 'off',
      'an opener-copied session does not grant another tab consent')
    assert.equal(await duplicate.evaluate(() => sessionStorage.getItem('sts-live-run-pairing')), null)
    await duplicate.reload()
    await duplicate.getByRole('button', { name: 'Single Player', exact: true }).waitFor()
    assert.equal(await duplicate.evaluate(async () => (await import('/src/ui/live-run.ts')).liveRunStatus().state), 'off')
    assert.equal((await bridge.current()).tabId, pairedTab)
    await duplicate.close()

    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.log.push('Oversize public note: ' + 'x'.repeat(450_000))
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().log.at(-1).startsWith('Oversize public note:'))
    const oversizeIndex = await page.evaluate(async () =>
      (await (await import('/src/ui/run-log.ts')).readRunLog(window.__STS_DEBUG__.getRun().campaign.runId)).events.length - 1)
    await assert.rejects(bridge.history({ offset: oversizeIndex, limit: 1 }), /exceeds the history response size limit/)
    assert.equal((await bridge.current()).fresh, true, 'an oversize history entry must not break normal sharing')

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'assistant', exact: true }).click()
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
    assert.equal(await page.evaluate(() => sessionStorage.getItem('sts-live-run-pairing')), null)
    await page.reload()
    await page.getByRole('button', { name: 'Single Player', exact: true }).waitFor()
    await assert.rejects(bridge.current(), /disconnected|No game tab/, 'Stop sharing must survive refresh')
    assert.deepEqual(errors, [], `${screen}: no browser exceptions`)
    await page.close()
  }
  const blocked = await browser.newPage()
  await blocked.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sts-live-run-pairing') throw new DOMException('Storage blocked', 'SecurityError')
      return setItem.call(this, key, value)
    }
  })
  await blocked.goto(origin)
  await blocked.evaluate(async (code) => (await import('/src/ui/live-run.ts')).shareRun(code), bridge.pairingCode)
  await blocked.waitForFunction(async () => (await import('/src/ui/live-run.ts')).liveRunStatus().message.includes('could not save'))
  await assert.rejects(bridge.current(), /disconnected|No game tab/, 'storage failure must not silently leave sharing enabled')
  await blocked.close()
  console.log('Live-run desktop and horizontal-phone pairing, refresh persistence, tab isolation, read-only behavior, and revocation passed.')
} finally {
  await browser.close()
  await bridge.close()
  await server.close()
}
