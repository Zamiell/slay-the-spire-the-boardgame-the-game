import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { CARDS } from '../src/game/cards.ts'
import { cardImagePath } from '../src/game/assets.ts'

const audit = JSON.parse(readFileSync('data/card-upgrade-layouts.json', 'utf8'))
const definitions = audit.corrections.map(({ key }) => {
  const def = Object.values(CARDS).find(def => cardImagePath(def, false).endsWith(`/${key}.webp`))
  assert(def, `Missing definition for corrected face ${key}`)
  return def
})
const output = 'artifacts/upgrade-text'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    if (process.argv.includes('--phone-only') && !phone) continue
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
      await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    await page.evaluate(ids => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.phase = 'map'
      run.neow = null
      run.players[0].deck = ids.map((defId, index) => ({ uid: `layout-${index}`, defId, upgraded: false }))
      window.__STS_DEBUG__.setRun(run)
    }, definitions.map(def => def.id))
    const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    await page.getByRole('button', { name: /^Current deck,/ }).click()
    const cards = page.locator('.card-collection .card[data-card-name]')
    const order = await cards.evaluateAll(cards => cards.map(card => card.getAttribute('data-card-name')))
    for (const card of await cards.all()) {
      const thumbnail = card.locator('.card__art')
      await thumbnail.evaluate(image => image.decode())
      assert((await thumbnail.getAttribute('src')).includes('/cards-sm/'))
    }
    if (phone) await cards.first().tap()
    else await cards.first().click()
    const inspection = page.locator('.card-inspection[open]')
    await inspection.waitFor()
    for (const [index, name] of order.entries()) {
      const def = definitions.find(def => def.name === name)
      assert(def)
      for (const upgraded of [false, true]) {
        const toggle = inspection.getByRole('checkbox', { name: 'View Upgrades', exact: true })
        if (await toggle.isChecked() !== upgraded) {
          if (phone) {
            await toggle.tap()
          }
          else await toggle.setChecked(upgraded)
          await page.waitForFunction(value =>
            document.querySelector('.card-inspection[open] input[type="checkbox"]')?.checked === value, upgraded)
        }
        assert.equal(await toggle.isChecked(), upgraded)
        const image = inspection.locator('.card__art')
        await image.evaluate(image => image.decode())
        assert((await image.getAttribute('src')).endsWith(cardImagePath(def, upgraded)))
        assert(await image.evaluate(element => {
          const box = element.getBoundingClientRect()
          return box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
        }), `${screen}/${def.id}: inspected face is clipped`)
        await page.screenshot({ path: `${output}/${screen}-${def.id}${upgraded ? '-upgraded' : '-base'}.png` })
      }
      if (index < order.length - 1) {
        await page.keyboard.press('ArrowRight')
      }
    }
    await page.keyboard.press('Escape')
    await inspection.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
      'upgrade inspection must not change owned card upgrades or game state')
    assert.deepEqual(errors, [])
    console.log(`PASS ${screen}: corrected thumbnail and full-size upgrade inspection for ${definitions.length} pairs`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
