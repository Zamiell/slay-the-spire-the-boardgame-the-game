import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom, resolveCombat } from '../src/game/run.ts'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom } from './lib/rooms.mjs'

const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: {
  '/api': { target: `http://127.0.0.1:${address.port}` },
  '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true },
} } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.playedEffects = []
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...args) {
        const result = play.apply(this, args)
        if (this instanceof HTMLAudioElement && /\/sfx\//.test(this.src)) {
          window.playedEffects.push({ path: new URL(this.src).pathname, volume: this.volume, muted: this.muted })
        }
        return result
      }
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    const audio = await page.evaluate(async () => {
      const response = await fetch('/assets/sfx/gold.wav')
      if (!response.ok) throw new Error(`Gold sound request failed: ${response.status}`)
      const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await response.arrayBuffer())
      const samples = buffer.getChannelData(0)
      let peak = 0, sum = 0, tail = 0
      for (let index = 0; index < samples.length; index++) {
        if (!Number.isFinite(samples[index])) throw new Error('Invalid gold audio sample')
        peak = Math.max(peak, Math.abs(samples[index]))
        sum += samples[index] ** 2
        if (index >= samples.length - 240) tail = Math.max(tail, Math.abs(samples[index]))
      }
      return { duration: buffer.duration, channels: buffer.numberOfChannels,
        peak, rms: Math.sqrt(sum / samples.length), first: samples[0], tail }
    })
    assert(audio.duration > .5 && audio.duration < .9, 'the coin cascade should remain a short UI effect')
    assert.equal(audio.channels, 1)
    assert(audio.peak > .4 && audio.peak < .8 && audio.rms > .02, 'the jingle must be audible and have clipping headroom')
    assert(Math.abs(audio.first) < .001 && audio.tail < .005, 'audio boundaries must not click')

    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const run = postNeowRun(47, [{ id: 'p1', name: 'Gold sound', character: 'ironclad' }])
    const fight = enterRoom(run, run.map.rows[0][0])
    fight.combat.enemies[0].goldReward = 3
    fight.combat.phase = 'won'
    fight.combat.enemies.forEach(enemy => { enemy.dead = true; enemy.hp = 0 })
    const loot = resolveCombat(fight)
    const amount = loot.rewards[0].gold
    assert(amount > 0)
    const gold = page.locator('.loot-choice[data-sfx="gold"]')
    const stage = async () => {
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), loot)
      await gold.waitFor()
      await page.evaluate(() => { window.playedEffects = [] })
    }
    await stage()
    await gold.click({ button: 'right' })
    assert.deepEqual(await page.evaluate(() => window.playedEffects), [], 'right-clicking Gold must not play the jingle')
    await gold.evaluate(button => { button.disabled = true })
    await gold.click({ force: true })
    assert.deepEqual(await page.evaluate(() => window.playedEffects), [], 'disabled rewards must remain silent')
    await gold.evaluate(button => { button.disabled = false })
    if (phone) await gold.tap()
    else await gold.click()
    await gold.waitFor({ state: 'detached' })
    const played = await page.evaluate(() => window.playedEffects)
    assert.deepEqual(played.map(sound => sound.path), ['/assets/sfx/gold.wav'], 'Gold must play only its dedicated effect, not the generic click')
    assert(played[0].volume > 0 && played[0].muted, 'automation must remain muted while exercising volume controls')
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].gold), loot.players[0].gold + amount)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'audio', exact: true }).click()
    await settings.getByRole('slider', { name: 'Sound effects volume', exact: true }).press('Home')
    await settings.getByRole('button', { name: /Back/ }).click()
    await stage()
    await gold.click()
    await gold.waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.playedEffects), [], 'muting SFX must also mute Gold')

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.getByRole('button', { name: 'audio', exact: true }).click()
    await settings.getByRole('slider', { name: 'Sound effects volume', exact: true }).press('End')
    await settings.getByRole('button', { name: /Back/ }).click()
    await stage()
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.playedEffects.map(sound => sound.path)), ['/assets/sfx/ui.ogg'],
      'skipping Gold is not a coin pickup')

    const room = createRoom(rooms.store)
    const seat = joinRoom(room, { name: 'Gold sound', character: 'ironclad' })
    room.phase = 'run'
    room.run = structuredClone(loot)
    room.run.players[0].id = seat.playerId
    room.run.rewards.forEach(offer => { offer.playerId = seat.playerId })
    room.version++
    await page.evaluate(session => sessionStorage.setItem('sts-room-session', JSON.stringify(session)),
      { code: room.code, token: seat.token })
    await page.reload()
    await gold.waitFor()
    await page.evaluate(() => { window.playedEffects = [] })
    await gold.click()
    await gold.waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.playedEffects.map(sound => sound.path)), ['/assets/sfx/gold.wav'])
    assert.equal(room.run.players[0].gold, loot.players[0].gold + amount)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: coin audio decodes, Gold claims sound once, mute/disabled/skip stay correct, online claims match`)
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
