import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat } from '../src/game/combat.ts'
import { createRng } from '../src/game/rng.ts'

const output = 'artifacts/potion-header'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: `http://127.0.0.1:${address.port}` }, '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true } },
} })
await server.listen()
const browser = await chromium.launch()
const errors = []
const enemy = { uid: 'potion-enemy', defId: 'jaw_worm', row: 0, isBoss: false,
  hp: 30, maxHp: 30, block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0,
  goldReward: 0, cardReward: null, actionIndex: 0, abilityUsed: false, dead: false }
const checkBelt = async (page, potions, slots = 3) => {
  const belt = page.getByRole('complementary', { name: 'Potion inventory' })
  await belt.waitFor()
  await page.waitForFunction(({ potions, slots }) => {
    const belt = document.querySelector('.app-shell__header .outside-potions')
    const icons = belt?.querySelectorAll('.outside-potions__item > .potion-chip > .item-icon-image, .outside-potions__item > .potion-chip > button > .item-icon-image')
    return belt?.querySelectorAll('.outside-potions__item').length === slots &&
      belt.querySelectorAll('.outside-potions__empty').length === slots - potions.length &&
      icons.length === potions.length && [...icons].every((icon, index) =>
        icon.getAttribute('src').split('/').at(-1) === `${potions[index]}.png`)
  }, { potions, slots })
  assert.deepEqual(await belt.locator('.outside-potions__item > .potion-chip > .item-icon-image, .outside-potions__item > .potion-chip > button > .item-icon-image')
    .evaluateAll((icons) => icons.map((icon) => icon.getAttribute('src').split('/').at(-1))), potions.map((id) => `${id}.png`))
  assert(await belt.evaluate((element) => {
    const parent = element.parentElement
    const gold = [...parent.children].find((child) => child.querySelector('.icon-value'))
    const relics = parent.querySelector('.relic-bar')
    const box = element.getBoundingClientRect()
    const goldBox = gold.getBoundingClientRect()
    const relicBox = relics.getBoundingClientRect()
    return box.left >= goldBox.right && box.right <= relicBox.left &&
      box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth
  }), 'potion slots must fit between Gold and relics')
  return belt
}

try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
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
    await checkBelt(page, [])
    for (const potions of [['fire_potion'], ['fire_potion', 'block_potion', 'energy_potion'], []]) {
      await page.evaluate((potions) => {
        const run = structuredClone(window.__STS_DEBUG__.getRun())
        run.phase = 'map'; run.neow = null
        run.players[0].potions = potions
        window.__STS_DEBUG__.setRun(run)
      }, potions)
      await checkBelt(page, potions)
    }
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.ascension = 4
      window.__STS_DEBUG__.setRun(run)
    })
    const belt = await checkBelt(page, [])
    assert.equal(await belt.getByRole('img', { name: 'Potion slot 3 unavailable at this Ascension' }).count(), 1)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.ascension = 0
      run.players[0].relics.push({ defId: 'potion_belt', spent: false })
      window.__STS_DEBUG__.setRun(run)
    })
    await checkBelt(page, [], 5)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.players[0].relics = run.players[0].relics.filter((relic) => relic.defId !== 'potion_belt')
      run.players[0].potions = ['blood_potion']
      run.players[0].hp = 5
      window.__STS_DEBUG__.setRun(run)
    })
    await checkBelt(page, ['blood_potion'])
    await belt.getByRole('button', { name: 'Use Blood Potion', exact: true }).focus()
    await page.keyboard.press('Enter')
    await checkBelt(page, [])
    assert(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].hp > 5),
      'the moved out-of-combat potion action stopped working')
    const heldPotions = ['fire_potion', 'weak_potion', 'swift_potion']
    await page.evaluate(async potions => {
      const { EVENT_DEFINITIONS } = await import('/src/game/events.ts')
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      const id = run.players[0].id
      run.phase = 'room'
      run.players[0].potions = potions
      run.roomState = {
        kind: 'event',
        card: { ...EVENT_DEFINITIONS.lab, instanceId: 'tooltip-lab', act: 1,
          minAscension: 0, requiresColorlessUnlock: false },
        decisions: {}, dieRolls: {},
        pendingDecisions: { [id]: { optionIds: ['resolve'] } },
        itemOffers: { [id]: [{ kind: 'potion', id: 'block_potion' }] },
      }
      window.__STS_DEBUG__.setRun(run)
    }, heldPotions)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().roomState?.card.instanceId === 'tooltip-lab')
    await checkBelt(page, heldPotions)
    const reward = page.locator('.event-loot').filter({ hasText: 'Block Potion' })
    await reward.getByRole('button', { name: 'Take', exact: true }).click()
    const swaps = reward.getByRole('group', { name: 'Replace', exact: true })
    await swaps.waitFor()
    const beforeReading = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    for (let index = 0; index < heldPotions.length; index++) {
      const headerIcon = belt.locator('.outside-potions__item > .potion-chip').nth(index)
      if (phone) await headerIcon.focus()
      else await headerIcon.hover()
      const tip = page.locator('.potion-tip')
      await tip.waitFor()
      const headerText = await tip.innerText()
      const replacement = swaps.getByRole('button').nth(index)
      if (phone) await replacement.focus()
      else await replacement.hover()
      await tip.waitFor()
      assert.equal(await tip.innerText(), headerText, 'replacement potions must use the header tooltip')
      assert.equal(await replacement.getAttribute('aria-pressed'), 'false', 'reading a potion selected it')
      assert(await tip.evaluate(tip => {
        const box = tip.getBoundingClientRect()
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      }), 'the replacement tooltip must not be clipped by the event panel')
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeReading)
    const replacement = swaps.getByRole('button').first()
    if (phone) await replacement.tap()
    else await replacement.click()
    assert.equal(await replacement.getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].potions), heldPotions)
    await page.getByRole('button', { name: /Resolve rewards/ }).click()
    await checkBelt(page, ['weak_potion', 'swift_potion', 'block_potion'])
    const solo = await page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun()))
    solo.phase = 'combat'
    solo.players[0].potions = ['fire_potion']
    solo.combat = createCombat(createRng(12), solo.players, [enemy], `header-${screen}`)
    solo.combat.players[0].potions = ['block_potion', 'energy_potion']
    await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), solo)
    await checkBelt(page, ['block_potion', 'energy_potion'])
    assert.equal(await belt.getByRole('button').count(), 0, 'combat inventory bypassed combat action controls')
    await page.getByRole('button', { name: 'Use Block Potion', exact: true }).focus()
    await page.keyboard.press('Enter')
    await checkBelt(page, ['energy_potion'])
    await page.screenshot({ path: `${output}/${screen}-solo.png` })
    await context.close()

    const online = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone })
    const tab = await online.newPage()
    tab.on('pageerror', (error) => errors.push(error.message))
    await tab.goto(origin)
    await tab.getByRole('button', { name: 'Play online', exact: true }).click()
    await tab.getByRole('button', { name: 'Create room', exact: true }).click()
    await tab.locator('.online-lobby').waitFor()
    const session = await tab.evaluate(() => JSON.parse(sessionStorage.getItem('sts-room-session')))
    const room = rooms.store.rooms.get(session.code)
    room.phase = 'run'
    room.run = createRun(12, room.seats.map((seat) => ({ id: seat.playerId, name: seat.name, character: seat.character })))
    room.run.neow = null
    room.run.phase = 'combat'
    room.run.players[0].potions = ['fire_potion']
    room.run.combat = createCombat(createRng(12), room.run.players, [enemy], `online-header-${screen}`)
    room.run.combat.players[0].potions = ['block_potion']
    room.version++
    rooms.publishRoom(session.code)
    await checkBelt(tab, ['block_potion'])
    await tab.getByRole('button', { name: 'Use Block Potion', exact: true }).focus()
    await tab.keyboard.press('Enter')
    await checkBelt(tab, [])
    await tab.screenshot({ path: `${output}/${screen}-online.png` })
    await online.close()
    console.log(`PASS ${screen}: persistent potion slots, live combat inventory, capacity and header order`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
