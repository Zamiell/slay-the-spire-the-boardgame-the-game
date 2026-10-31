import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom } from './lib/rooms.mjs'
import { generateMap } from '../src/game/map.ts'
import { createRng } from '../src/game/rng.ts'

const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: {
  '/api': { target: `http://127.0.0.1:${address.port}` },
  '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true },
} } })
await server.listen()
const browser = await chromium.launch()
const output = 'artifacts/map-drawing'
mkdirSync(output, { recursive: true })
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    page.setDefaultTimeout(10_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const run = await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.phase = 'map'
      run.neow = null
      window.__STS_DEBUG__.setRun(run)
      return run
    })
    const map = page.locator('.map:visible')
    const paths = () => map.locator('.map-drawing path:not([data-draft])')
    const startNode = map.locator('.room--reachable').first()
    await startNode.waitFor()
    const nodeId = await startNode.getAttribute('data-room')
    const read = () => page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const before = await read()
    const center = async node => {
      await node.scrollIntoViewIfNeeded()
      const box = await node.boundingBox()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const start = await center(startNode)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(start.x + 45, start.y - 35, { steps: 8 })
    await map.locator('.map-drawing path[data-draft]').waitFor()
    assert.equal(await paths().count(), 0, 'a stroke is not committed while the button is held')
    await page.mouse.up({ button: 'right' })
    await paths().waitFor()
    assert.equal(await paths().count(), 1)
    assert.equal(await read(), before, 'right-dragging across a reachable room must not enter it or change the run')
    const savedPath = await paths().getAttribute('d')
    const aligned = async () => map.evaluate((element, nodeId) => {
      const path = element.querySelector('.map-drawing path')
      const node = element.querySelector(`[data-room="${CSS.escape(nodeId)}"]`).getBoundingClientRect()
      const point = path.getPointAtLength(0).matrixTransform(path.getScreenCTM())
      return Math.hypot(point.x - node.x - node.width / 2, point.y - node.y - node.height / 2) < 4
    }, nodeId)
    assert(await aligned(), 'ink must begin on the room that was right-clicked')
    await map.evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 140) })
    assert(await aligned(), 'scrolling must move the ink with the map')
    if (!phone) {
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.waitForTimeout(100)
      assert(await aligned(), 'resizing must keep room annotations aligned')
      await page.setViewportSize(viewport)
    }
    const again = await center(startNode)
    await page.mouse.move(again.x + 70, again.y - 10)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(again.x + 90, again.y - 45, { steps: 4 })
    await page.keyboard.press('Escape')
    await page.mouse.up({ button: 'right' })
    assert.equal(await paths().count(), 1, 'Escape must cancel only the in-progress stroke')
    await page.mouse.move(again.x, again.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(5, 5, { steps: 4 })
    await page.mouse.up({ button: 'right' })
    assert.equal(await paths().count(), 2, 'releasing outside the paper must finish exactly one stroke')
    assert.equal(await map.locator('[data-drawing]').count(), 0)
    await map.getByRole('button', { name: 'Undo drawing', exact: true }).click()

    assert.equal(await page.getByRole('button', { name: 'Map', exact: true }).count(), 0)
    await startNode.click()
    if (phone) await startNode.click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'player')
    const inCombat = await read()
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    const peek = page.getByRole('dialog', { name: 'Act 1 map', exact: true })
    await peek.waitFor()
    assert.equal(await paths().getAttribute('d'), savedPath, 'the read-only peek must share the main map notes')
    assert(await aligned(), 'notes must align in the narrower map peek')
    await peek.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    await paths().waitFor()
    assert.equal(await paths().count(), 1, 'closing the map must not discard drawings')
    const node = map.locator(`[data-room="${nodeId}"]`)
    const point = await center(node)
    await map.getByRole('button', { name: 'Draw', exact: true }).click()
    if (phone) {
      const session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x - 45, y: point.y - 35, id: 1 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await session.detach()
    } else {
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x - 45, point.y - 35, { steps: 6 })
      await page.mouse.up()
    }
    await page.waitForFunction(() => document.querySelectorAll('.map:has(.map-drawing) .map-drawing path:not([data-draft])').length === 2)
    assert.equal(await read(), inCombat, 'drawing in the read-only map must not affect combat')
    await map.getByRole('button', { name: 'Draw', exact: true }).click()
    await map.getByRole('button', { name: 'Undo drawing', exact: true }).click()
    assert.equal(await paths().count(), 1)
    await page.screenshot({ path: `${output}/${screen}-notes.png` })
    await peek.getByRole('button', { name: 'Close', exact: true }).click()

    const other = structuredClone(run)
    other.campaign.runId += '-another-run'
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), other)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    assert.equal(await paths().count(), 0, 'new runs must not inherit previous notes')
    assert(await map.getByRole('button', { name: 'Undo drawing', exact: true }).isDisabled())
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    await paths().waitFor()
    assert.equal(await paths().getAttribute('d'), savedPath, 'notes must restore after the provider remounts')
    const interrupted = await center(map.locator('.room--reachable').first())
    await page.mouse.move(interrupted.x, interrupted.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(interrupted.x + 15, interrupted.y - 15, { steps: 2 })
    const nextAct = { ...structuredClone(run), act: 2, map: generateMap(createRng(83), 2) }
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), nextAct)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().act === 2)
    await page.mouse.up({ button: 'right' })
    assert.equal(await map.locator('[data-drawing]').count(), 0, 'changing acts must release an interrupted stroke')
    assert.equal(await paths().count(), 0, 'each act must have its own drawings')
    assert(await map.getByRole('button', { name: 'Undo drawing', exact: true }).isDisabled())
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    await paths().waitFor()
    assert.equal(await paths().getAttribute('d'), savedPath)
    await map.getByRole('button', { name: 'Clear drawings', exact: true }).click()
    assert.equal(await paths().count(), 0)
    assert.equal(await read(), before)
    if (!phone) {
      const room = createRoom(rooms.store)
      const seat = joinRoom(room, { name: 'Map notes', character: 'ironclad' })
      room.phase = 'run'
      room.run = structuredClone(run)
      room.run.players[0].id = seat.playerId
      room.version++
      const onlineBefore = JSON.stringify(room.run)
      await page.evaluate(session => sessionStorage.setItem('sts-room-session', JSON.stringify(session)),
        { code: room.code, token: seat.token })
      await page.reload()
      const onlineNode = map.locator('.room--reachable').first()
      await onlineNode.waitFor()
      const onlinePoint = await center(onlineNode)
      await page.mouse.move(onlinePoint.x, onlinePoint.y)
      await page.mouse.down({ button: 'right' })
      await page.mouse.move(onlinePoint.x + 35, onlinePoint.y - 20, { steps: 5 })
      await page.mouse.up({ button: 'right' })
      assert.equal(await paths().count(), 1, 'personal notes must also work in online rooms')
      assert.equal(JSON.stringify(room.run), onlineBefore, 'drawing must not submit an online game action')
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: right-drag, navigation, scroll/resize alignment, touch mode, persistence and clearing`)
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
