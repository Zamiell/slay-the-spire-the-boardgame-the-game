import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom, startRun } from './lib/rooms.mjs'
import { installScreenAudit } from './lib/browser-screen-audit.mjs'
import { checkRewardSweep } from './lib/reward-hover.mjs'
import { cardDef } from '../src/game/cards.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'artifacts/neow-viewport')
mkdirSync(out, { recursive: true })
const rooms = createRoomServer({ maxUpgradesPerWindow: 100 })
const address = await rooms.listen(0)
const target = `http://127.0.0.1:${address.port}`
const server = await createServer({ root, logLevel: 'silent', server: { port: 0, proxy: {
  '/api': { target }, '/ws': { target, ws: true },
} } })
await server.listen()
const origin = `http://localhost:${server.httpServer.address().port}`
const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch()
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const phone = viewport.width === 844
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    const page = installScreenAudit(await context.newPage())
    await page.addInitScript(() => {
      window.__NEOW_SOCKETS__ = []
      window.WebSocket = new Proxy(window.WebSocket, { construct(Target, args) {
        const socket = new Target(...args)
        window.__NEOW_SOCKETS__.push(socket)
        return socket
      } })
    })
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    async function capture(label) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const layout = await page.evaluate(() => {
        const scene = document.querySelector('.neow-screen').getBoundingClientRect()
        const action = document.querySelector('.neow-action').getBoundingClientRect()
        const buttons = [...document.querySelectorAll('.neow-action button')].filter(button => !button.disabled)
        return { height: innerHeight, width: innerWidth, scene: scene.toJSON(), action: action.toJSON(),
          scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth,
          overflowing: [...document.querySelectorAll('body *')].filter(element => {
            const box = element.getBoundingClientRect()
            return box.width > 0 && box.right > innerWidth + 1
          }).slice(0, 12).map(element => ({ tag: element.tagName, className: element.getAttribute('class'),
            box: element.getBoundingClientRect().toJSON() })),
          buttons: buttons.map(button => ({ text: button.textContent, rect: button.getBoundingClientRect().toJSON() })) }
      })
      assert(layout.scene.bottom <= layout.height + 1, `${label}: Neow extends below viewport`)
      assert(layout.action.top >= layout.scene.top && layout.action.bottom <= layout.height + 1, `${label}: controls extend outside scene`)
      assert(layout.scrollHeight <= layout.height + 1, `${label}: document scrolls vertically`)
      if (layout.scrollWidth > layout.width + 1) await page.screenshot({ path: join(out, `${label}-${viewport.width}-overflow.png`) })
      assert(layout.scrollWidth <= layout.width + 1, `${label}: document scrolls horizontally ${JSON.stringify(layout.overflowing)}`)
      for (const button of layout.buttons) {
        assert(button.rect.left >= 0 && button.rect.right <= layout.width + 1, `${label}: ${button.text} overflows horizontally`)
      }
      // Only the party list or the action panel may scroll; never the game viewport.
      for (const button of await page.locator('.neow-action button:enabled').all()) {
        await button.scrollIntoViewIfNeeded()
        const scrollSize = () => {
          const panel = document.querySelector('.neow-action')
          return { x: panel.scrollWidth > panel.clientWidth + 1, y: panel.scrollHeight > panel.clientHeight + 1 }
        }
        await page.mouse.move(0, 0)
        await page.evaluate(() => document.activeElement?.blur())
        await page.waitForTimeout(250)
        const before = await page.evaluate(scrollSize)
        await button.hover()
        await page.waitForTimeout(250)
        const hovered = await page.evaluate(scrollSize)
        assert(!hovered.x || before.x, `${label}: hover created horizontal scrolling`)
        assert(!hovered.y || before.y, `${label}: hover created vertical scrolling`)
        await button.focus()
        assert(await button.evaluate(element => {
          const box = element.getBoundingClientRect()
          return box.top >= 0 && box.bottom <= innerHeight + 1 &&
            element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        }), `${label}: control cannot be reached`)
      }
      assert.equal(await page.evaluate(() => scrollY), 0, `${label}: reaching a control scrolled the page`)
      await page.screenshot({ path: join(out, `${label}-${viewport.width}.png`) })
    }
    await page.goto(origin)
    await page.getByRole('button', { name: 'Single Player', exact: true }).click()
    await page.getByRole('button', { name: 'Standard', exact: true }).click()
    await page.getByRole('button', { name: 'Embark' }).click()
    await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
    await page.getByRole('heading', { name: 'Neow’s Blessing' }).waitFor()
    await page.evaluate(() => window.__STS_DEBUG__.reset(1, 'neow-viewport'))
    await page.locator('.reward-screen--card-choice').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Reveal Card Reward', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Skip unseen', exact: true }).count(), 0)
    const opening = await page.evaluate(() => window.__STS_DEBUG__.getRun().neow)
    await page.reload()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.locator('.reward-screen--card-choice').waitFor()
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().neow), opening,
      'reloading must preserve the automatically revealed offer')
    if (!phone) {
      const card = page.locator('.reward-screen__cards .card').first()
      await page.locator('.reward-screen--card-choice').evaluate(async element =>
        Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)))
      const previousMotion = await page.evaluate(() => document.documentElement.dataset.reducedMotion)
      for (const mode of ['system', 'game']) {
        await page.emulateMedia({ reducedMotion: mode === 'system' ? 'reduce' : 'no-preference' })
        await page.evaluate(mode => { document.documentElement.dataset.reducedMotion = String(mode === 'game') }, mode)
        await page.mouse.move(5, 5)
        if (mode === 'system') await checkRewardSweep(page, page.locator('.reward-screen__cards .card'))
        const resting = await card.boundingBox()
        await card.hover()
        await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
        const hovered = await card.boundingBox()
        assert(Math.abs(hovered.width / resting.width - 1.25) < .01,
          `${mode}: reduced motion suppressed Neow reward inspection`)
        assert(await card.evaluate((element, mode) => {
          const durations = getComputedStyle(element).transitionDuration.split(',').map(parseFloat)
          return mode === 'game' ? durations.every(duration => duration <= .001) : durations.some(duration => duration >= .5)
        }, mode), `${mode}: only the in-game reduced-motion setting disables reward animation`)
        await page.locator('.card-keyword-tips[data-open]').waitFor()
        await page.mouse.move(5, 5)
        await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
        assert(Math.abs((await card.boundingBox()).width - resting.width) < 1,
          `${mode}: inspection must return to its resting size`)
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate(previous => {
        if (previous === undefined) delete document.documentElement.dataset.reducedMotion
        else document.documentElement.dataset.reducedMotion = previous
      }, previousMotion)
    }
    await page.screenshot({ path: join(out, `reward-${viewport.width}.png`) })
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await page.locator('.neow-options').waitFor()
    await capture('choices')
    const goldFixture = await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.neow.players[run.players[0].id].cardId = 'neow_03'
      window.__STS_DEBUG__.setRun(run)
      return run
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().neow.players.p1.cardId === 'neow_03')
    await page.getByRole('button', { name: /Gain 5 Gold/ }).click()
    await page.locator('.map').waitFor()
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].gold),
      goldFixture.players[0].gold + 7, 'Gold must be granted immediately, followed by the solo completion bonus')
    assert.equal(await page.getByRole('button', { name: 'Gain reward', exact: true }).count(), 0)
    const rareFixture = structuredClone(goldFixture)
    rareFixture.neow.players.p1.cardId = 'neow_02'
    const rare = rareFixture.players[0].rareRewards[0]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), rareFixture)
    await page.getByRole('button', { name: /Gain 1 random Rare card/ }).click()
    await page.locator('.map').waitFor()
    await page.locator('.card-morph--gain').waitFor()
    assert.equal(await page.locator('.card-morph--gain .card').getAttribute('data-card-name'), cardDef(rare).name,
      'automatically gaining a random Rare must still reveal the gained card')
    assert.equal(await page.getByRole('button', { name: 'Gain reward', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Skip reward', exact: true }).count(), 0)
    let rarePlayer = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0])
    assert.equal(rarePlayer.deck.length, rareFixture.players[0].deck.length + 1)
    assert.equal(rarePlayer.deck.at(-1).defId, rare)
    assert.deepEqual(rarePlayer.rareRewards, rareFixture.players[0].rareRewards.slice(1))
    await page.locator('.card-morph--gain').waitFor({ state: 'detached' })
    const legacyRare = structuredClone(rareFixture)
    Object.assign(legacyRare.neow.players.p1, { blueOption: 1, pendingEffect: { kind: 'randomRare' } })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), legacyRare)
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('sts-solo-run'))?.run.neow?.players.p1.pendingEffect?.kind === 'randomRare')
    for (let reload = 0; reload < 2; reload++) {
      await page.reload()
      await page.getByRole('button', { name: 'Resume', exact: true }).click()
      await page.locator('.map').waitFor()
      rarePlayer = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0])
      assert.equal(rarePlayer.deck.length, rareFixture.players[0].deck.length + 1)
      assert.equal(rarePlayer.deck.at(-1).defId, rare)
      assert.deepEqual(rarePlayer.rareRewards, rareFixture.players[0].rareRewards.slice(1))
    }
    const legacyGold = structuredClone(goldFixture)
    Object.assign(legacyGold.neow.players.p1, { blueOption: 1, pendingEffect: { kind: 'gold', amount: 5 } })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), legacyGold)
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('sts-solo-run'))?.run.neow?.players.p1.pendingEffect?.kind === 'gold')
    for (let reload = 0; reload < 2; reload++) {
      await page.reload()
      await page.getByRole('button', { name: 'Resume', exact: true }).click()
      await page.locator('.map').waitFor()
      assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].gold),
        goldFixture.players[0].gold + 7, 'restoring an old Gold confirmation must grant it exactly once')
    }

    // Use the real online wrapper and server-owned mixed-party Heart's Boon state.
    const room = createRoom(rooms.store)
    const seats = ['guardian', 'silent', 'defect', 'watcher'].map(character => joinRoom(room, { character, name: character }))
    startRun(room, seats[0].token, { seed: 'neow-viewport' })
    room.run.neow.players[seats[0].playerId].cardId = 'heart_boon_00'
    await page.evaluate(saved => sessionStorage.setItem('sts-room-session', JSON.stringify(saved)), { code: room.code, token: seats[0].token })
    await page.reload()
    await page.locator('.app-shell--online .neow-screen').waitFor()
    await page.locator('.connection--connected').waitFor()
    await page.getByRole('heading', { name: 'The Heart’s Boon', exact: true }).waitFor()
    assert.match(await page.locator('.neow-face--active .neow-face__red').textContent(), /Card Reward/)
    assert.equal(await page.locator('.neow-face--active .neow-face__red').getByText('3 Card Rewards', { exact: true }).count(), 0)
    await page.locator('.reward-screen--card-choice').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Reveal Card Reward', exact: true }).count(), 0)
    assert.equal(room.run.players[0].gold, 3)
    await page.screenshot({ path: join(out, `party-reward-${viewport.width}.png`) })
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await page.locator('.neow-options').waitFor()
    assert.equal(room.run.neow.players[seats[0].playerId].redRewardsRemaining, 0)
    assert.equal(await page.getByRole('button', { name: 'Gain 2 Gold and 2 Potions.' }).count(), 1)
    await capture('party-choices')
    const faces = page.locator('.neow-faces')
    await faces.evaluate(element => { element.scrollTop = element.scrollHeight })
    assert(await faces.locator('.neow-face').last().evaluate(element => {
      const box = element.getBoundingClientRect()
      const list = element.parentElement.getBoundingClientRect()
      return box.bottom <= list.bottom + 1 && box.bottom <= innerHeight
    }), 'last party blessing is clipped')
    await context.setOffline(true)
    await page.evaluate(() => window.__NEOW_SOCKETS__.at(-1).close())
    await page.locator('.connection--reconnecting').waitFor()
    await capture('party-disconnected')
    const relic = page.locator('.app-shell__header .relic-chip').first()
    await relic.focus()
    await relic.locator('.relic-tip').waitFor({ state: 'visible' })
    assert(await relic.locator('.relic-tip').evaluate(tip => {
      const box = tip.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), 'reconnecting must not push the relic explanation outside the viewport')
    await page.keyboard.press('Escape')
    await relic.evaluate(element => element.blur())
    assert.equal(await page.locator('.neow-action button:enabled').count(), 0)
    await context.setOffline(false)
    // Reconnect preserves the viewer and pending choices in the same bounded shell.
    await page.reload()
    await page.locator('.connection--connected').waitFor()
    await page.locator('.neow-options').waitFor()
    await capture('party-reconnected')
    assert.equal(await page.locator('.neow-face--active .neow-face__owner strong').textContent(), 'guardian')
    assert.equal(room.run.players[0].gold, 3, 'reconnect must not duplicate the opening Gold')
    await page.getByRole('button', { name: /Gain 2 Gold and 2 Potions/ }).click()
    await page.getByRole('button', { name: 'Reveal Potion', exact: true }).waitFor()
    assert.equal(room.run.players[0].gold, 5, 'the server must grant the chosen Boon Gold without a second action')
    assert.equal(room.run.neow.players[seats[0].playerId].pendingEffect, null)
    assert.equal(room.run.neow.players[seats[0].playerId].rewardKind, 'potion')
    assert.equal(await page.getByRole('button', { name: 'Gain reward', exact: true }).count(), 0)
    const rareRoom = createRoom(rooms.store)
    const rareOwner = joinRoom(rareRoom, { character: 'watcher', name: 'Rare owner' })
    joinRoom(rareRoom, { character: 'silent', name: 'Other seat' })
    startRun(rareRoom, rareOwner.token, { seed: 'neow-random-rare' })
    rareRoom.run.neow.players[rareOwner.playerId].cardId = 'neow_02'
    await page.evaluate(saved => sessionStorage.setItem('sts-room-session', JSON.stringify(saved)),
      { code: rareRoom.code, token: rareOwner.token })
    await page.reload()
    await page.locator('.connection--connected').waitFor()
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await page.locator('.neow-options').waitFor()
    const ownerBefore = structuredClone(rareRoom.run.players[0])
    const peerBefore = structuredClone(rareRoom.run.players[1])
    await page.getByRole('button', { name: /Gain 1 random Rare card/ }).click()
    await page.locator('.neow-face--active.neow-face--done').waitFor()
    await page.locator('.card-morph--gain').waitFor()
    assert.equal(await page.locator('.card-morph--gain .card').getAttribute('data-card-name'),
      cardDef(ownerBefore.rareRewards[0]).name)
    assert.equal(rareRoom.run.players[0].deck.length, ownerBefore.deck.length + 1)
    assert.equal(rareRoom.run.players[0].deck.at(-1).defId, ownerBefore.rareRewards[0])
    assert.deepEqual(rareRoom.run.players[0].rareRewards, ownerBefore.rareRewards.slice(1))
    assert.deepEqual(rareRoom.run.players[1], peerBefore)
    assert.equal(rareRoom.run.neow.players[rareOwner.playerId].pendingEffect, null)
    assert.equal(await page.getByRole('button', { name: 'Gain reward', exact: true }).count(), 0)
    await page.reload()
    await page.locator('.connection--connected').waitFor()
    await page.locator('.neow-face--active.neow-face--done').waitFor()
    assert.equal(rareRoom.run.players[0].deck.length, ownerBefore.deck.length + 1, 'reconnect must not repeat the Rare gain')
    assert.deepEqual(errors, [])
    console.log(`Neow viewport checks passed: ${viewport.width}x${viewport.height}${phone ? ' touch' : ' desktop'}`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
