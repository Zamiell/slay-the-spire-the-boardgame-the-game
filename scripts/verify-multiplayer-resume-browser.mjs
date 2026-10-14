#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, setTestUsername } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { apply, chooseAscension, startRun } from './lib/rooms.mjs'
import { createCampaignProgress } from '../src/game/campaign.ts'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/multiplayer-resume-browser')
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const roomOrigin = `http://127.0.0.1:${(await rooms.listen(0)).port}`
const vite = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: roomOrigin }, '/ws': { target: roomOrigin, ws: true } } } })
let browser
const errors = []
const watch = (page) => { page.on('pageerror', (error) => errors.push(String(error))); return page }
const credentials = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('sts-room-session')))
const journal = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sts-physical-campaign')))
const pause = async (page) => {
  await page.locator('.app-shell--online').waitFor()
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog', { name: 'Slay the Spire' })
  await dialog.waitFor()
  return dialog
}
const save = async (page) => {
  await (await pause(page)).getByRole('button', { name: 'Save and disconnect', exact: true }).click()
  await page.getByRole('button', { name: 'Single Player', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('sts-room-session')), null)
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('sts-room-recoveries')))).length, 1)
}

try {
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  const contexts = []
  const pages = []
  for (const [index, viewport] of [{ width: 1440, height: 900 }, { width: 844, height: 390 }].entries()) {
    const context = await browser.newContext({ viewport })
    contexts.push(context)
    const page = watch(await context.newPage())
    pages.push(page)
    await page.goto(origin)
    await setTestUsername(page, `ResumeTester${index}`)
    await page.evaluate((progress) => localStorage.setItem('sts-physical-campaign', JSON.stringify(progress)),
      { ...createCampaignProgress(), highestAscension: index ? 5 : 2 })
    await page.reload()
    await page.getByRole('button', { name: 'Play online', exact: true }).click()
  }
  let [host, guest] = pages
  await host.getByRole('button', { name: 'Create room', exact: true }).click()
  const code = await host.locator('.online-lobby__code h1').innerText()
  await guest.getByRole('button', { name: 'Silent', exact: true }).click()
  await guest.getByLabel('Room code').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  await host.getByLabel('ResumeTester1, Silent, online').waitFor()
  const [hostCredentials, guestCredentials] = await Promise.all(pages.map(credentials))
  const room = rooms.store.rooms.get(code)
  chooseAscension(room, hostCredentials.token, 5)
  startRun(room, hostCredentials.token, { seed: 14102026 })
  room.run = { ...room.run, phase: 'map', neow: null }
  room.version += 1
  rooms.publishRoom(code)
  const before = structuredClone(room.run)
  for (const [index, page] of pages.entries()) {
    const dialog = await pause(page)
    const button = dialog.getByRole('button', { name: 'Save and disconnect', exact: true })
    await button.waitFor({ timeout: 5_000 })
    const box = await button.boundingBox()
    const viewport = page.viewportSize()
    assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
      'save action does not fit the supported screen')
    const helpFits = await dialog.locator('small').evaluate((help) => {
      const box = help.getBoundingClientRect()
      const panel = help.parentElement.getBoundingClientRect()
      return box.top >= panel.top && box.bottom <= panel.bottom && panel.bottom <= innerHeight
    })
    assert(helpFits, 'resume instructions are clipped by the pause panel')
    await page.screenshot({ path: resolve(output, `${index ? 'horizontal-phone' : 'desktop'}-pause.png`) })
    await dialog.getByRole('button', { name: 'Resume', exact: true }).click()
    await save(page)
  }
  await host.waitForFunction(async (saved) => {
    const snapshot = await fetch(`/api/rooms/${saved.code}`, { headers: { 'x-room-token': saved.token } }).then((response) => response.json())
    return snapshot.seats.every((seat) => !seat.connected)
  }, hostCredentials)
  // A new tab has no sessionStorage; the durable recovery must still be usable.
  await Promise.all(pages.map((page) => page.close()))
  rooms.sweepRooms(room.lastActivityAt + 24 * 60 * 60 * 1000 - 1)
  assert(rooms.store.rooms.has(code), 'room expired before 24 hours of inactivity')
  assert.deepEqual(room.run, before, 'saving an idle map changed the run')
  assert(room.seats.every((seat) => !seat.connected), 'save left a player connected')
  const fresh = []
  for (const [index, context] of contexts.entries()) {
    const page = watch(await context.newPage())
    fresh.push(page)
    await page.goto(origin)
    await page.getByRole('button', { name: `Resume ${code}`, exact: true }).click()
    await page.locator('.app-shell--online').waitFor()
    assert.deepEqual(await credentials(page), index ? guestCredentials : hostCredentials)
  }
  ;[host, guest] = fresh
  assert.deepEqual(room.run, before, 'resuming changed the saved run')
  assert.equal((await journal(host)).highestAscension, 2, 'borrowing an ascension granted it before a clear')

  // The guest misses the result broadcast and next-lobby transition entirely.
  await guest.context().setOffline(true)
  await save(guest)
  await guest.context().setOffline(false)
  room.run = { ...room.run, phase: 'defeat', act: 3,
    campaign: { ...room.run.campaign, bossesDefeated: 2, highestBossActDefeated: 2 } }
  room.version += 1
  rooms.publishRoom(code)
  await host.getByRole('button', { name: 'Record campaign result', exact: true }).click()
  await host.waitForFunction(() => JSON.parse(localStorage.getItem('sts-physical-campaign')).highestAscension === 6)
  apply(room, hostCredentials.token, { kind: 'returnToLobby' })
  rooms.publishRoom(code)
  await guest.getByRole('button', { name: 'Play online', exact: true }).click()
  await guest.getByRole('button', { name: `Resume ${code}`, exact: true }).click()
  await guest.waitForFunction(() => JSON.parse(localStorage.getItem('sts-physical-campaign')).highestAscension === 6)
  assert.equal((await journal(guest)).characters.silent, 0, 'ascension sync copied room campaign marks')

  // Return to the existing solo shell without reloading: it must see the unlock too.
  await host.getByRole('button', { name: 'Leave room', exact: true }).click()
  await host.getByRole('button', { name: 'Single Player', exact: true }).click()
  await host.getByRole('button', { name: 'Standard', exact: true }).click()
  for (let level = 0; level < 6; level++) await host.getByRole('button', { name: 'Increase Ascension' }).click()
  await host.getByText('Ascension 6', { exact: true }).waitFor()
  assert(await host.getByRole('button', { name: 'Increase Ascension', includeHidden: true }).isDisabled())
  await host.reload()
  assert.equal((await journal(host)).highestAscension, 6, 'solo mount overwrote the multiplayer unlock')

  await guest.getByRole('button', { name: 'Leave room', exact: true }).click()
  // A separate room proves expiry after the same inactivity interval.
  await guest.getByRole('button', { name: 'Play online', exact: true }).click()
  await guest.getByRole('button', { name: 'Create room', exact: true }).click()
  const expiringCode = await guest.locator('.online-lobby__code h1').innerText()
  const expiring = rooms.store.rooms.get(expiringCode)
  rooms.sweepRooms(expiring.lastActivityAt + 24 * 60 * 60 * 1000 + 1)
  await guest.getByRole('alert').filter({ hasText: 'session has ended' }).waitFor()
  assert.equal(rooms.store.rooms.has(expiringCode), false)
  assert.equal(await guest.evaluate(() => localStorage.getItem('sts-room-recoveries')), null)
  assert.deepEqual(errors, [])
  console.log('✓ multiplayer saves resume in fresh tabs within 24h; earned ascensions survive missed results, lobby changes, solo navigation, and reload; expired recoveries clear')
} catch (error) {
  for (const [index, context] of (browser?.contexts() ?? []).entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page.screenshot({ path: resolve(output, `failure-${index}-${pageIndex}.png`) }).catch(() => {})
    }
  }
  throw error
} finally {
  await browser?.close()
  await rooms.close()
  await vite.close()
}
