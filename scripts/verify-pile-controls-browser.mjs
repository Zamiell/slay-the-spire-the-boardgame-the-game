import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/pile-controls'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1920, height: 1080 }, false],
    ['compact-desktop', { width: 1280, height: 720 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const fixture = enterRoom(run, room)
    fixture.campaign.runId = `pile-controls-${screen}`
    Object.assign(fixture.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined })
    const cards = (kind, count) => Array.from({ length: count }, (_, index) =>
      ({ uid: `${kind}-${index}`, defId: 'strike_ironclad', upgraded: false }))
    Object.assign(fixture.combat.players[0], {
      relics: [], hand: cards('hand', 10), draw: cards('draw', 123),
      discard: cards('discard', 12), exhaust: [],
    })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
    await page.locator('.hand .card').first().waitFor()
    await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving], .card-morph, .hand .card--drawn'))
    await page.locator('.pile__stack').evaluateAll(images => Promise.all(images.map(image => image.decode())))
    const geometry = await page.locator('.pile').evaluateAll(piles => piles.map(pile => {
      const box = pile.getBoundingClientRect()
      const icon = pile.querySelector('.pile__stack').getBoundingClientRect()
      const count = pile.querySelector('.pile__count')
      const badge = count.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      const endTurn = document.querySelector('.combat__end-turn').getBoundingClientRect()
      const energy = document.querySelector('.pip--energy').getBoundingClientRect()
      const overlaps = other => box.left < other.right && box.right > other.left &&
        box.top < other.bottom && box.bottom > other.top
      return {
        kind: pile.dataset.pile, iconWidth: icon.width, iconHeight: icon.height,
        count: count.textContent, fontSize: parseFloat(getComputedStyle(count).fontSize),
        inViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        badgeFits: badge.left >= box.left && badge.right <= box.right &&
          badge.top >= box.top && badge.bottom <= box.bottom,
        clickable: pile.contains(hit), overlapsHud: overlaps(endTurn) || overlaps(energy),
      }
    }))
    assert.equal(geometry.length, 3)
    // At 1080p the official STS2 screenshot shows roughly 75px of card art.
    // Our padded 256px assets need a 96px canvas to produce that visible size.
    for (const pile of geometry) {
      assert(pile.iconWidth >= 64 && pile.iconWidth <= 96 && pile.iconHeight === pile.iconWidth,
        `${screen}: pile size ${JSON.stringify(pile)}`)
      if (screen === 'desktop') assert.equal(pile.iconWidth, 96)
      assert(pile.fontSize >= 16 && pile.inViewport && pile.badgeFits && pile.clickable && !pile.overlapsHud,
        `${screen}: pile overlaps or is unreadable ${JSON.stringify(pile)}`)
    }
    assert.deepEqual(geometry.map(pile => pile.count), ['123', '12', '0'])
    await page.screenshot({ path: `${output}/${screen}.png` })
    const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    for (const [kind, label, count] of [['draw', 'Draw pile', 123], ['discard', 'Discard pile', 12], ['exhaust', 'Exhaust pile', 0]]) {
      const trigger = page.locator(`[data-pile="${kind}"]`)
      if (phone) await trigger.tap()
      else await trigger.click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await dialog.waitFor()
      assert.equal(await dialog.locator('.choice-modal__cards .card').count(), count)
      if (count === 0) assert(await dialog.getByText('No cards.', { exact: true }).isVisible())
      await dialog.getByRole('button', { name: 'Back', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
      'pile inspection must not change the run')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: STS2-scale piles, count badges, HUD clearance and inspection`)
  }
} finally {
  await browser.close()
  await server.close()
}
