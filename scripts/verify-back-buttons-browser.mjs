import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'

const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
mkdirSync('artifacts/back-buttons', { recursive: true })
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const noHelp = async button => {
      assert.equal(await button.getAttribute('data-keyword-help-id'), null)
      assert.equal(await button.getAttribute('title'), null)
      assert.equal(await button.getAttribute('aria-label'), 'Back')
    }
    const motion = async button => {
      await noHelp(button)
      await page.mouse.move(0, 0)
      await page.evaluate(() => document.activeElement?.blur())
      await page.waitForTimeout(550)
      const resting = await button.boundingBox()
      if (!phone) {
        await button.evaluate(element => {
          element.backHover = null
          const capture = event => {
            if (event.target !== element || event.propertyName !== 'scale') return
            const animation = element.getAnimations().find(animation => animation.transitionProperty === 'scale')
            animation.pause()
            element.backHover = animation
            element.removeEventListener('transitionrun', capture)
          }
          element.addEventListener('transitionrun', capture)
        })
        await button.hover()
        await page.waitForFunction(() => [...document.querySelectorAll('.ribbon-back')].some(element => element.backHover))
        const tween = await button.evaluate(element => {
          const animation = element.backHover
          const duration = animation.effect.getTiming().duration
          const widths = [0, duration / 2, duration].map(time => {
            animation.currentTime = time
            return element.getBoundingClientRect().width
          })
          animation.finish()
          element.backHover = null
          return { duration, widths }
        })
        assert.equal(tween.duration, 50)
        assert(tween.widths[0] < tween.widths[1] && tween.widths[1] < tween.widths[2],
          'the whole ribbon must animate, not just its arrow')
      } else {
        await page.keyboard.press('Tab')
        await button.focus()
      }
      await page.waitForTimeout(90)
      const hovered = await button.boundingBox()
      assert(Math.abs(hovered.width / resting.width - 1.05) < 0.005)
      assert.equal(await button.evaluate(element => getComputedStyle(element, '::before').opacity), '1')
      assert.equal(await button.locator('span').evaluate(element => getComputedStyle(element).translate), 'none',
        'the old arrow-only nudge must not stack with the full ribbon animation')
      assert.equal(await page.locator('.card-keyword-tips[data-open]').filter({ hasText: /^Back$/ }).count(), 0)
      await page.screenshot({ path: `artifacts/back-buttons/${screen}-hover.png` })
      if (!phone) {
        await page.mouse.down()
        await page.waitForTimeout(280)
        assert.equal(await button.evaluate(element => getComputedStyle(element).scale), '1')
        assert.equal(await button.evaluate(element => getComputedStyle(element, '::before').opacity), '0')
        await page.mouse.move(0, 0)
        await page.mouse.up()
        await page.waitForTimeout(550)
        assert.equal(await button.evaluate(element => getComputedStyle(element).scale), '1')
      }
    }
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.getByRole('button', { name: 'Single Player', exact: true }).click()
    await page.getByRole('button', { name: 'Standard', exact: true }).click()
    await page.locator('.start-menu__character-select').waitFor()
    await noHelp(page.getByRole('button', { name: 'Back', exact: true }))
    await page.getByRole('button', { name: 'Embark', exact: true }).click()
    await page.getByRole('button', { name: 'Start standard campaign', exact: true }).waitFor()
    await noHelp(page.getByRole('button', { name: 'Back', exact: true }))
    await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.phase = 'map'; run.neow = null
      window.__STS_DEBUG__.setRun(run)
    })
    await page.getByRole('button', { name: /^Current deck,/ }).click()
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    const back = deck.getByRole('button', { name: 'Back', exact: true })
    await motion(back)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('Tab')
    await back.focus()
    assert.equal(await back.evaluate(element => getComputedStyle(element).scale), 'none')
    assert.equal(await back.evaluate(element => getComputedStyle(element, '::before').opacity), '1')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true' })
    assert.equal(await back.evaluate(element => getComputedStyle(element).scale), 'none')
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'false' })
    await page.keyboard.press('d')
    await deck.waitFor({ state: 'hidden' })
    await page.keyboard.press('d')
    await deck.waitFor()
    if (phone) await back.tap()
    else await back.click()
    await deck.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log(`PASS ${screen}: no redundant help, full-ribbon hover/press, reduced motion and Back/D dismissal`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
