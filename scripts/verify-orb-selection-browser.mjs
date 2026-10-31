import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat, playCard } from '../src/game/combat.ts'

const output = 'artifacts/orb-selection'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: `http://127.0.0.1:${address.port}` }, '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true } },
} })
await server.listen()
const browser = await chromium.launch()
const errors = []
let fixtureId = 0
function fixture(players, upgraded = false) {
  const run = createRun(47, players)
  run.phase = 'combat'
  run.neow = null
  run.combat = createCombat({ seed: 47, calls: 0 }, run.players, [{
    uid: 'orb-enemy', defId: 'jaw_worm', row: 0, isBoss: false, hp: 40, maxHp: 40,
    block: 0, strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false,
    goldReward: 0, cardReward: null, dead: false,
  }], `orb-selection-${fixtureId++}`)
  Object.assign(run.combat, { phase: 'player', startTurnProgress: undefined, pendingTriggers: [] })
  Object.assign(run.combat.players[0], {
    energy: 3, block: 0, relics: [], powers: [], potions: [], draw: [], discard: [], exhaust: [],
    hand: [{ uid: 'dual', defId: 'dual_cast', upgraded }], orbs: ['lightning', 'frost', 'dark'],
  })
  return run
}
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    page.on('pageerror', error => errors.push(error.message))
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    await page.goto(origin)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
      await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const id = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].id)
    const players = [{ id, name: 'Defect', character: 'defect' }]
    const state = () => page.evaluate(() => window.__STS_DEBUG__.getState())
    const load = async run => {
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
      await page.waitForFunction(id => window.__STS_DEBUG__.getState()?.combatId === id, run.combat.combatId)
    }
    const play = async () => {
      await page.locator('.hand .card[data-card-name^="Dual Cast"]').focus()
      await page.keyboard.press('Enter')
    }
    const activate = async button => phone ? button.tap() : button.click()
    const dialog = page.getByRole('dialog', { name: 'Choose an Orb to Evoke', exact: true })
    const available = dialog.getByRole('group', { name: 'Orbs available to Evoke' })
    const selected = dialog.getByRole('group', { name: 'Selected Orb' })
    const confirm = dialog.getByRole('button', { name: 'Confirm evoke', exact: true, includeHidden: true })
    const orb = (type, slot) => available.getByRole('button', { name: `Evoke ${type} Orb ${slot}`, exact: true })
    for (const upgraded of [false, true]) {
      const run = fixture(players, upgraded)
      await load(run)
      const before = await state()
      await play()
      await dialog.waitFor()
      assert(await confirm.isDisabled())
      assert.equal(await dialog.locator('.hand-discard__source .card').count(), 1)
      assert.equal(await available.locator('button').count(), 3)
      assert.equal(await page.locator('.orbs__target').count(), 0)
      assert(await dialog.evaluate(element => {
        const title = element.querySelector('h2').getBoundingClientRect()
        const source = element.querySelector('.hand-discard__source').getBoundingClientRect()
        const header = document.querySelector('.app-shell__header').getBoundingClientRect()
        return title.top >= header.bottom && source.top > title.bottom && source.bottom < innerHeight * .65
      }), `${screen}: Orb selection must share the discard screen's title and source-card placement`)
      await page.screenshot({ path: `${output}/${screen}-${upgraded ? 'upgraded' : 'base'}-choices.png` })
      await dialog.getByRole('button', { name: 'View battlefield', exact: true }).click()
      await page.keyboard.press('2')
      assert.equal(await selected.locator('button').count(), 0, 'battlefield peek must not accept Orb shortcuts')
      await page.keyboard.press('Escape')
      await dialog.getByRole('button', { name: 'View battlefield', exact: true }).waitFor()
      await page.keyboard.press('2')
      assert.equal(await selected.locator('[data-orb-slot="1"]').count(), 1)
      assert(await selected.locator('button').evaluate(element => document.activeElement === element))
      await activate(selected.locator('button'))
      assert(await confirm.isDisabled(), 'a chosen Orb must be removable')
      await activate(orb('lightning', 1))
      await activate(orb('frost', 2))
      assert.equal(await selected.locator('[data-orb-slot="1"]').count(), 1, 'a different Orb must replace the tentative choice')
      assert.deepEqual(await state(), before, 'tentative Orb choices must not spend Energy or resolve effects')
      assert(await dialog.evaluate(element => {
        const controls = [...element.querySelectorAll('.orb-selection__option, .hand-discard__footer > button')]
        const boxes = controls.map(control => control.getBoundingClientRect())
        return boxes.every(box => box.width >= 44 && box.height >= 44 && box.left >= 0 && box.top >= 0 &&
          box.right <= innerWidth && box.bottom <= innerHeight) &&
          boxes.every((box, i) => boxes.every((other, j) => i === j || box.right <= other.left ||
            other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top))
      }), `${screen}: selected Orb, choices, and footer controls must fit without overlapping`)
      assert(await available.evaluate(element => {
        const area = element.getBoundingClientRect()
        return [...element.querySelectorAll('button')].every(button => {
          const box = button.getBoundingClientRect()
          return box.top >= area.top && box.bottom <= area.bottom + 1
        })
      }), `${screen}: the Orb choices and slot labels must not be clipped by their scrollport`)
      await page.mouse.move(0, 0)
      await page.evaluate(() => document.activeElement?.blur())
      await page.screenshot({ path: `${output}/${screen}-${upgraded ? 'upgraded' : 'base'}-selected.png` })
      await activate(dialog.getByRole('button', { name: 'Cancel play', exact: true }))
      await dialog.waitFor({ state: 'detached' })
      assert.deepEqual(await state(), before, 'cancelling must preserve the whole combat')
      await play()
      await activate(orb('frost', 2))
      await activate(confirm)
      await dialog.waitFor({ state: 'detached' })
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].block === 2)
      const after = await state()
      assert.equal(after.players[0].energy, upgraded ? 3 : 2)
      assert.deepEqual(after.players[0].orbs, ['lightning', null, 'dark'])
    }

    const reordered = fixture(players)
    reordered.combat.players[0].hand = [{ uid: 'fission', defId: 'fission', upgraded: true }]
    reordered.combat.players[0].orbs = ['frost', 'frost', 'frost']
    await load(reordered)
    await page.locator('.hand .card[data-card-name="Fission+"]').focus()
    await page.keyboard.press('Enter')
    await activate(orb('frost', 2))
    await activate(confirm)
    await page.waitForFunction(() => document.querySelectorAll('.orb-selection__choices button').length === 2)
    assert.equal(await selected.locator('button').count(), 0, 'the next Orb choice must not reuse the previous selection')
    assert(await confirm.isDisabled())
    assert.deepEqual((await state()).players[0].orbs, ['frost', 'frost', 'frost'], 'the ordered Evokes must remain a draft')
    await activate(orb('frost', 3))
    await activate(confirm)
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].block === 3)
    assert.deepEqual((await state()).players[0].orbs, [null, null, null])

    const refreshed = fixture(players)
    await load(refreshed)
    await play()
    await activate(orb('frost', 2))
    refreshed.combat.players[0].orbs[1] = 'lightning'
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), refreshed)
    await orb('lightning', 2).waitFor()
    assert(await confirm.isDisabled(), 'a live update replacing an Orb must invalidate its tentative selection')
    await activate(dialog.getByRole('button', { name: 'Cancel play', exact: true }))

    const copied = fixture(players)
    copied.combat.players[0].doubledCardsThisTurn = 1
    copied.combat = playCard(copied.combat, id, 'dual',
      { enemyUid: null, playerId: null, evokeSlots: [1], evokeEnemyUids: [null, null] })
    assert(copied.combat.pendingCardCopy)
    await load(copied)
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Cancel play', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    assert(await dialog.isVisible(), 'a mandatory copy must not be dismissed')
    await activate(orb('dark', 3))
    await activate(confirm)
    await page.waitForFunction(() => !window.__STS_DEBUG__.getState().pendingCardCopy)
    assert.equal((await state()).enemies[0].hp, 34)
    assert.equal((await state()).players[0].energy, 2, 'the copy must not pay again')
    await page.close()

    const online = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    online.on('pageerror', error => errors.push(error.message))
    await online.goto(origin)
    await online.getByRole('button', { name: 'Play online', exact: true }).click()
    await online.locator('.online-character-roster').getByRole('button', { name: 'Defect', exact: true }).click()
    await online.getByRole('button', { name: 'Create room', exact: true }).click()
    await online.locator('.online-lobby').waitFor()
    const session = await online.evaluate(() => JSON.parse(sessionStorage.getItem('sts-room-session')))
    const room = rooms.store.rooms.get(session.code)
    room.phase = 'run'
    room.run = fixture(room.seats.map(seat => ({ id: seat.playerId, name: seat.name, character: seat.character })))
    room.version++
    rooms.publishRoom(session.code)
    await online.locator('.hand .card[data-card-name="Dual Cast"]').focus()
    await online.keyboard.press('Enter')
    const before = structuredClone(room.run.combat)
    await online.getByRole('button', { name: 'Evoke frost Orb 2', exact: true }).click()
    assert.deepEqual(room.run.combat, before, 'the server must not receive a tentative selection')
    await online.getByRole('button', { name: 'Confirm evoke', exact: true }).click()
    await online.locator('.hand-discard').waitFor({ state: 'detached' })
    await online.waitForFunction(() => !document.querySelector('.hand .card[data-card-name="Dual Cast"]'))
    assert.equal(room.run.combat.players[0].block, 2)
    assert.equal(room.run.combat.players[0].energy, 2)
    assert.deepEqual(room.run.combat.players[0].orbs, ['lightning', null, 'dark'])
    await online.close()
    console.log(`PASS ${screen}: shared Orb chooser, selection/undo/cancel, keyboard/touch, mandatory copy and authoritative confirmation`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
