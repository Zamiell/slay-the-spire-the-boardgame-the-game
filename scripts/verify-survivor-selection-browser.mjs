import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat } from '../src/game/combat.ts'
import { createRng } from '../src/game/rng.ts'

const output = 'artifacts/survivor-selection'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: `http://127.0.0.1:${address.port}` }, '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true } },
} })
await server.listen()
const browser = await chromium.launch()
const errors = []
const fixture = (players, suffix, upgraded = false, alone = false) => {
  const run = createRun(47, players)
  run.phase = 'combat'
  run.neow = null
  run.combat = createCombat(createRng(47), run.players, [{
    uid: 'survivor-enemy', defId: 'jaw_worm', row: 0, isBoss: false, hp: 30, maxHp: 30,
    block: 0, strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false,
    goldReward: 0, cardReward: null, dead: false,
  }], `survivor-${suffix}`)
  Object.assign(run.combat.players[0], {
    energy: 3, block: 0, relics: [], powers: [], potions: ['block_potion'],
    hand: [
      { uid: 'survivor-source', defId: 'survivor', upgraded },
      ...alone ? [] : [
        { uid: 'discard-strike', defId: 'strike_silent', upgraded: false },
        { uid: 'discard-daze', defId: 'daze', upgraded: false },
        { uid: 'discard-defend', defId: 'defend_silent', upgraded: false },
      ],
    ],
  })
  return run
}

try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1920, height: 1080 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    await page.goto(origin)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const playerId = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].id)
    const run = fixture([{ id: playerId, name: 'Silent', character: 'silent' }], screen)
    await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), run)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'combat')
    const initial = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const play = async () => {
      const source = page.locator('.hand .card[data-card-name="Survivor"]')
      await source.focus()
      await page.keyboard.press('Enter')
    }
    await play()
    const dialog = page.getByRole('dialog', { name: 'Discard 1 card', exact: true })
    await dialog.waitFor()
    assert.equal(await page.locator('.hand-scroll').evaluate((hand) => getComputedStyle(hand).opacity), '0',
      'the original hand remained visible behind the discard selection')
    const hand = dialog.getByRole('group', { name: 'Cards available to discard' })
    const selected = dialog.getByRole('group', { name: 'Selected discard' })
    const confirm = dialog.getByRole('button', { name: 'Confirm discard', exact: true, includeHidden: true })
    assert.equal(await hand.locator('.card').count(), 3)
    assert.equal(await dialog.getByRole('button', { name: /^Survivor,/ }).count(), 0)
    assert(await confirm.isDisabled())
    assert.equal(await dialog.locator('h2').innerText(), 'Choose a card to Discard.')
    assert.equal(await dialog.locator('.hand-discard__source .card[data-card-name="Survivor"]').count(), 1)
    await page.screenshot({ path: `${output}/${screen}-choosing.png` })
    const daze = hand.getByRole('button', { name: /^Daze,/ })
    const resting = await daze.boundingBox()
    if (phone) await daze.tap()
    else await daze.hover()
    await page.waitForFunction(() => !document.querySelector('.hand-discard__hand[data-hand-moving]'))
    const raised = await daze.boundingBox()
    assert(raised.y < resting.y - 20 && raised.height > resting.height * 1.15,
      `${screen}: the hovered card must lift and enlarge from the recessed fan`)
    assert(raised.y >= 0 && raised.y + raised.height <= await page.evaluate(() => innerHeight))
    await page.screenshot({ path: `${output}/${screen}-hover.png` })
    await dialog.getByRole('button', { name: 'View battlefield', exact: true }).click()
    assert(await dialog.getByRole('button', { name: 'Return to card selection', exact: true }).isVisible())
    assert.equal(await dialog.locator('.hand-discard__source .card__art').isVisible(), false)
    await page.keyboard.press('2')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), initial,
      'viewing the battlefield must not enable gameplay shortcuts')
    await page.keyboard.press('Escape')
    assert(await dialog.isVisible(), 'leaving the battlefield preview must not cancel the play')
    await hand.getByRole('button', { name: /^Daze,/ }).click()
    assert.equal(await selected.locator('.card').count(), 1)
    assert(await confirm.isEnabled())
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), initial,
      'selecting the discard committed Survivor before confirmation')
    await selected.locator('.card').click()
    assert(await confirm.isDisabled(), 'the selection could not be undone')
    await hand.getByRole('button', { name: /^Strike,/ }).click()
    await hand.getByRole('button', { name: /^Daze,/ }).click()
    assert((await selected.locator('.card').getAttribute('aria-label')).startsWith('Daze,'))
    assert.equal(await hand.locator('.card').count(), 2)
    assert(await dialog.evaluate((element) => {
      const controls = [...element.querySelectorAll('.hand-discard__selection .card, footer button')]
      return controls.every((node) => {
        const box = node.getBoundingClientRect()
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      })
    }), `${screen}: Survivor's cards or confirmation controls are clipped`)
    await page.screenshot({ path: `${output}/${screen}-selected.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.notEqual(await page.locator('.hand-scroll').evaluate((hand) => getComputedStyle(hand).opacity), '0',
      'cancelling failed to restore the normal hand')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), initial,
      'cancelling the uncommitted play spent cards or Energy')
    await play()
    await dialog.waitFor()
    await page.keyboard.press('2')
    assert.equal(await selected.locator('.card[data-card-name="Daze"]').count(), 1,
      'the numbered fan shortcut must choose a discard, not play the underlying hand card')
    await confirm.focus()
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    const result = await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0])
    assert.equal(result.block, 2)
    assert.equal(result.energy, 2)
    assert.deepEqual(result.discard.map((card) => card.uid).sort(), ['discard-daze', 'survivor-source'])
    assert.equal(result.hand.length, 2)
    await page.evaluate((run) => window.__STS_DEBUG__.setRun(run),
      fixture([{ id: playerId, name: 'Silent', character: 'silent' }], `${screen}-alone`, true, true))
    await page.locator('.hand .card').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 3)
    assert.equal(await dialog.count(), 0, 'a lone Survivor was stranded in an empty discard selection')
    const singleDiscard = fixture([{ id: playerId, name: 'Silent', character: 'silent' }], `${screen}-single`)
    singleDiscard.combat.players[0].hand = singleDiscard.combat.players[0].hand.slice(0, 2)
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), singleDiscard)
    await play()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 2)
    assert.equal(await dialog.count(), 0, 'Survivor must automatically discard its only candidate')
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].discard.map(card => card.uid)),
      ['discard-strike', 'survivor-source'])
    const reference = fixture([{ id: playerId, name: 'Silent', character: 'silent' }], `${screen}-reference`)
    reference.combat.players[0].hand = [reference.combat.players[0].hand[0],
      ...['defend_silent', 'neutralize', 'strike_silent', 'defend_silent', 'strike_silent', 'defend_silent']
        .map((defId, index) => ({ uid: `reference-${index}`, defId, upgraded: false }))]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), reference)
    await play()
    await dialog.waitFor()
    await page.mouse.move(0, 0)
    await page.waitForFunction(() => !document.querySelector('.hand-discard__hand[data-hand-moving]'))
    assert(await dialog.evaluate(element => {
      const source = element.querySelector('.hand-discard__source').getBoundingClientRect()
      const heading = element.querySelector('h2').getBoundingClientRect()
      const header = document.querySelector('.app-shell__header').getBoundingClientRect()
      return Math.abs(source.x + source.width / 2 - innerWidth / 2) < 2 &&
        source.top > innerHeight * .2 && source.bottom < innerHeight * .65 &&
        heading.top >= header.bottom && heading.bottom < source.top &&
        Number.parseFloat(getComputedStyle(element).getPropertyValue('--selection-header-bottom')) === header.bottom
    }), `${screen}: the title, dimmed source card, and unobscured header must match the reference proportions`)
    await page.screenshot({ path: `${output}/${screen}-reference.png` })
    const neutralize = hand.getByRole('button', { name: /^Neutralize,/ })
    const box = await neutralize.boundingBox()
    const position = { x: box.width / 2, y: 30 }
    if (phone) await neutralize.tap({ position })
    else await neutralize.hover({ position })
    await page.waitForFunction(() => !document.querySelector('.hand-discard__hand[data-hand-moving]'))
    assert.equal(await selected.locator('.card').count(), 0, 'previewing a fanned card must not select it')
    await page.screenshot({ path: `${output}/${screen}-reference-hover.png` })
    if (phone) await neutralize.tap()
    else await neutralize.click()
    assert.equal(await selected.locator('.card[data-card-name="Neutralize"]').count(), 1)
    await dialog.getByRole('button', { name: 'Cancel play', exact: true }).click()
    await context.close()

    const online = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone })
    const tab = await online.newPage()
    tab.on('pageerror', (error) => errors.push(error.message))
    await tab.goto(origin)
    await tab.getByRole('button', { name: 'Play online', exact: true }).click()
    await tab.locator('.online-character-roster').getByRole('button', { name: 'Silent', exact: true }).click()
    await tab.getByRole('button', { name: 'Create room', exact: true }).click()
    await tab.locator('.online-lobby').waitFor()
    const session = await tab.evaluate(() => JSON.parse(sessionStorage.getItem('sts-room-session')))
    const room = rooms.store.rooms.get(session.code)
    room.phase = 'run'
    room.run = fixture(room.seats.map((seat) => ({ id: seat.playerId, name: seat.name, character: seat.character })), `online-${screen}`, true)
    room.version++
    rooms.publishRoom(session.code)
    await tab.locator('.hand .card[data-card-name="Survivor+"]').focus()
    await tab.keyboard.press('Enter')
    const onlineDialog = tab.getByRole('dialog', { name: 'Discard 1 card', exact: true })
    await onlineDialog.getByRole('group', { name: 'Cards available to discard' }).getByRole('button', { name: /^Daze,/ }).click()
    assert.equal(room.run.combat.players[0].energy, 3)
    assert.equal(room.run.combat.players[0].block, 0)
    await onlineDialog.getByRole('button', { name: 'Confirm discard', exact: true }).click()
    await onlineDialog.waitFor({ state: 'detached' })
    await tab.waitForFunction(() => document.querySelector('.hand .card[data-card-name="Survivor+"]') === null)
    assert.equal(room.run.combat.players[0].block, 3)
    assert.equal(room.run.combat.players[0].energy, 2)
    assert.deepEqual(room.run.combat.players[0].discard.map((card) => card.uid).sort(), ['discard-daze', 'survivor-source'])
    const exhaustRun = fixture(room.seats.map(seat => ({
      id: seat.playerId, name: seat.name, character: seat.character,
    })), `online-exhaust-${screen}`, true)
    exhaustRun.combat.players[0].hand[0].defId = 'sever_soul'
    room.run = exhaustRun
    room.version++
    rooms.publishRoom(session.code)
    await tab.locator('.hand .card[data-card-name="Sever Soul+"]').focus()
    await tab.keyboard.press('Enter')
    const exhaustDialog = tab.getByRole('dialog', { name: 'Exhaust 1 or 2 cards', exact: true })
    const exhaustHand = exhaustDialog.getByRole('group', { name: 'Cards available to exhaust' })
    const exhaustSelected = exhaustDialog.getByRole('group', { name: 'Selected exhaust' })
    const exhaustConfirm = exhaustDialog.getByRole('button', { name: 'Confirm exhaust', exact: true, includeHidden: true })
    await exhaustHand.getByRole('button', { name: /^Daze,/ }).focus()
    await tab.keyboard.press('Enter')
    assert(await exhaustSelected.locator('.card').evaluate(card => document.activeElement === card),
      'keyboard selection must follow the card into the selected area')
    await tab.keyboard.press('Enter')
    assert(await exhaustConfirm.isDisabled(), 'putting the card back must restore the required selection')
    assert(await exhaustHand.getByRole('button', { name: /^Daze,/ })
      .evaluate(card => document.activeElement === card), 'putting a card back must restore its keyboard focus')
    await tab.keyboard.press('Enter')
    assert.equal(room.run.combat.players[0].energy, 3)
    assert.equal(room.run.combat.players[0].exhaust.length, 0)
    await exhaustConfirm.click()
    await exhaustDialog.waitFor({ state: 'detached' })
    await tab.locator('[data-enemy-id="survivor-enemy"] .enemy__hit-area').click()
    await tab.waitForFunction(() => !document.querySelector('.hand .card[data-card-name="Sever Soul+"]'))
    assert.equal(room.run.combat.players[0].energy, 1)
    assert.deepEqual(room.run.combat.players[0].exhaust.map(card => card.uid), ['discard-daze'])
    assert.equal(room.run.combat.enemies[0].hp, 26)
    const singleOnline = fixture(room.seats.map(seat => ({
      id: seat.playerId, name: seat.name, character: seat.character,
    })), `online-single-${screen}`)
    singleOnline.combat.players[0].hand = singleOnline.combat.players[0].hand.slice(0, 2)
    room.run = singleOnline
    room.version++
    rooms.publishRoom(session.code)
    await tab.locator('.hand .card[data-card-name="Survivor"]').focus()
    await tab.keyboard.press('Enter')
    await tab.waitForFunction(() => !document.querySelector('.hand .card[data-card-name="Survivor"]'))
    assert.equal(await onlineDialog.count(), 0)
    assert.deepEqual(room.run.combat.players[0].discard.map(card => card.uid), ['discard-strike', 'survivor-source'])
    await online.close()
    console.log(`PASS ${screen}: Survivor selection, replacement, cancellation, confirmation and authoritative co-op play`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
