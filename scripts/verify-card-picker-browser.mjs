import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/profile-browser.mjs'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'artifacts/card-picker-browser')
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
const browser = await chromium.launch({ headless: true })

try {
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not report a port')
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(15_000)
  await page.goto(`http://localhost:${address.port}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Single Player', exact: true }).click()
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('button', { name: 'Embark' }).click()
  await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'neow')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    const playerId = run.players[0].id
    run.neow.players[playerId] = {
      ...run.neow.players[playerId], redRewardPending: false, redReward: null,
      pendingEffect: { kind: 'upgrade', count: 2, starter: 'strike' },
    }
    debug.setRun(run)
  })
  const neowPicker = page.locator('.card-picker:has([aria-label="Confirm reward"])')
  await neowPicker.waitFor()
  assert.equal(await neowPicker.getAttribute('aria-label'), 'Choose 2 cards to upgrade')
  assert((await neowPicker.locator('.card-picker__grid > .card').allTextContents()).every((text) => text.includes('Strike')))
  const neowBack = neowPicker.locator('.card-picker__back')
  await neowBack.hover()
  await page.waitForTimeout(250)
  const neowDesktopBackHover = await neowBack.evaluate((button) => ({
    filter: getComputedStyle(button).filter,
    outline: getComputedStyle(button).outlineStyle,
  }))
  assert(neowDesktopBackHover.filter.includes('brightness(1.1)') && neowDesktopBackHover.filter.includes('drop-shadow'), JSON.stringify(neowDesktopBackHover))
  assert.equal(neowDesktopBackHover.outline, 'none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.deepEqual(await neowBack.evaluate((button) => ({
    transform: getComputedStyle(button).transform,
    duration: getComputedStyle(button).transitionDuration,
  })), { transform: 'none', duration: '0s' }, 'Back hover ignores reduced motion')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.keyboard.press('Shift')
  await neowBack.focus()
  await page.emulateMedia({ forcedColors: 'active' })
  const neowForcedFocus = await neowBack.evaluate((button) => ({
    focusVisible: button.matches(':focus-visible'),
    outline: getComputedStyle(button).outlineStyle,
  }))
  assert(neowForcedFocus.focusVisible && neowForcedFocus.outline !== 'none', 'desktop: forced-colors card picker Back loses its keyboard-focus cue')
  await page.emulateMedia({ forcedColors: 'none' })
  const neowConfirm = neowPicker.getByRole('button', { name: 'Confirm reward', includeHidden: true })
  assert(await neowConfirm.isDisabled())
  await neowPicker.locator('.card-picker__grid > .card').nth(0).click()
  assert(await neowConfirm.isDisabled())
  await neowPicker.locator('.card-picker__grid > .card').nth(1).click()
  assert(!await neowConfirm.isDisabled())
  assert.equal(await neowPicker.locator('.card-picker__grid > .card').nth(2).getAttribute('tabindex'), '-1')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.players[0].relics.push({ defId: 'astrolabe', spent: false, pending: true })
    debug.setRun(run)
  })
  await neowPicker.locator('.card-picker__confirm:disabled').waitFor({ state: 'attached' })
  assert.equal(await neowPicker.isVisible(), false, 'the pending relic must own the screen without competing focus traps')
  await page.getByRole('dialog', { name: 'Choose 3 cards to upgrade', exact: true }).waitFor()
  assert(await neowConfirm.isDisabled())
  assert(await neowPicker.getByRole('button', { name: 'Skip reward', includeHidden: true }).isDisabled())
  assert(await neowPicker.locator('.card-picker__grid > .card').first().getAttribute('aria-disabled') === 'true')
  assert.equal(await neowPicker.locator('.card-picker__grid > .card').first().getAttribute('tabindex'), '-1')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.players[0].relics = run.players[0].relics.filter((relic) => !relic.pending)
    run.neow.players[run.players[0].id].pendingEffect = { kind: 'upgrade', count: 1 }
    debug.setRun(run)
  })
  await page.setViewportSize({ width: 568, height: 320 })
  await neowPicker.locator('.card-picker__grid > .card').first().click()
  await neowPicker.locator('.card-picker__preview').waitFor()
  const neowPhone = await neowPicker.evaluate((element) => {
    const grid = element.querySelector('.card-picker__grid')
    if (grid) grid.scrollTop = grid.scrollHeight
    const picker = element.getBoundingClientRect()
    const cards = [...element.querySelectorAll('.card-picker__preview .card')].map((card) => card.getBoundingClientRect())
    const controls = [...element.querySelectorAll('.card-picker__footer button')].map((button) => button.getBoundingClientRect())
    return {
      pickerFit: picker.left === 0 && picker.right === innerWidth && picker.bottom === innerHeight,
      previewPinned: grid?.scrollTop > 0 && cards.every((box) => box.top >= 0 && box.bottom <= innerHeight),
      cardsFit: cards.length === 2 && cards.every((box) => box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight),
      controlsFit: controls.every((box) => box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight),
    }
  })
  await neowBack.hover()
  await page.waitForTimeout(250)
  const neowPhoneBackHover = await neowBack.evaluate((button) => getComputedStyle(button).outlineStyle)
  assert(neowPhone.pickerFit && neowPhone.previewPinned && neowPhone.cardsFit && neowPhone.controlsFit, JSON.stringify(neowPhone))
  assert.equal(neowPhoneBackHover, 'none')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.players[0].relics.push({ defId: 'astrolabe', spent: false, pending: true })
    debug.setRun(run)
  })
  await page.waitForFunction(() => {
    const picker = document.activeElement?.closest('.card-picker')
    return picker && !picker.hidden && picker.querySelector('[aria-label="Confirm Astrolabe"]')
  })
  assert.equal(await neowPicker.locator('.card-picker__preview .card').first().getAttribute('aria-disabled'), 'true')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.players[0].relics = run.players[0].relics.filter((relic) => !relic.pending)
    debug.setRun(run)
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.phase = 'room'
    run.neow = null
    run.map.position = Object.entries(run.map.rooms).find(([, room]) => room.kind === 'campfire')?.[0]
    debug.setRun(run)
  })
  await page.locator('.campfire').waitFor()
  assert.equal((await page.locator('.campfire').getByRole('button', { name: /Rest/ }).locator('.muted').innerText()).trim(), '+3 HP')

  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    const deck = run.players[0].deck
    run.players[0].deck.push(...Array.from({ length: 15 }, (_, index) => ({
      ...deck[index % deck.length], uid: `picker-scroll-${index}`,
    })))
    debug.setRun(run)
  })

  await page.getByRole('button', { name: /Smith/ }).click()
  const picker = page.locator('.card-picker')
  await picker.waitFor()
  const backControl = picker.getByRole('button', { name: 'Back' })
  const confirmControl = picker.getByRole('button', { name: 'Confirm' })
  assert.equal(await backControl.getAttribute('title'), null)
  assert.equal(await confirmControl.getAttribute('title'), null)
  const restingBack = await backControl.evaluate((button) => getComputedStyle(button).transform)
  await backControl.hover()
  await page.waitForTimeout(180)
  assert.notEqual(await backControl.evaluate((button) => getComputedStyle(button).transform), restingBack)
  assert(await picker.locator('.card-picker__grid > .card').count() > 0)
  assert(await picker.getByRole('button', { name: 'Confirm' }).isDisabled())
  const upgradeGrid = picker.locator('.card-picker__grid')
  const viewUpgrades = picker.getByRole('checkbox', { name: 'View Upgrades', exact: true })
  const originalDeck = await page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun().players[0].deck))
  const baseLabels = await upgradeGrid.locator('> .card').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')))
  for (const [screen, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['horizontal-phone', { width: 844, height: 390 }],
  ]) {
    await page.setViewportSize(viewport)
    assert.equal(await viewUpgrades.isChecked(), false)
    await picker.evaluate(root => {
      const disabled = document.createElement('button')
      disabled.disabled = true
      disabled.tabIndex = 0
      disabled.dataset.focusRegression = ''
      root.append(disabled)
    })
    await picker.focus()
    await page.keyboard.press('Shift+Tab')
    assert(await viewUpgrades.evaluate(input => input === document.activeElement),
      `${screen}: reverse Tab must wrap to the last enabled control, ignoring disabled tabindex targets`)
    await picker.locator('[data-focus-regression]').evaluate(button => button.remove())
    await viewUpgrades.focus()
    await page.keyboard.press('d')
    const inspectedDeck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    await inspectedDeck.waitFor()
    await page.keyboard.press('Tab')
    assert(await inspectedDeck.evaluate(dialog => dialog.contains(document.activeElement)),
      `${screen}: Smith must not steal focus from deck inspection`)
    await inspectedDeck.getByLabel('Current deck upgrade preview').focus()
    await page.keyboard.press('d')
    await inspectedDeck.waitFor({ state: 'hidden' })
    assert(await picker.isVisible(), 'D must close only the deck, not Smith')
    assert(await viewUpgrades.evaluate(input => input === document.activeElement),
      'deck inspection must return focus to the Smith checkbox')
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].deck), originalDeck)
    await page.keyboard.press('Space')
    assert(await viewUpgrades.isChecked(), `${screen}: keyboard could not enable upgrade previews`)
    assert((await upgradeGrid.locator('> .card').evaluateAll((cards) =>
      cards.map((card) => card.getAttribute('aria-label')))).every((label) => label.includes('+, ')),
    `${screen}: the grid did not show upgraded card faces`)
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].deck), originalDeck,
      'previewing upgraded cards modified the actual deck')
    assert(await picker.locator('.card-picker__view-upgrades').evaluate((label) => {
      const box = label.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), `${screen}: View Upgrades is clipped`)
    await page.screenshot({ path: resolve(output, `${screen}-view-upgrades.png`) })
    await page.keyboard.press('Shift+Tab')
    assert(await backControl.evaluate((button) => document.activeElement === button))
    await page.keyboard.press('Tab')
    assert(await viewUpgrades.evaluate((checkbox) => document.activeElement === checkbox))
    await page.keyboard.press('Space')
    assert.deepEqual(await upgradeGrid.locator('> .card').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label'))),
      baseLabels, `${screen}: disabling previews did not restore the original faces`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await viewUpgrades.check()
  const upgradeScrollTop = await upgradeGrid.evaluate((grid) => {
    grid.scrollTop = grid.scrollHeight
    return grid.scrollTop
  })
  assert(upgradeScrollTop > 0)
  await upgradeGrid.locator('> .card').last().click()
  await picker.locator('.card-picker__preview').waitFor()
  assert.equal(await picker.locator('.card-picker__preview .card').count(), 2)
  assert(!(await picker.locator('.card-picker__preview .card').first().getAttribute('aria-label')).includes('+, '),
    'the comparison lost the original face when View Upgrades was enabled')
  assert(!await picker.getByRole('button', { name: 'Confirm' }).isDisabled())
  assert.equal(await picker.locator('.card-picker__grid > .card').first().getAttribute('aria-disabled'), 'true')
  assert.equal(await picker.locator('.card-picker__grid > .card').first().getAttribute('tabindex'), '-1')
  assert.equal(await picker.locator('.card-picker__preview .card').nth(1).getAttribute('aria-disabled'), 'true')
  assert.equal(await picker.locator('.card-picker__preview .card').nth(1).getAttribute('tabindex'), '-1')
  await page.waitForFunction(() => Boolean(document.activeElement?.closest('.card-picker__preview')))
  const smithPreview = await picker.locator('.card-picker__preview').innerText()
  await page.keyboard.press('d')
  const previewDeck = page.getByRole('dialog', { name: 'Current deck', exact: true })
  await previewDeck.waitFor()
  await page.keyboard.press('Escape')
  await previewDeck.waitFor({ state: 'hidden' })
  assert.equal(await picker.locator('.card-picker__preview').innerText(), smithPreview,
    'inspecting the deck must preserve the selected Smith upgrade')
  assert(await confirmControl.isEnabled())
  for (let index = 0; index < 20; index += 1) await page.keyboard.press('Tab')
  assert(await page.evaluate(() => Boolean(document.activeElement?.closest('.card-picker'))))
  await picker.getByRole('button', { name: 'Back' }).click()
  await picker.locator('.card-picker__preview').waitFor({ state: 'detached' })
  assert(await viewUpgrades.isChecked(), 'returning to the grid forgot View Upgrades')
  assert.equal(await upgradeGrid.evaluate((grid) => grid.scrollTop), upgradeScrollTop)
  assert(await page.evaluate(() => document.activeElement?.classList.contains('card-picker__back')))
  await picker.locator('.card-picker__grid > .card').first().click()
  await picker.getByRole('button', { name: 'Confirm' }).click()
  await picker.waitFor({ state: 'detached' })
  const upgradedDeck = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].deck)
  assert.deepEqual(upgradedDeck, originalDeck.map((card, index) => index === 0 ? { ...card, upgraded: true } : card),
    'confirming from the upgraded preview changed more than the selected card')

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.getByRole('button', { name: /^Current deck,/ }).click()
  const deck = page.getByRole('dialog', { name: 'Current deck' })
  await deck.waitFor()
  assert.deepEqual(await deck.locator('.card-collection__sort button').allTextContents()
    .then((labels) => labels.map((label) => label.replace(/\s*[↑↓↕]\s*$/, '').trim())),
  ['Obtained', 'Card Type', 'Cost', 'A - Z'])
  await deck.getByRole('button', { name: /A - Z/ }).click()
  const names = await deck.locator('.choice-modal__cards > .card').evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('aria-label')?.split(',')[0] ?? ''))
  assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right)))
  const deckRows = await deck.locator('.choice-modal__cards > .card').evaluateAll((cards) => Object.values(cards.reduce((rows, card) => {
    const top = Math.round(card.getBoundingClientRect().top)
    rows[top] = (rows[top] ?? 0) + 1
    return rows
  }, {})).sort((left, right) => right - left))
  assert.equal(deckRows[0], 5)
  const deckCardSize = await deck.locator('.choice-modal__cards > .card').first().evaluate((card) => {
    const box = card.getBoundingClientRect()
    const art = card.querySelector('.card__art')?.getBoundingClientRect()
    return { width: box.width, height: box.height, artWidth: art?.width ?? 0 }
  })
  assert(deckCardSize.width >= 160 && deckCardSize.height >= 220 && deckCardSize.artWidth >= deckCardSize.width - 4,
    `collection cards collapsed to thumbnails: ${JSON.stringify(deckCardSize)}`)
  await deck.getByLabel('Current deck upgrade preview').check()
  assert((await deck.locator('.choice-modal__cards > .card').first().getAttribute('aria-label'))?.includes('+, '))
  await deck.getByRole('button', { name: 'Back', exact: true }).click()

  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.phase = 'room'
    run.roomState = null
    run.map.position = Object.entries(run.map.rooms).find(([, room]) => room.kind === 'campfire')?.[0]
    run.players[0].relics.push({ defId: 'peace_pipe', spent: false }, { defId: 'straight_razor', spent: false })
    debug.setRun(run)
  })
  const campfire = page.locator('.campfire')
  await campfire.waitFor()
  const rest = campfire.getByRole('button', { name: /Rest/ })
  for (const [screen, viewport] of [
    ['desktop', { width: 1920, height: 1080 }],
    ['horizontal-phone', { width: 844, height: 390 }],
  ]) {
    await page.setViewportSize(viewport)
    assert.equal((await rest.locator('.muted').innerText()).trim(), '+3 HP · may remove a card (Peace Pipe)')
    assert(await rest.evaluate(button => {
      const box = button.getBoundingClientRect()
      const text = button.querySelector('.muted').getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
        text.left >= box.left && text.right <= box.right && text.bottom <= box.bottom
    }), `${screen}: the Peace Pipe explanation must fit the Rest button`)
    await page.screenshot({ path: resolve(output, `${screen}-peace-pipe-rest.png`) })
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await campfire.getByRole('button', { name: /Rest/ }).click()
  await picker.waitFor()
  assert.equal(await picker.getAttribute('aria-label'), 'Choose a card to remove')
  const pickerRows = await picker.locator('.card-picker__grid > .card').evaluateAll((cards) => Object.values(cards.reduce((rows, card) => {
    const top = Math.round(card.getBoundingClientRect().top)
    rows[top] = (rows[top] ?? 0) + 1
    return rows
  }, {})).sort((left, right) => right - left))
  assert.equal(pickerRows[0], 5)
  assert((await picker.locator('.card-picker__grid > .card').first().evaluate((card) => card.getBoundingClientRect().width)) <= 216)
  assert.equal(await picker.getByRole('button', { name: 'Back' }).count(), 0)
  assert(!await picker.getByRole('button', { name: 'Confirm' }).isDisabled())
  await picker.getByRole('button', { name: 'Confirm' }).click()
  assert.equal(await picker.getAttribute('aria-label'), 'Choose a card to transform')
  assert.equal(await picker.getByRole('button', { name: 'Back' }).count(), 0)
  await picker.locator('.card-picker__grid > .card').first().click()
  await picker.locator('.card-picker__preview').waitFor()
  assert.equal(await picker.getByRole('button', { name: 'Back' }).count(), 1)
  await picker.getByRole('button', { name: 'Confirm' }).click()
  await picker.waitFor({ state: 'detached' })

  await page.setViewportSize({ width: 568, height: 320 })
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.phase = 'room'
    run.roomState = null
    run.map.position = Object.entries(run.map.rooms).find(([, room]) => room.kind === 'campfire')?.[0]
    debug.setRun(run)
  })
  await campfire.waitFor()
  await campfire.getByRole('button', { name: /Smith/ }).click()
  await picker.waitFor()
  await picker.locator('.card-picker__grid > .card').first().click()
  await picker.locator('.card-picker__preview').waitFor()
  const phone = await picker.evaluate((element) => {
    const pickerBox = element.getBoundingClientRect()
    const cards = [...element.querySelectorAll('.card-picker__preview .card')].map((card) => card.getBoundingClientRect())
    const controls = [...element.querySelectorAll('.card-picker__footer button')].map((button) => button.getBoundingClientRect())
    return {
      overflow: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      cardsFit: cards.length === 2 && cards.every((box) => box.left >= pickerBox.left - 1 && box.right <= pickerBox.right + 1 && box.top >= pickerBox.top - 1 && box.bottom <= pickerBox.bottom + 1),
      controlsFit: controls.every((box) => box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight),
    }
  })
  assert.equal(phone.overflow, false, JSON.stringify(phone))
  assert(phone.cardsFit && phone.controlsFit, JSON.stringify(phone))
  await picker.getByRole('button', { name: 'Confirm' }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')

  await page.evaluate(() => window.__STS_DEBUG__.reset(2, 'campfire-ready-flow'))
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().players.length === 2)
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.phase = 'room'
    run.neow = null
    run.roomState = null
    run.map.position = Object.entries(run.map.rooms).find(([, room]) => room.kind === 'campfire')?.[0]
    run.players = run.players.map((player) => ({ ...player, hp: Math.max(1, player.hp - 1) }))
    debug.setRun(run)
  })
  await page.setViewportSize({ width: 844, height: 390 })
  await campfire.waitFor()
  await campfire.getByRole('button', { name: /Rest/ }).click()
  assert((await campfire.getByRole('status').textContent()).includes('chose to Rest'))
  assert.equal(await campfire.locator('.campfire__choices button').count(), 0)
  await campfire.getByRole('button', { name: 'Next campfire player' }).click()
  await campfire.getByRole('button', { name: /Smith/ }).click()
  await picker.locator('.card-picker__grid > .card').first().click()
  await picker.getByRole('button', { name: 'Confirm' }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
  assert.equal(await page.locator('.campfire__leave').count(), 0)
  console.log('Card picker browser checks passed')
} finally {
  await browser.close()
  await server.close()
}
