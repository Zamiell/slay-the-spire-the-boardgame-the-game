import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/card-tooltips'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['horizontal-phone', { width: 844, height: 390 }],
  ]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const longCard = await page.evaluate(async () => {
      const [{ CARDS }, { cardKeywordTips }] = await Promise.all([
        import('/src/game/cards.ts'), import('/src/ui/Card.tsx'),
      ])
      return Object.values(CARDS).sort((a, b) =>
        cardKeywordTips(b).reduce((sum, tip) => sum + tip.text.length, 0) -
        cardKeywordTips(a).reduce((sum, tip) => sum + tip.text.length, 0))[0].id
    })
    for (const [kind, defId] of [['default', 'survivor'], ['overflow', longCard]]) {
      await page.mouse.move(2, 2)
      const run = postNeowRun(47, [{ id: 'p1', name: 'Silent', character: 'silent' }])
      const room = run.map.rows[0][0]
      run.map.rooms[room].kind = 'encounter'
      const next = enterRoom(run, room)
      next.combat.combatId = `tooltip-${kind}`
      next.combat.players[0].hand = ['strike_silent', defId, 'defend_silent'].map((defId, index) =>
        ({ uid: `${kind}-${index}`, defId, upgraded: false }))
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), next)
      await page.waitForFunction(id => window.__STS_DEBUG__.getRun().combat?.combatId === id, next.combat.combatId)
      await page.waitForFunction(() => {
        const hand = document.querySelector('.hand[data-hand-layout]')
        return hand && hand.querySelectorAll('.card').length === 3 &&
          !hand.hasAttribute('data-hand-moving') && !hand.querySelector('.card--drawn') &&
          [...hand.querySelectorAll('.card__art')].every(image => image.complete && image.naturalWidth)
      })
      const card = page.locator('.hand > .card').nth(1)
      await card.hover()
      const tooltipId = await card.getAttribute('data-keyword-help-id')
      const tooltip = page.locator(`[id=${JSON.stringify(tooltipId)}]`)
      await tooltip.waitFor()
      const samples = await card.evaluate(async card => {
        const samples = []
        for (let frame = 0; frame < 12; frame++) {
          await new Promise(requestAnimationFrame)
          const box = card.getBoundingClientRect()
          const tip = document.getElementById(card.dataset.keywordHelpId).getBoundingClientRect()
          samples.push({ gap: tip.left - box.right, top: tip.top,
            expectedTop: Math.max(8, Math.min(box.top, innerHeight - tip.height - 8)) })
        }
        return samples
      })
      assert(samples.every(sample => Math.abs(sample.gap - 9) < 3 &&
        Math.abs(sample.top - sample.expectedTop) < 3),
      `${screen}/${kind}: tooltip detached from the moving card: ${JSON.stringify(samples)}`)
      await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
      if (kind === 'overflow') {
        assert(await tooltip.evaluate(tip => {
          const card = document.querySelector(`[data-keyword-help-id="${CSS.escape(tip.id)}"]`).getBoundingClientRect()
          const box = tip.getBoundingClientRect()
          return box.top < card.top && box.bottom <= innerHeight - 7
        }), `${screen}: long stacks should move upward, not away from the card`)
        if (await tooltip.evaluate(tip => tip.scrollHeight > tip.clientHeight)) {
          await page.keyboard.down('Shift')
          await page.keyboard.press('End')
          assert(await tooltip.evaluate(tip => tip.scrollTop > 0), 'overflowing help must remain scrollable when pinned')
          await page.keyboard.up('Shift')
        }
      }
      await page.screenshot({ path: `${output}/${screen}-${kind}.png` })
      await page.keyboard.press('Escape')
      await tooltip.waitFor({ state: 'hidden' })
    }
    const beforeDeck = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    await page.getByRole('button', { name: /^Current deck,/ }).click()
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    for (const upgraded of [false, true]) {
      if (upgraded) await deck.getByLabel('Current deck upgrade preview').check()
      const card = deck.locator(`.card[title="${upgraded ? 'Survivor+' : 'Survivor'}"]`)
      await card.hover()
      const id = await card.getAttribute('data-keyword-help-id')
      const tip = deck.locator(`[id=${JSON.stringify(id)}]`)
      await tip.waitFor()
      assert.match(await tip.innerText(), /Block/)
      assert(await tip.evaluate(tip => {
        const card = document.querySelector(`[data-keyword-help-id="${CSS.escape(tip.id)}"]`).getBoundingClientRect()
        const box = tip.getBoundingClientRect()
        return tip.closest('dialog')?.open && Math.abs(box.left - card.right - 9) < 2 &&
          Math.abs(box.top - Math.max(8, Math.min(card.top, innerHeight - box.height - 8))) < 2
      }), `${screen}: deck help must appear beside the card inside the modal's top layer`)
      const tipBox = await tip.boundingBox()
      await page.mouse.move(tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2)
      assert.equal(await tip.getAttribute('data-open'), null,
        'entering the tooltip must immediately close it rather than extend card hover')
      await card.hover()
      await tip.waitFor()
      await page.mouse.move(2, 2)
      assert.equal(await tip.getAttribute('data-open'), null,
        'leaving the card must close its tooltip without a grace period')
      await card.hover()
      await tip.waitFor()
      assert.equal(await card.getAttribute('aria-disabled'), 'true')
      const box = await card.boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeDeck,
        'inspecting a deck card must not play it or modify the run')
      await page.screenshot({ path: `${output}/${screen}-deck${upgraded ? '-upgraded' : ''}.png` })
    }
    await deck.locator('.card-keyword-tips[data-open]').waitFor()
    await page.keyboard.press('Escape')
    await deck.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.card-collection .card-keyword-tips[data-open]').count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: card-side tooltip alignment, animation tracking and upward overflow`)
  }
} finally {
  await browser.close()
  await server.close()
}
