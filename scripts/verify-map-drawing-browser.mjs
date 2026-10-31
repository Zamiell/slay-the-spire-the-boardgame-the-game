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
    const paths = () => map.locator('.map-drawing__ink:not([data-draft])')
    const tools = map.getByRole('group', { name: 'Map drawing tools', exact: true })
    const activateTool = name => {
      const button = tools.getByRole('button', { name, exact: true })
      return phone ? button.tap() : button.click()
    }
    const startNode = map.locator('.room--reachable').first()
    await startNode.waitFor()
    const headerGap = () => map.evaluate(element =>
      element.getBoundingClientRect().top -
      element.closest('.app-shell').querySelector('.app-shell__header').getBoundingClientRect().bottom)
    assert(Math.abs(await headerGap()) <= 1, `${screen}: map parchment must meet the header without a black strip`)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.settings-dialog[open]').waitFor()
    assert(Math.abs(await headerGap()) <= 1, 'opening a dialog must not move the map away from the header')
    await page.keyboard.press('Escape')
    await page.locator('.settings-dialog[open]').waitFor({ state: 'detached' })
    assert(Math.abs(await headerGap()) <= 1, 'closing a dialog must not reintroduce the map gap')
    assert(await map.evaluate(element => {
      const panel = document.createElement('section')
      panel.className = 'room-screen'
      panel.textContent = 'Waiting for another player to resolve a Relic.'
      element.before(panel)
      const clear = element.getBoundingClientRect().top >= panel.getBoundingClientRect().bottom - 1
      panel.remove()
      return clear
    }), 'an in-flow acquisition panel must not be overlapped by the map')
    assert.deepEqual(await tools.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))),
      ['Draw', 'Erase', 'Clear drawings'])
    assert.equal((await tools.innerText()).trim(), '', 'drawing controls must be icons, not a labeled toolbar')
    assert.equal(await map.getByRole('button', { name: 'Undo drawing', exact: true }).count(), 0)
    assert(await tools.evaluate(element => {
      const box = element.getBoundingClientRect()
      const map = element.closest('.map').getBoundingClientRect()
      return box.left >= map.left && box.right < map.left + map.width / 2 &&
        box.top > map.top + map.height / 2 && box.bottom <= map.bottom &&
        Math.abs(box.width / box.height - 208 / 68) < 0.02
    }), `${screen}: drawing controls must occupy the compact bottom-left strip`)
    const nodeId = await startNode.getAttribute('data-room')
    const read = () => page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const before = await read()
    const tip = tools.getByRole('tooltip')
    for (const [label, title, color] of [
      ['Draw', 'Map Drawing (Right-Click)', 'rgb(87, 196, 255)'],
      ['Erase', 'Map Erasing (Middle-Click)', 'rgb(255, 87, 87)'],
      ['Clear drawings', 'Clear Drawings', 'rgb(255, 229, 125)'],
    ]) {
      const button = tools.getByRole('button', { name: label, exact: true })
      await button.hover()
      await tip.waitFor()
      assert.equal(await tip.locator('.relic-tip__name').innerText(), title)
      const appearance = await button.locator('svg').evaluate(svg => ({
        color: getComputedStyle(svg).color, scale: new DOMMatrix(getComputedStyle(svg).transform).a,
      }))
      assert.equal(appearance.color, color)
      assert.equal(appearance.scale, 1.2, 'tool icons must enlarge on hover without enlarging their hit areas')
      assert(await tip.evaluate(element => {
        const box = element.getBoundingClientRect()
        const toolbar = element.closest('.map-drawing__tools').getBoundingClientRect()
        return box.bottom <= toolbar.top && box.top >= 0 && box.right <= innerWidth
      }), `${screen}: drawing help must appear above the strip`)
    }
    await page.screenshot({ path: `${output}/${screen}-drawing-controls.png` })
    assert.equal(await tools.getByRole('button', { name: 'Draw', exact: true }).getAttribute('aria-pressed'), 'false',
      'hovering the quill must not enable drawing')
    await page.mouse.move(0, 0)
    await tip.waitFor({ state: 'detached' })
    assert.equal(await read(), before)
    const center = async node => {
      await node.scrollIntoViewIfNeeded()
      const box = await node.boundingBox()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const dragWithTool = async (from, to) => {
      if (phone) {
        const session = await page.context().newCDPSession(page)
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...to, id: 1 }] })
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await session.detach()
      } else {
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 6 })
        await page.mouse.up()
      }
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
    const savedPath = await paths().first().getAttribute('d')
    const aligned = async () => map.evaluate((element, nodeId) => {
      const path = element.querySelector('.map-drawing__ink')
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
    const inkPoint = (fraction, index = 0) => paths().nth(index).evaluate((path, fraction) => {
      const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM())
      return { x: point.x, y: point.y }
    }, fraction)
    const alphaAt = (fraction, index = 0) => map.locator('.map-drawing').evaluate(async (svg, { fraction, index }) => {
      const path = svg.querySelectorAll('.map-drawing__ink')[index]
      const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM())
      const box = svg.getBoundingClientRect()
      const clone = svg.cloneNode(true)
      clone.setAttribute('width', String(Math.ceil(box.width)))
      clone.setAttribute('height', String(Math.ceil(box.height)))
      const originals = [...svg.querySelectorAll('path')]
      clone.querySelectorAll('path').forEach((copy, index) => {
        const style = getComputedStyle(originals[index])
        for (const property of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity'])
          copy.style.setProperty(property, style.getPropertyValue(property))
      })
      const image = new Image()
      image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(box.width)
      canvas.height = Math.ceil(box.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return context.getImageData(Math.round(point.x - box.left), Math.round(point.y - box.top), 1, 1).data[3]
    }, { fraction, index })
    assert(await alphaAt(0.5) > 100, 'the test must sample painted ink')
    const middle = await inkPoint(0.5)
    await page.mouse.move(middle.x, middle.y - 20)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(middle.x, middle.y + 20, { steps: 6 })
    await page.mouse.up({ button: 'middle' })
    assert.equal(await alphaAt(0.5), 0, 'middle-drag must erase the crossed portion of the line')
    assert(await alphaAt(0.9) > 100, 'the eraser must not remove the whole stroke')
    assert.equal(await read(), before, 'erasing must not navigate or mutate the run')

    assert.equal(await page.getByRole('button', { name: 'Map', exact: true }).count(), 0)
    await startNode.click()
    if (phone) await startNode.click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'player')
    const inCombat = await read()
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    const peek = page.getByRole('dialog', { name: 'Act 1 map', exact: true })
    await peek.waitFor()
    assert.equal(await paths().first().getAttribute('d'), savedPath, 'the read-only peek must share the main map notes')
    assert.equal(await alphaAt(0.5), 0, 'erased ink must stay erased in the map peek')
    assert(await aligned(), 'notes must align in the narrower map peek')
    await peek.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    await paths().first().waitFor()
    assert.equal(await paths().count(), 2, 'closing the map must not discard drawings')
    const node = map.locator(`[data-room="${nodeId}"]`)
    const point = await center(node)
    await activateTool('Draw')
    await dragWithTool(point, { x: point.x - 45, y: point.y - 35 })
    await page.waitForFunction(() => document.querySelectorAll('.map:has(.map-drawing) .map-drawing__ink:not([data-draft])').length === 3)
    assert.equal(await read(), inCombat, 'drawing in the read-only map must not affect combat')
    await page.keyboard.press('Escape')
    assert(await peek.isVisible(), 'Escape must leave drawing mode before closing the map')
    assert.equal(await map.getByRole('button', { name: 'Draw', exact: true }).getAttribute('aria-pressed'), 'false')
    await activateTool('Erase')
    assert.equal(await map.getByRole('button', { name: 'Erase', exact: true }).getAttribute('aria-pressed'), 'true')
    const newMiddle = await inkPoint(0.5, 2)
    await dragWithTool({ x: newMiddle.x, y: newMiddle.y - 10 }, { x: newMiddle.x, y: newMiddle.y + 10 })
    assert.equal(await alphaAt(0.5, 2), 0, 'selected eraser mode must work with left mouse and touch')
    await page.mouse.move(point.x + 70, point.y - 10)
    await page.mouse.click(point.x + 70, point.y - 10, { button: 'right' })
    assert.equal(await map.getByRole('button', { name: 'Erase', exact: true }).getAttribute('aria-pressed'), 'false',
      'right-click must exit a selected tool without starting a new stroke')
    assert.equal(await paths().count(), 3)
    await activateTool('Draw')
    await dragWithTool(await inkPoint(0, 2), await inkPoint(1, 2))
    assert(await alphaAt(0.5, 2) > 100, 'new ink must be drawable over an earlier erasure')
    await page.keyboard.press('Escape')
    assert.equal(await paths().count(), 4)
    await page.screenshot({ path: `${output}/${screen}-notes.png` })
    await peek.getByRole('button', { name: 'Close', exact: true }).click()

    const other = structuredClone(run)
    other.campaign.runId += '-another-run'
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), other)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    assert.equal(await paths().count(), 0, 'new runs must not inherit previous notes')
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    await paths().first().waitFor()
    assert.equal(await paths().first().getAttribute('d'), savedPath, 'notes must restore after the provider remounts')
    assert.equal(await alphaAt(0.5), 0, 'eraser marks must persist with the old-format ink strokes')
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
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    await paths().first().waitFor()
    assert.equal(await paths().first().getAttribute('d'), savedPath)
    await activateTool('Clear drawings')
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
      assert(Math.abs(await headerGap()) <= 1, 'the online map must still meet the header')
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
    console.log(`PASS ${screen}: source-style drawing controls, eraser pixels, touch, persistence and safe navigation`)
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
