import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/hand-layout'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { port: 0 } })
await server.listen()
const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch()
const errors = []
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1920, height: 1080 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://localhost:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const run = postNeowRun(47, [{ id: 'p1', name: 'Silent', character: 'silent' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const combat = enterRoom(run, room)
    Object.assign(combat.combat, { phase: 'player', die: 1, turn: 1, presentationEvents: [] })
    Object.assign(combat.combat.players[0], {
      hp: 9, maxHp: 9, energy: 3, relics: [], powers: [], potions: [], orbs: [null, null, null],
      hand: ['defend_silent', 'strike_silent', 'ascenders_bane', 'survivor', 'defend_silent', 'strike_silent', 'strike_silent']
        .map((defId, index) => ({ uid: `reference-${index}`, defId, upgraded: false })),
    })
    combat.combat.enemies = ['acid_slime', 'spike_slime'].map((defId, index) => ({
      ...combat.combat.enemies[0], uid: `reference-enemy-${index}`, defId, row: 0,
      hp: 20, maxHp: 20, block: 0, dead: false, isBoss: false,
    }))
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), combat)
    const cards = page.locator('.hand > .card')
    const tap = async card => {
      const point = await card.evaluate((card, webkit) => {
        const box = card.getBoundingClientRect()
        const view = visualViewport
        const x = box.x + box.width / 2
        const y = (Math.max(0, box.top) + Math.min(innerHeight - 8, box.bottom)) / 2
        return { x: (x - (webkit ? view.offsetLeft : 0)) * (webkit ? view.scale : 1),
          y: (y - (webkit ? view.offsetTop : 0)) * (webkit ? view.scale : 1) }
      }, process.argv.includes('--webkit'))
      await page.touchscreen.tap(point.x, point.y)
    }
    const settle = async () => {
      await page.waitForFunction(() => {
        const hand = document.querySelector('.hand[data-hand-layout]')
        return hand && !hand.hasAttribute('data-hand-moving') &&
          !hand.querySelector('.card--drawn') &&
          [...hand.querySelectorAll('.card__art')].every(image => image.complete && image.naturalWidth)
      })
    }
    const geometry = () => cards.evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect()
      const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform)
      return { x: box.x + box.width / 2, top: box.top, bottom: box.bottom, width: box.width,
        scale: Math.hypot(matrix.a, matrix.b), angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI }
    }))
    await settle()
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const resting = await geometry()
    assert(resting[0].angle < -8 && resting[6].angle > 8, 'seven-card hand must use the reference fan')
    assert(resting[0].top > resting[3].top && resting[6].top > resting[3].top, 'the hand must form a curved arc')
    assert(resting.every(card => card.bottom > size.height && card.top < size.height),
      'resting cards should be tucked below the screen edge, not floated fully above it')
    assert(resting.every(card => card.top > size.height * .6), 'the resting hand covers too much of the battlefield')
    assert.equal(await cards.nth(1).getAttribute('aria-keyshortcuts'), '2')
    await page.screenshot({ path: `${output}/${screen}-resting.png` })
    if (!phone) {
      const beforeSweep = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
      let previous = -1
      for (const index of [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0]) {
        const box = await cards.nth(index).boundingBox()
        await page.mouse.move(box.x + box.width / 2, size.height - 12, { steps: 2 })
        const samples = await page.evaluate(async ({ index, previous }) => {
          const cards = [...document.querySelectorAll('.hand > .card')]
          const y = card => new DOMMatrixReadOnly(getComputedStyle(card).transform).m42
          const samples = []
          for (let frame = 0; frame < 6; frame++) {
            await new Promise(requestAnimationFrame)
            samples.push({ y: y(cards[index]), previousY: previous < 0 ? null : y(cards[previous]),
              focused: cards[index].hasAttribute('data-hand-focused') })
          }
          return samples
        }, { index, previous })
        assert(samples.every(sample => sample.focused), `card ${index + 1} lost hover during the sweep`)
        assert(samples[0].y > -7.5 && samples.at(-1).y < samples[0].y,
          `card ${index + 1} must slide upward through intermediate positions, not snap: ${JSON.stringify(samples)}`)
        if (previous >= 0) assert(samples.at(-1).previousY > samples[0].previousY,
          `card ${previous + 1} must slide back down while the next card rises`)
        previous = index
      }
      await page.mouse.move(2, 2)
      await settle()
      assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeSweep,
        'sweeping the hand must not play or modify cards')
    }
    const middle = cards.nth(3)
    if (phone) await tap(middle)
    else await middle.hover()
    await settle()
    const hovered = await geometry()
    assert(Math.abs(hovered[3].scale - 1) < .001 && Math.abs(hovered[3].angle) < .1)
    assert(hovered[3].bottom <= size.height && hovered[3].bottom >= size.height - 12,
      'the focused card must be entirely readable near the bottom edge')
    assert(hovered[2].x < resting[2].x - 5 && hovered[4].x > resting[4].x + 5,
      'neighbouring cards must move aside to make room')
    assert.equal(await page.locator('.hand-scroll').evaluate(hand => hand.scrollTop), 0,
      'inspection must not vertically scroll the hand')
    await page.locator('.card-keyword-tips[data-open]').waitFor()
    await page.screenshot({ path: `${output}/${screen}-inspection.png` })
    await middle.evaluate(card => card.blur())
    await page.mouse.move(2, 2)
    if (phone) await page.touchscreen.tap(2, 2)
    await settle()
    if (!phone) {
      await page.keyboard.press('2')
      await page.waitForFunction(() => document.querySelectorAll('.enemy--targeted').length > 0)
      await page.keyboard.press('2')
      await settle()
      assert.equal(await page.locator('.enemy--targeted').count(), 0, 'number keys must use the existing selection/cancellation path')
      const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.keyboard.press('1')
      assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
        'hand shortcuts must not play behind a dialog')
      await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Back', exact: true }).click()
    } else {
      await tap(cards.first())
      assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].hand.length), 7,
        'first touch must inspect, not spend the card')
      await tap(cards.first())
      await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].hand.length === 6)
    }
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].hand = Array.from({ length: 20 }, (_, index) =>
        ({ uid: `crowded-${index}`, defId: 'defend_silent', upgraded: false }))
      window.__STS_DEBUG__.setRun(run)
    })
    await page.mouse.move(2, 2)
    await settle()
    if (!phone) {
      await page.keyboard.press('Tab')
      await cards.last().focus()
      await settle()
      assert(await page.locator('.hand-scroll').evaluate(hand => hand.scrollLeft > 0),
        'keyboard focus must reveal cards beyond the visible hand')
    }
    await cards.last().scrollIntoViewIfNeeded()
    if (phone) await tap(cards.last())
    else await cards.last().hover()
    await settle()
    assert(await cards.last().evaluate(card => {
      const box = card.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), 'oversized hands must still scroll to and inspect the last card')
    assert.equal(await page.locator('.hand-scroll').evaluate(hand => hand.scrollTop), 0)
    await page.screenshot({ path: `${output}/${screen}-large-hand.png` })
    await page.close()
    console.log(`PASS ${screen}: reference fan, hover spreading, inspection, input and large hands`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
