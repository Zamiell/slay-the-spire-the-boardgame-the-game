import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat } from '../src/game/combat.ts'
import { createRng } from '../src/game/rng.ts'
import { pickUpCard } from './lib/card-interactions.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom } from './lib/rooms.mjs'

const output = 'artifacts/card-context-inspection'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: {
  '/api': { target: `http://127.0.0.1:${address.port}` },
  '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true },
} } })
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
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    await page.goto(origin)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const inspector = page.locator('.card-inspection')
    const face = inspector.locator('.card-inspection__card')
    const upgrades = inspector.getByRole('checkbox', { name: 'View Upgrades', exact: true })
    const read = () => page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun()))
    const rightClick = async locator => {
      await locator.focus()
      await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
      const box = await locator.boundingBox()
      assert(box)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
      await inspector.waitFor()
      assert.equal(await inspector.count(), 1)
    }
    const inspect = async (locator, { upgraded = false, upgradeable = true, skin } = {}) => {
      await locator.waitFor()
      const before = await read()
      await rightClick(locator)
      if (upgradeable) {
        assert.equal(await upgrades.isChecked(), upgraded)
        await upgrades.setChecked(!upgraded)
        assert.equal(await upgrades.isChecked(), !upgraded)
      } else assert.equal(await upgrades.count(), 0)
      if (skin) assert((await face.locator('img.card__art').getAttribute('src')).includes(`/skin-cards/${skin}/`))
      await page.keyboard.press('Escape')
      await inspector.waitFor({ state: 'detached' })
      assert.deepEqual(await read(), before, 'inspection must not play, discard, exhaust, buy, or upgrade a card')
      assert(await locator.evaluate(element => document.activeElement === element), 'inspection must restore source focus')
    }

    await page.locator('.reward-screen--card-choice').waitFor()
    await inspect(page.locator('.reward-screen__cards .card').first())
    assert(await page.locator('.reward-screen--card-choice').isVisible(), 'right-click must not take the reward')
    await page.getByRole('button', { name: 'Skip', exact: true }).click()

    const run = createRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad', skin: 'kratos' }])
    run.phase = 'combat'
    run.neow = null
    run.combat = createCombat(createRng(47), run.players, [{
      uid: 'target', defId: 'small_slime', row: 0, isBoss: false, hp: 30, maxHp: 30,
      block: 0, strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0,
      abilityUsed: true, dead: false, goldReward: 0, cardReward: null,
    }], `context-${screen}`)
    Object.assign(run.combat, { phase: 'player', startTurnProgress: undefined, pendingTriggers: [] })
    Object.assign(run.combat.players[0], {
      skin: 'kratos', energy: 3, relics: [], potions: [],
      hand: [
        { uid: 'strike', defId: 'strike_ironclad', upgraded: false },
        { uid: 'defend', defId: 'defend_ironclad', upgraded: true },
        { uid: 'daze', defId: 'daze', upgraded: false },
      ],
      discard: [{ uid: 'discard-bash', defId: 'bash', upgraded: false }],
      powers: [{ uid: 'power', defId: 'inflame', upgraded: false }],
    })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    await inspect(page.locator('.hand .card[data-card-name="Defend+"]'), { upgraded: true, skin: 'kratos' })
    await inspect(page.locator('.hand .card[data-card-name="Daze"]'), { upgradeable: false })
    await inspect(page.locator('.powers .power').first(), { skin: 'kratos' })
    await page.locator('.powers .power').first().click()
    const powerZoom = page.locator('.power__zoom')
    await powerZoom.waitFor()
    const powerBefore = await read()
    const powerBox = await powerZoom.boundingBox()
    await page.mouse.click(powerBox.x + powerBox.width / 2, powerBox.y + powerBox.height / 2, { button: 'right' })
    await inspector.waitFor()
    await upgrades.check()
    await page.keyboard.press('Escape')
    await inspector.waitFor({ state: 'detached' })
    assert.deepEqual(await read(), powerBefore, 'right-clicking the floating Power card must remain read-only')

    await pickUpCard(page, 'Strike')
    await inspect(page.locator('.hand .card[data-card-name="Defend+"]'), { upgraded: true })
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].energy), 3)

    await page.getByRole('button', { name: /^Discard pile,/ }).click()
    const pile = page.getByRole('dialog', { name: 'Discard pile', exact: true })
    await inspect(pile.locator('.card').first())
    assert(await pile.isVisible(), 'closing inspection must leave the pile open')
    await pile.getByRole('button', { name: 'Back', exact: true }).click()

    const exhaustRun = structuredClone(run)
    exhaustRun.combat.combatId += '-exhaust'
    exhaustRun.combat.players[0].hand[0].defId = 'true_grit'
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), exhaustRun)
    await page.locator('.hand .card[data-card-name="True Grit"]').focus()
    await page.keyboard.press('Enter')
    const exhaust = page.getByRole('dialog', { name: 'Exhaust 1 card', exact: true })
    await inspect(exhaust.getByRole('group', { name: 'Cards available to exhaust' })
      .locator('.card[data-card-name="Defend+"]'), { upgraded: true })
    assert.equal(await exhaust.getByRole('group', { name: 'Selected exhaust' }).locator('.card').count(), 0)
    await exhaust.getByRole('button', { name: 'Cancel play', exact: true }).click()

    const smith = createRun(48, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    Object.assign(smith.neow.players.p1, { redRewardPending: false, redReward: null,
      pendingEffect: { kind: 'upgrade', count: 1 } })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), smith)
    const picker = page.locator('.card-picker')
    await inspect(picker.locator('.card-picker__grid .card').first())
    assert(await picker.isVisible(), 'inspection must not close the upgrade picker')
    assert.equal(await picker.locator('.card--selected').count(), 0)
    await picker.getByRole('button', { name: 'Skip reward', exact: true }).click()

    await page.getByRole('button', { name: /^Current deck,/ }).click()
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    await rightClick(deck.locator('.choice-modal__cards .card').nth(1))
    assert.equal(await inspector.getByRole('button', { name: 'Previous card' }).count(), 1)
    assert.equal(await inspector.getByRole('button', { name: 'Next card' }).count(), 1)
    const box = await face.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    assert.equal(await inspector.count(), 1, 'right-clicking an inspection must not recursively open another')
    await page.screenshot({ path: `${output}/${screen}-inspector.png` })
    await page.keyboard.press('Escape')
    await deck.getByRole('button', { name: 'Back', exact: true }).click()

    await page.goto(origin)
    await page.getByRole('button', { name: 'Compendium', exact: true }).click()
    const libraryCard = page.locator('.compendium-card').first()
    await rightClick(libraryCard)
    assert.equal(await page.locator('.compendium__detail[open]').count(), 0, 'right-click must not also invoke left-click detail')
    await page.keyboard.press('Escape')
    await inspector.waitFor({ state: 'detached' })
    await page.goto(origin)
    await page.getByRole('button', { name: 'Shop', exact: true }).click()
    await page.locator('.shop-pack__art').first().click()
    await rightClick(page.locator('.shop-browse__card').first())
    await page.keyboard.press('Escape')
    await inspector.waitFor({ state: 'detached' })
    assert(await page.locator('.shop-browse[open]').isVisible())
    assert.equal(await page.locator('.shop-zoom[open]').count(), 0)

    const room = createRoom(rooms.store)
    const seat = joinRoom(room, { name: 'Inspector', character: 'ironclad' })
    room.phase = 'run'
    room.run = structuredClone(run)
    room.run.players[0].id = seat.playerId
    room.run.combat.players[0].id = seat.playerId
    room.version++
    await page.evaluate(session => sessionStorage.setItem('sts-room-session', JSON.stringify(session)),
      { code: room.code, token: seat.token })
    await page.reload()
    const onlineCard = page.locator('.app-shell--online .hand .card[data-card-name="Defend+"]')
    await onlineCard.waitFor()
    const authoritative = structuredClone(room.run)
    const actions = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/action')) actions.push(request.postData())
    })
    await rightClick(onlineCard)
    assert(await upgrades.isChecked())
    await upgrades.uncheck()
    await page.keyboard.press('Escape')
    await inspector.waitFor({ state: 'detached' })
    assert.deepEqual(room.run, authoritative, 'online inspection must not mutate authoritative state')
    assert.deepEqual(actions, [], 'online inspection must not submit gameplay actions')

    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: read-only right-click inspection across rewards, hand, Powers, piles, choices, library and Shop`)
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
