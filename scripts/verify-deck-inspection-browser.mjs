import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'

const output = 'artifacts/deck-inspection'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
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
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.phase = 'map'
      run.neow = null
      run.players[0].deck = [
        { uid: 'bash', defId: 'bash', upgraded: false },
        { uid: 'defend-plus', defId: 'defend_ironclad', upgraded: true },
        { uid: 'defend', defId: 'defend_ironclad', upgraded: false },
        { uid: 'regret', defId: 'regret', upgraded: false },
      ]
      window.__STS_DEBUG__.setRun(run)
    })
    const activate = locator => phone ? locator.tap() : locator.click()
    await activate(page.getByRole('button', { name: /^Current deck,/ }))
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    await deck.waitFor()
    const original = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const grid = deck.locator('.choice-modal__cards')
    const inspection = page.locator('.card-inspection')
    const preview = inspection.locator('.card-inspection__card')
    const checkbox = inspection.getByRole('checkbox', { name: 'View Upgrades', exact: true })
    const previous = inspection.getByRole('button', { name: 'Previous card' })
    const next = inspection.getByRole('button', { name: 'Next card' })
    const bash = grid.locator('.card[data-card-name="Bash"]')
    const sampleMotion = (locator, property) => locator.evaluate(async (element, property) => {
      const start = performance.now()
      const read = () => property === 'backdrop'
        ? Number(getComputedStyle(element, '::backdrop').opacity) : element.getBoundingClientRect().width
      const initial = read()
      let changedAt
      const frames = []
      do {
        await new Promise(requestAnimationFrame)
        const value = read()
        if (value !== initial && changedAt === undefined) changedAt = performance.now()
        frames.push(value)
      } while (performance.now() - (changedAt ?? start) < 600 && performance.now() - start < 2000)
      return frames
    }, property)
    const oldMotion = await page.evaluate(() => document.documentElement.dataset.reducedMotion)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'false' })
    const sortButton = deck.getByRole('button', { name: /Obtained/ })
    await page.mouse.move(2, 2)
    await sortButton.focus()
    const resting = await bash.boundingBox()
    const growing = sampleMotion(bash, 'width')
    await bash.hover()
    const growth = await growing
    assert(new Set(growth.filter(width => width > resting.width + 1 && width < resting.width * 1.25 - 1)
      .map(width => width.toFixed(2))).size >= 3, `${screen}: deck cards must visibly tween larger, not snap`)
    assert(Math.abs(growth.at(-1) / resting.width - 1.25) < .01,
      `${screen}: deck hover must finish at 25% enlargement`)
    const tips = page.locator('.card-keyword-tips[data-open]')
    await tips.waitFor()
    const helpBox = await tips.boundingBox()
    const cardBox = await bash.boundingBox()
    assert(helpBox.x >= cardBox.x + cardBox.width - 1 || helpBox.x + helpBox.width <= cardBox.x + 1,
      'keyword help must follow the growing card instead of covering it')
    assert(await bash.evaluate(card => {
      const box = card.getBoundingClientRect()
      const grid = card.parentElement.getBoundingClientRect()
      return box.left >= grid.left && box.right <= grid.right && box.top >= grid.top && box.bottom <= grid.bottom
    }), `${screen}: enlarged edge cards must not be clipped by the scroller: ${await bash.evaluate(card =>
      JSON.stringify({ card: card.getBoundingClientRect(), grid: card.parentElement.getBoundingClientRect(),
        scroll: card.parentElement.scrollTop }))}`)
    await page.screenshot({ path: `${output}/${screen}-grid-hover.png` })
    const shrinking = sampleMotion(bash, 'width')
    await page.mouse.move(2, 2)
    const widths = await shrinking
    assert(new Set(widths.filter(width => width > resting.width + 1 && width < resting.width * 1.25 - 1)
      .map(width => width.toFixed(2))).size >= 3, `${screen}: deck cards must visibly ease back`)
    assert(Math.abs(widths.at(-1) - resting.width) < 1)
    await page.keyboard.press('Tab')
    await sortButton.focus()
    const focusing = sampleMotion(bash, 'width')
    await bash.focus()
    const focusWidths = await focusing
    assert(new Set(focusWidths.filter(width => width > resting.width + 1 && width < resting.width * 1.25 - 1)
      .map(width => width.toFixed(2))).size >= 3, 'keyboard enlargement must tween too')
    assert(Math.abs(focusWidths.at(-1) / resting.width - 1.25) < .01,
      'keyboard focus must use the same enlargement')
    await sortButton.focus()
    await page.waitForFunction(card => card.getAnimations().every(animation => animation.playState === 'finished'),
      await bash.elementHandle())
    const sweep = grid.evaluate(async grid => {
      const cards = [...grid.querySelectorAll(':scope > .card')].slice(0, 2)
      const start = performance.now()
      const frames = []
      do {
        await new Promise(requestAnimationFrame)
        frames.push(cards.map(card => card.getBoundingClientRect().width))
      } while (performance.now() - start < 1000)
      return frames
    })
    const second = await grid.locator(':scope > .card').nth(1).boundingBox()
    await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2)
    await page.waitForTimeout(100)
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2)
    await page.waitForTimeout(100)
    await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2)
    const swept = await sweep
    for (const [index, width] of [resting.width, second.width].entries()) {
      assert(new Set(swept.map(frame => frame[index]).filter(value => value > width + 1 && value < width * 1.25 - 1)
        .map(value => value.toFixed(2))).size >= 3, 'rapid hover changes must preserve intermediate animation frames')
    }
    assert(Math.abs(swept.at(-1)[0] / resting.width - 1.25) < .01 && Math.abs(swept.at(-1)[1] - second.width) < 1,
      'a rapid hover reversal must finish on the current card only')
    await page.mouse.move(2, 2)
    const surface = page.locator('.card-collection')
    const closing = sampleMotion(surface, 'backdrop')
    await activate(deck.getByRole('button', { name: 'Back', exact: true }))
    const closeFrames = await closing
    assert(closeFrames.some(alpha => alpha > .05 && alpha < .95) && closeFrames.at(-1) === 0,
      `${screen}: the deck backdrop must fade out: ${JSON.stringify(closeFrames)}`)
    const opening = sampleMotion(surface, 'backdrop')
    await activate(page.getByRole('button', { name: /^Current deck,/ }))
    const openFrames = await opening
    assert(openFrames.some(alpha => alpha > .05 && alpha < .95) && openFrames.at(-1) === 1,
      `${screen}: the deck backdrop must fade in`)
    await page.keyboard.press('d')
    await page.keyboard.press('d')
    await deck.waitFor()
    assert(await deck.evaluate(dialog => dialog.matches(':modal')),
      'reopening during the closing fade must preserve the new modal')
    for (const mode of ['system', 'game']) {
      await page.emulateMedia({ reducedMotion: mode === 'system' ? 'reduce' : 'no-preference' })
      await page.evaluate(mode => { document.documentElement.dataset.reducedMotion = String(mode === 'game') }, mode)
      assert(await surface.evaluate(dialog => [getComputedStyle(dialog), getComputedStyle(dialog, '::backdrop')]
        .every(style => style.transitionDuration.split(',').every(duration => parseFloat(duration) <= .001))),
      `${screen}/${mode}: reduced motion must disable backdrop fading`)
      await page.mouse.move(2, 2)
      await sortButton.focus()
      await bash.hover()
      assert(Math.abs((await bash.boundingBox()).width / resting.width - 1.25) < .01)
      await page.mouse.move(2, 2)
      assert(Math.abs((await bash.boundingBox()).width - resting.width) < 1,
        `${screen}/${mode}: reduced motion keeps inspection but removes the return tween`)
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(oldMotion => {
      if (oldMotion === undefined) delete document.documentElement.dataset.reducedMotion
      else document.documentElement.dataset.reducedMotion = oldMotion
    }, oldMotion)
    await activate(bash)
    await inspection.waitFor()
    assert.equal(await previous.count(), 0, 'the first card must not offer wraparound navigation')
    assert.equal(await checkbox.isChecked(), false)
    const baseArt = await preview.locator('img.card__art').getAttribute('src')
    await checkbox.check()
    await preview.locator('img.card__art').evaluate(image => image.decode())
    assert.equal(await preview.getAttribute('data-card-name'), 'Bash+')
    assert.notEqual(await preview.locator('img.card__art').getAttribute('src'), baseArt)
    assert(await inspection.getByRole('complementary', { name: 'Card keywords' }).isVisible())
    assert(await inspection.evaluate(element => {
      const card = element.querySelector('.card-inspection__card').getBoundingClientRect()
      const controls = [...element.querySelectorAll('input, button')].filter(control =>
        getComputedStyle(control).visibility !== 'hidden')
      return element.matches(':modal') && card.left >= 0 && card.right <= innerWidth &&
        card.top >= 0 && card.bottom <= innerHeight && controls.every(control => {
          const box = control.getBoundingClientRect()
          return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
        })
    }), `${screen}: enlarged card and controls must fit`)
    await page.screenshot({ path: `${output}/${screen}-upgraded.png` })
    await activate(next)
    assert.equal(await preview.getAttribute('data-card-name'), 'Defend+')
    assert(await checkbox.isChecked(), 'owned upgrades open on their upgraded face')
    await checkbox.uncheck()
    assert.equal(await preview.getAttribute('data-card-name'), 'Defend',
      'an actually upgraded card must also have a base preview')
    await activate(next)
    assert.equal(await checkbox.isChecked(), false, 'navigation resets to the next card actual upgrade state')
    await activate(next)
    assert.equal(await preview.getAttribute('data-card-name'), 'Regret')
    assert.equal(await checkbox.count(), 0, 'unupgradable cards have no upgrade checkbox')
    assert.equal(await next.count(), 0, 'the last card must not wrap around')
    await page.keyboard.press('ArrowRight')
    assert.equal(await preview.getAttribute('data-card-name'), 'Regret')
    await page.keyboard.press('ArrowLeft')
    assert.equal(await preview.getAttribute('data-card-name'), 'Defend')
    await page.keyboard.press('Escape')
    await inspection.waitFor({ state: 'detached' })
    assert(await deck.isVisible(), 'Escape must close only the inspector')
    assert(await bash.evaluate(element => element === document.activeElement),
      `focus must return to the clicked deck card: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 250))}`)
    assert.equal(await deck.getByLabel('Current deck upgrade preview').isChecked(), false)

    await deck.getByLabel('Current deck upgrade preview').check()
    await activate(grid.locator('.card[data-card-name="Bash+"]'))
    await inspection.waitFor()
    assert(await checkbox.isChecked())
    await activate(next)
    await activate(next)
    assert(await checkbox.isChecked(), 'the deck-wide upgrade preview carries into navigation')
    await checkbox.uncheck()
    await activate(previous)
    assert(await checkbox.isChecked(), 'owned upgrades still win after leaving global preview mode')
    await activate(previous)
    assert.equal(await checkbox.isChecked(), false, 'a manual toggle ends the inherited deck-wide preview')
    if (phone) await page.touchscreen.tap(8, 8)
    else await page.mouse.click(8, 8)
    await inspection.waitFor({ state: 'detached' })
    assert(await deck.isVisible())
    assert(await deck.getByLabel('Current deck upgrade preview').isChecked(),
      'the inspector must not change the deck-wide toggle')
    await deck.getByLabel('Current deck upgrade preview').uncheck()
    await deck.getByRole('button', { name: /A - Z/ }).click()
    await activate(grid.locator('.card[data-card-name="Defend+"]'))
    await inspection.waitFor()
    await activate(next)
    assert.equal(await preview.getAttribute('data-card-name'), 'Regret', 'inspect order follows the sorted grid')
    await page.keyboard.press('d')
    assert(await inspection.isVisible(), 'deck shortcut must not close a background dialog')
    await page.keyboard.press('Escape')
    await inspection.waitFor({ state: 'detached' })
    await activate(deck.getByRole('button', { name: 'Back', exact: true }))
    await deck.waitFor({ state: 'hidden' })
    await activate(page.getByRole('button', { name: /^Current deck,/ }))
    await deck.waitFor()
    assert.equal(await inspection.count(), 0, 'reopening the deck must not restore a stale inspector')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), original,
      'all inspection controls must leave the live run unchanged')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: card inspection, both faces, navigation, focus, nested dismissal and read-only state`)
  }
} finally {
  await browser.close()
  await server.close()
}
