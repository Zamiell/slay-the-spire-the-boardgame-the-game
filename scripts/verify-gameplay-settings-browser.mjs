import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { resumeNeow } from '../src/game/run.ts'

const output = 'artifacts/gameplay-settings'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { port: 0, proxy: {
  '/api': { target: `http://127.0.0.1:${address.port}` },
  '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true },
} } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const origin = `http://localhost:${server.httpServer.address().port}`
async function gameplay(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: 'gameplay', exact: true }).click()
  return { dialog, checkbox: dialog.getByRole('checkbox', { name: /^Prevent Duplicate Card Rewards/ }) }
}
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(origin)
    let controls = await gameplay(page)
    assert.equal(await controls.checkbox.isChecked(), false, 'duplicate prevention must default off')
    await controls.checkbox.check()
    await controls.dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await page.reload()
    controls = await gameplay(page)
    assert(await controls.checkbox.isChecked(), 'the gameplay preference did not survive a refresh')
    await controls.dialog.getByRole('button', { name: 'Reset settings', exact: true }).click()
    assert.equal(await controls.checkbox.isChecked(), false)
    await controls.checkbox.check()
    assert(await controls.checkbox.evaluate(input => {
      const box = input.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), `${screen}: the gameplay checkbox is clipped`)
    await page.screenshot({ path: `${output}/${screen}.png` })
    await controls.dialog.getByRole('button', { name: 'Back', exact: true }).click()
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().meta.preventDuplicateCardRewards), true)
    await page.evaluate(async () => {
      const { resumeNeow } = await import('/src/game/run.ts')
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.players[0].cardRewards = ['anger', 'anger', 'cleave', 'shrug_it_off']
      run.neow.players[run.players[0].id].redReward = null
      window.__STS_DEBUG__.setRun(resumeNeow(run))
    })
    await page.locator('.reward-screen--card-choice').waitFor()
    assert.deepEqual(await page.evaluate(() => {
      const run = window.__STS_DEBUG__.getRun()
      return run.neow.players[run.players[0].id].redReward.choices
    }), ['anger', 'cleave', 'shrug_it_off'])
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    controls = await gameplay(page)
    await controls.checkbox.uncheck()
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().meta.preventDuplicateCardRewards), true,
      'changing a new-run preference must not rewrite an active run')
    await controls.dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('sts-solo-run'))?.run.meta.preventDuplicateCardRewards === true)
    await page.close()

    const online = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    online.on('pageerror', error => errors.push(String(error)))
    await online.goto(origin)
    controls = await gameplay(online)
    await controls.checkbox.check()
    await controls.dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await online.getByRole('button', { name: 'Play online', exact: true }).click()
    await online.getByRole('button', { name: 'Create room', exact: true }).click()
    await online.locator('.online-lobby').waitFor()
    await online.locator('.online-lobby__start').click()
    await online.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
    await online.locator('.reward-screen--card-choice').waitFor()
    const session = await online.evaluate(() => JSON.parse(sessionStorage.getItem('sts-room-session')))
    const room = rooms.store.rooms.get(session.code)
    assert.equal(room.run.meta.preventDuplicateCardRewards, true, 'the host preference did not reach the server')
    room.run.players[0].cardRewards = ['anger', 'anger', 'cleave', 'shrug_it_off']
    room.run.neow.players[room.seats[0].playerId].redReward = null
    room.run = resumeNeow(room.run)
    room.version++
    rooms.publishRoom(session.code)
    await online.locator('.reward-screen--card-choice').waitFor()
    assert.deepEqual(room.run.neow.players[room.seats[0].playerId].redReward.choices, ['anger', 'cleave', 'shrug_it_off'])
    await online.close()
    console.log(`PASS ${screen}: default, persistence, reset, new solo run and authoritative online rewards`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
