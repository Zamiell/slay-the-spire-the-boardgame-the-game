import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'

test.use({ appKey: import.meta.url, reducedMotion: "reduce" })

test('deck-inspection', async ({ page, screen, phone, appURL, artifacts: output }) => {
  page.setDefaultTimeout(10_000)
  await startStandardCampaign(page, appURL)
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
  await grid.evaluate(grid => {
    grid.captureSweep = event => {
      if (event.propertyName !== 'transform' || event.target.parentElement !== grid ||
        !event.target.classList.contains('card')) return
      const card = event.target
      const animation = card.getAnimations().find(animation => animation instanceof CSSTransition &&
        animation.transitionProperty === 'transform')
      animation.pause()
      animation.currentTime = 0
      card.sweepAnimation = animation
      card.sweepGeneration = (card.sweepGeneration ?? 0) + 1
    }
    grid.addEventListener('transitionrun', grid.captureSweep)
  })
  const firstCard = grid.locator(':scope > .card').first()
  const secondCard = grid.locator(':scope > .card').nth(1)
  const sampleSweep = async (card, generation, progress) => {
    await page.waitForFunction(({ card, generation }) => card.sweepGeneration > generation,
      { card: await card.elementHandle(), generation })
    return card.evaluate((card, progress) => progress.map(fraction => {
      card.sweepAnimation.currentTime = card.sweepAnimation.effect.getTiming().duration * fraction
      return card.getBoundingClientRect().width
    }), progress)
  }
  const second = await secondCard.boundingBox()
  await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2)
  await sampleSweep(firstCard, 0, [.2, .4, .6])
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2)
  const interrupted = await sampleSweep(firstCard, 1, [.2, .4, .6])
  const secondGrowth = await sampleSweep(secondCard, 0, [.2, .4, .6])
  await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2)
  const reversed = await sampleSweep(firstCard, 2, [0, .25, .5, .75, 1])
  const secondShrink = await sampleSweep(secondCard, 1, [0, .25, .5, .75, 1])
  assert(Math.abs(reversed[0] - interrupted.at(-1)) < 1 &&
    Math.abs(secondShrink[0] - secondGrowth.at(-1)) < 1, 'hover reversals must start at the interrupted size')
  assert(reversed.every((value, index) => !index || value > reversed[index - 1]) &&
    secondShrink.every((value, index) => !index || value < secondShrink[index - 1]),
  'rapid hover changes must preserve intermediate animation frames')
  assert(Math.abs(reversed.at(-1) / resting.width - 1.25) < .01 && Math.abs(secondShrink.at(-1) - second.width) < 1,
    'a rapid hover reversal must finish on the current card only')
  await grid.evaluate(grid => {
    grid.removeEventListener('transitionrun', grid.captureSweep)
    for (const card of grid.querySelectorAll(':scope > .card')) card.sweepAnimation?.finish()
  })
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
  assert(await inspection.evaluate(element => {
    const card = element.querySelector('.card-inspection__card').getBoundingClientRect()
    const arrow = element.querySelector('.compendium__detail-nav').getBoundingClientRect()
    const footer = element.querySelector('.card-inspection__footer').getBoundingClientRect()
    const checkbox = element.querySelector('input[type="checkbox"]').getBoundingClientRect()
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    return Math.abs(card.height / innerHeight - .78) < .01 &&
      Math.abs(card.x + card.width / 2 - innerWidth / 2) < 2 &&
      Math.abs(card.y + card.height / 2 - innerHeight / 2) < 2 &&
      Math.abs(arrow.width - Math.max(2.75 * rem, .09 * innerHeight)) < 2 &&
      Math.abs(checkbox.width - Math.max(1.3 * rem, .04 * innerHeight)) < 2 &&
      Math.abs(checkbox.height - checkbox.width) < 1 &&
      Math.abs(footer.top - card.bottom - .033 * innerHeight) < 2
  }), `${screen}: inspector proportions must match the supplied game reference`)
  assert.match(await preview.locator('img.card__art').getAttribute('src'), /\/assets\/cards\//,
    'large inspection cards must use full-resolution scans')
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
  console.log(`PASS ${screen}: card inspection, both faces, navigation, focus, nested dismissal and read-only state`)
})
