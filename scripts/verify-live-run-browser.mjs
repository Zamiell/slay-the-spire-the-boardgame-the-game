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
    const player = combat.combat.players[0]
    player.energy = 3
    player.hand = ['strike_ironclad', 'defend_ironclad'].map((defId, i) => ({ uid: `live-${i}`, defId, upgraded: false }))
    await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), combat)
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
    await page.screenshot({ path: resolve(out, `${screen}-combat.png`) })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'assistant', exact: true }).click()
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
    await page.getByText('Not sharing.', { exact: true }).waitFor()
    await assert.rejects(bridge.current(), /disconnected|No game tab/)
    await page.getByLabel('Pairing code', { exact: true }).fill(bridge.pairingCode)
    await page.getByRole('button', { name: 'Share this tab', exact: true }).click()
    await page.getByText('Sharing this tab, read-only.', { exact: false }).waitFor()
    const pairedTab = (await bridge.current()).tabId
    await page.reload()
    await page.getByRole('button', { name: 'Single Player', exact: true }).waitFor()
    await page.waitForFunction(async () => (await import('/src/ui/live-run.ts')).liveRunStatus().state === 'connected')
    const restored = await bridge.current()
    assert.equal(restored.tabId, pairedTab, 'refresh automatically restores the same tab without opening Settings')
    assert(restored.state.choices.some((choice) => choice.label === 'Single Player'), 'refresh returns the new screen, not cached combat')
    assert(!JSON.stringify(restored).includes(bridge.token))

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
