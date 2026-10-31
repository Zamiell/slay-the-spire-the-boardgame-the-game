import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'

const server = await createServer({ root: new URL('../', import.meta.url).pathname,
  logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const output = new URL('../artifacts/keyboard-browser/', import.meta.url)
mkdirSync(output, { recursive: true })

try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`${screen}: ${error.message}`))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => {
      window.contextMenus = []
      document.addEventListener('contextmenu', (event) => {
        setTimeout(() => window.contextMenus.push(event.defaultPrevented), 0)
      }, true)
    })
    const rightClick = async (control) => {
      const before = await page.evaluate(() => window.contextMenus.length)
      await control.click({ button: 'right', force: true })
      await page.waitForFunction(count => window.contextMenus.length === count + 1, before)
      assert.equal(await page.evaluate(() => window.contextMenus.length), before + 1)
      assert.equal(await page.evaluate(() => window.contextMenus.at(-1)), true, 'the browser context menu was not suppressed')
    }
    await rightClick(page.getByRole('button', { name: 'Single Player', exact: true }))
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    const map = page.getByRole('dialog', { name: 'Act 1 map', exact: true })
    await page.keyboard.press('d')
    await deck.waitFor()
    await rightClick(deck.locator('.card').first())
    await page.locator('.card-inspection[open]').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.card-inspection[open]').waitFor({ state: 'detached' })
    assert.equal(await deck.locator('.card').count(),
      await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].deck.length))
    await page.keyboard.press('d')
    await deck.waitFor({ state: 'hidden' })
    await page.keyboard.press('d')
    await deck.waitFor()
    await page.keyboard.press('Escape')
    await deck.waitFor({ state: 'hidden' })
    await page.keyboard.press('m')
    await map.waitFor()
    await page.keyboard.press('m')
    await map.waitFor({ state: 'hidden' })
    await page.keyboard.press('m')
    await map.waitFor()
    await page.keyboard.press('Escape')
    await map.waitFor({ state: 'hidden' })

    await page.evaluate(() => window.__STS_DEBUG__.reset(1, 'keyboard-shortcuts'))
    await page.evaluate(() => {
      const debug = window.__STS_DEBUG__
      debug.setRun({ ...debug.getRun(), phase: 'map', neow: null })
    })
    await page.locator('.room--reachable').first().click()
    if (phone) await page.locator('.room--reachable').first().click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'player')
    const endTurn = page.getByRole('button', { name: /^End Turn \d+/ })
    await endTurn.waitFor()
    assert(await endTurn.isEnabled())
    assert.equal(await page.locator('.combat__turn').count(), 0, 'the redundant top-left turn number remains')
    assert.equal(await endTurn.textContent(), `End Turn ${await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.turn)}`)
    assert(await page.evaluate(async () => {
      const { queryRunLogControl } = await import('/src/ui/run-log.ts')
      return queryRunLogControl(document, { selector: 'button', name: 'End turn' }) ===
        document.querySelector('.combat__end-turn')
    }), 'legacy replay logs no longer find the numbered End Turn button')
    await page.evaluate(() => {
      window.endTurnClicks = 0
      document.addEventListener('click', (event) => {
        if (event.target.closest?.('.combat__end-turn')) window.endTurnClicks++
      }, true)
    })
    const clicks = () => page.evaluate(() => window.endTurnClicks)
    const blur = () => page.evaluate(() => document.activeElement?.blur())

    const board = page.locator('.board')
    for (const selector of ['.enemy__hit-area', '.seat__portrait']) {
      await board.locator(selector).first().click()
      assert.equal(await board.locator(':is(.enemy, .seat):focus').count(), 0,
        'mouse inspection must not leave a battlefield actor selected for keyboard input')
    }
    await board.focus()
    await page.keyboard.press('d')
    await deck.waitFor()
    await blur()
    await page.keyboard.press('Space')
    assert.equal(await clicks(), 0, 'Space ended a turn behind the deck dialog')
    await page.keyboard.press('d')
    await deck.waitFor({ state: 'hidden' })
    assert(await board.evaluate((element) => document.activeElement === element),
      'closing the deck lost the board keyboard focus')
    assert.equal(await board.evaluate((element) => getComputedStyle(element).outlineStyle), 'none',
      'closing the deck outlined the whole combat board')
    await page.screenshot({ path: new URL(`${screen}-deck-closed.png`, output).pathname })
    await endTurn.focus()
    assert(await endTurn.evaluate((button) => button.matches(':focus-visible') &&
      getComputedStyle(button).outlineStyle !== 'none' && parseFloat(getComputedStyle(button).outlineWidth) > 0),
    'the End turn button lost its keyboard focus indicator')
    await page.keyboard.press('m')
    await map.waitFor()
    await page.keyboard.press('d')
    assert.equal(await deck.isVisible(), false, 'D opened the deck over the map')
    await blur()
    await page.keyboard.press('Space')
    assert.equal(await clicks(), 0, 'Space ended a turn behind the map')
    await page.keyboard.press('m')
    await map.waitFor({ state: 'hidden' })

    // Space still activates a focused control instead of ending the turn.
    await page.getByRole('button', { name: 'Settings', exact: true }).focus()
    await page.keyboard.press('Space')
    await page.locator('.settings-dialog[open]').waitFor()
    await page.keyboard.press('d')
    await page.keyboard.press('m')
    assert.equal(await deck.isVisible(), false, 'D opened another dialog over Settings')
    assert.equal(await map.isVisible(), false, 'M opened another dialog over Settings')
    assert.equal(await clicks(), 0, 'Space stole a focused button activation')
    await page.keyboard.press('Escape')
    await page.locator('.settings-dialog[open]').waitFor({ state: 'hidden' })

    for (const editable of [false, true]) {
      await page.evaluate((editable) => {
        const field = document.createElement(editable ? 'div' : 'input')
        field.id = 'keyboard-field'
        if (editable) field.contentEditable = 'true'
        document.querySelector('.app-shell__header').append(field)
        field.focus()
      }, editable)
      if (!editable) {
        await page.locator('#keyboard-field').click()
        assert(await page.locator('#keyboard-field').evaluate(field => document.activeElement === field),
          'mouse focus management must preserve native text editing')
      }
      await page.keyboard.press('d')
      await page.keyboard.press('m')
      await page.keyboard.press('Space')
      assert.equal(await page.locator('#keyboard-field').evaluate((field) =>
        field.isContentEditable ? field.textContent.replace(/\u00a0/g, ' ') : field.value), 'dm ')
      assert.equal(await deck.isVisible(), false, 'D interrupted text entry')
      assert.equal(await map.isVisible(), false, 'M interrupted text entry')
      assert.equal(await clicks(), 0, 'Space interrupted text entry')
      await page.locator('#keyboard-field').evaluate((field) => field.remove())
    }

    await blur()
    await page.evaluate(() => {
      for (const key of ['d', 'm', ' ']) {
        for (const modifier of ['repeat', 'isComposing', 'ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true }))
        }
        const handled = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        handled.preventDefault()
        document.body.dispatchEvent(handled)
      }
    })
    assert.equal(await deck.isVisible(), false, 'D handled a repeated, modified or already-handled key')
    assert.equal(await map.isVisible(), false, 'M handled a repeated, modified or already-handled key')
    assert.equal(await clicks(), 0, 'Space handled a repeated, modified or already-handled key')

    await endTurn.evaluate((button) => { button.disabled = true })
    await page.keyboard.press('Space')
    assert.equal(await clicks(), 0, 'Space bypassed a disabled End turn button')
    await endTurn.evaluate((button) => { button.disabled = false })
    await page.locator('.app-shell').evaluate((shell) => { shell.inert = true })
    await page.keyboard.press('d')
    await page.keyboard.press('m')
    await page.keyboard.press('Space')
    assert.equal(await deck.isVisible(), false, 'D opened an inert deck control')
    assert.equal(await map.isVisible(), false, 'M opened an inert map control')
    assert.equal(await clicks(), 0, 'Space activated an inert End turn button')
    await page.locator('.app-shell').evaluate((shell) => { shell.inert = false })

    const beforeTurn = await page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun()))
    const turn = beforeTurn.combat.turn
    let turnsEnded = 0
    for (const mode of ['mouse enemy', 'keyboard enemy', 'keyboard hero', ...(phone ? ['touch enemy'] : [])]) {
      if (turnsEnded) {
        await page.evaluate(run => window.__STS_DEBUG__.setRun(run), beforeTurn)
        await page.waitForFunction(turn => window.__STS_DEBUG__.getRun().combat.turn === turn, turn)
      }
      const actor = board.locator(mode.endsWith('hero') ? '.seat' : '.enemy').first()
      if (mode === 'mouse enemy') await actor.locator('.enemy__hit-area').click()
      else if (mode === 'touch enemy') await actor.locator('.enemy__hit-area').tap()
      else {
        await actor.focus()
        assert.equal(await actor.evaluate(element => getComputedStyle(element).outlineStyle), 'none',
          'keyboard actor inspection should use its silhouette cue, not a yellow rectangle')
      }
      await page.keyboard.press('Space')
      assert.equal(await clicks(), ++turnsEnded, `${mode}: Space must activate End turn exactly once`)
      await page.waitForFunction(turn => {
        const combat = window.__STS_DEBUG__.getRun().combat
        return combat.turn > turn && combat.phase === 'player'
      }, turn)
    }
    assert.equal(await endTurn.textContent(), `End Turn ${await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.turn)}`,
      'the End Turn label did not advance with the turn')

    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      for (const enemy of run.combat.enemies) { enemy.hp = 0; enemy.dead = true }
      run.combat.phase = 'won'
      window.__STS_DEBUG__.setRun(run)
    })
    await page.getByRole('button', { name: 'Add a card to your deck.', exact: true }).click()
    const reward = page.getByRole('dialog', { name: 'Choose a Card', exact: true })
    await reward.waitFor()
    const beforeInspection = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    await page.keyboard.press('d')
    await deck.waitFor()
    await page.evaluate(() => {
      const dialog = document.createElement('dialog')
      dialog.id = 'keyboard-blocking-dialog'
      dialog.textContent = 'Another modal'
      document.body.append(dialog)
      dialog.showModal()
    })
    await page.keyboard.press('d')
    assert(await deck.isVisible(), 'D bypassed a modal above the deck')
    await page.locator('#keyboard-blocking-dialog').evaluate((dialog) => { dialog.close(); dialog.remove() })
    await page.keyboard.press('d')
    await deck.waitFor({ state: 'hidden' })
    assert(await reward.isVisible(), 'closing the deck dismissed the card reward')
    await page.keyboard.press('m')
    await map.waitFor()
    await page.keyboard.press('m')
    await map.waitFor({ state: 'hidden' })
    assert(await reward.isVisible(), 'closing the map dismissed the card reward')
    await blur()
    await page.keyboard.press('Space')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeInspection,
      'deck inspection or Space changed the pending reward')
    const deckSize = JSON.parse(beforeInspection).players[0].deck.length
    await reward.locator('.card').first().click()
    await page.waitForFunction((count) => window.__STS_DEBUG__.getRun().players[0].deck.length === count + 1, deckSize)
    console.log(`PASS ${screen}: deck, map and end-turn shortcuts, dialogs, focus, text entry and unavailable controls`)
    await context.close()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
