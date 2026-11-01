// The reported three-seat party, driven through real room actions on both supported screen classes.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium, setTestUsername } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { apply, snapshotFor, startRun } from './lib/rooms.mjs'
import { createCombat } from '../src/game/combat/create.ts'
import { GAME_SETTINGS_KEY } from '../src/ui/game-settings.ts'

const out = 'artifacts/start-turn-party'
mkdirSync(out, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const target = `http://127.0.0.1:${address.port}`
const vite = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target }, '/ws': { target, ws: true } } } })
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
let room
let originalPlayers
const card = (uid, defId, upgraded = false) => ({ uid, defId, upgraded })
const errors = []
const pages = []
let fixture = 0

function loadParty(summons = false) {
  const players = structuredClone(originalPlayers)
  Object.assign(players[0], { powers: [card('hello', 'slayer_hello_world'), card('storm', 'storm', true)],
    orbs: summons ? ['lightning', 'lightning', 'lightning'] : ['lightning', 'frost', 'dark'], relics: [], potions: [] })
  Object.assign(players[1], { powers: [card('fumes', 'noxious_fumes', true)],
    relics: [{ defId: 'pen_nib', spent: false }, ...summons ? [] : [{ defId: 'gambling_chip', spent: false }]], potions: [] })
  Object.assign(players[2], { powers: [], potions: summons ? [] : ['gamblers_brew'],
    relics: summons ? [] : [{ defId: 'the_abacus', spent: false }, { defId: 'toolbox', spent: false }] })
  const enemies = (summons ? [0, 1] : [0, 1, 2, 1, 0]).map((row, index) => ({
    uid: `e${index}`, defId: index === (summons ? 0 : 4) ? 'slime_boss' : 'cultist', row, isBoss: index === (summons ? 0 : 4),
    hp: summons ? 1 : index === 1 ? 7 : 50, maxHp: 50, block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0,
    goldReward: 0, cardReward: null, actionIndex: 0, abilityUsed: false, dead: false, phase: 0,
  }))
  const combat = createCombat(room.run.rng, players, enemies, `party-${fixture++}`)
  combat.turn = 1
  combat.phase = 'roundEnd'
  room.run = { ...room.run, phase: 'combat', neow: null, combat }
  apply(room, room.seats[0].token, { kind: 'startTurn' })
  if (summons) {
    assert.equal(room.run.combat.phase, 'start')
    room.run.combat.die = 5
    room.startTurnRequired = undefined
    room.startTurnReady = undefined
  }
  room.version += 1
  rooms.publishRoom(room.code)
}

const snapshot = (index) => snapshotFor(room, room.seats[index].token)
const resolveButton = (page) => page.getByRole('button', { name: /^(Resolve start|Confirm start-of-turn|Confirm Noxious)/ })
async function action(page, click) {
  const before = room.version
  await click()
  for (let attempt = 0; room.version <= before && attempt < 500; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert(room.version > before, 'the action was not accepted')
}
async function waiting(page, name) {
  const button = page.getByRole('button', { name: new RegExp(`Waiting for ${name}`) })
  await button.waitFor({ timeout: 5000 })
  assert(await button.isDisabled(), 'a confirmed seat can submit the same decision twice')
  const box = await button.boundingBox()
  const viewport = page.viewportSize()
  assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height, 'the waiting control leaves the viewport')
}

try {
  let code
  for (const character of ['Defect', 'Silent', 'Watcher']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    await context.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ reducedMotion: true, bgmVolume: 0, sfxVolume: 0 }))
    }, GAME_SETTINGS_KEY)
    const page = await context.newPage()
    pages.push(page)
    page.setDefaultTimeout(10_000)
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await setTestUsername(page, character)
    const online = page.getByRole('button', { name: 'Play online', exact: true })
    await online.waitFor({ timeout: 60_000 })
    await online.click()
    await page.locator('.online-character-roster').getByRole('button', { name: character }).click()
    if (code) {
      await page.getByLabel('Room code').fill(code)
      await page.getByRole('button', { name: 'Join', exact: true }).click()
    } else await page.getByRole('button', { name: 'Create room', exact: true }).click()
    await page.locator('.online-lobby').waitFor()
    await page.locator('.connection--connected').waitFor()
    code = await page.locator('.online-lobby h1').textContent()
  }
  room = rooms.store.rooms.get(code)
  startRun(room, room.seats[0].token, { seed: 7 })
  originalPlayers = structuredClone(room.run.players)
  const [defect, silent, watcher] = pages
  for (const [screen, width, height] of [['desktop', 1440, 900], ['phone', 844, 390]]) {
    for (const page of pages) await page.setViewportSize({ width, height })
    loadParty()
    await Promise.all(pages.map((page) => page.locator('.combat[data-phase="start"]').waitFor({ timeout: 60_000 })))
    console.log(`${screen}: modifiers`)
    await resolveButton(silent).waitFor()
    if (screen === 'desktop') {
      // Hold the actual request to exercise a double-click before its acknowledgement.
      let release
      let intercepted
      let confirmations = 0
      const held = new Promise((resolve) => { release = resolve })
      const pending = new Promise((resolve) => { intercepted = resolve })
      const pattern = `**/api/rooms/${room.code}/action`
      const hold = async (route) => {
        if (route.request().postDataJSON()?.action?.kind === 'resolveStartTurn') {
          confirmations += 1
          intercepted()
          await held
        }
        await route.continue()
      }
      await silent.route(pattern, hold)
      await Promise.all([
        action(silent, () => resolveButton(silent).dblclick()),
        (async () => {
          try {
            await pending
            const confirming = silent.getByRole('button', { name: 'Confirming…', exact: true })
            await confirming.waitFor()
            assert(await confirming.isDisabled(), 'a pending start-turn confirmation remains clickable')
          } finally { release() }
        })(),
      ])
      await silent.unroute(pattern, hold)
      assert.equal(confirmations, 1, 'a double-click sent two confirmations')
    } else await action(silent, () => resolveButton(silent).click())
    await waiting(silent, 'Watcher')
    await action(watcher, () => watcher.getByRole('button', { name: /^Use The Abacus:/ }).click())
    assert(!snapshot(1).startTurnDecided.includes('p2'), 'a die change did not reopen a declined modifier')
    await resolveButton(silent).waitFor()
    await action(watcher, () => watcher.getByRole('button', { name: /^Use Toolbox:/ }).click())
    await action(silent, () => silent.getByRole('button', { name: /^Use Gambling Chip:/ }).click())
    await watcher.getByRole('button', { name: "Use Gambler's Brew", exact: true }).click()
    await action(watcher, () => watcher.locator('.prompt').getByRole('button', { name: '5', exact: true }).click())
    assert.equal(snapshot(0).startTurnPostRollLocked, true)
    assert.equal(room.run.combat.die, 5)

    console.log(`${screen}: effects`)
    // Make room for Hello World, then Evoke that new Orb and Storm+'s first Lightning.
    await defect.getByRole('button', { name: 'Evoke frost Orb 2', exact: true }).click()
    await defect.getByRole('button', { name: 'Evoke dark Orb 2', exact: true }).click()
    await defect.locator('[data-enemy-id="e1"].enemy--targeted .enemy__hit-area').click()
    await defect.getByRole('button', { name: 'Evoke lightning Orb 2', exact: true }).click()
    await defect.locator('[data-enemy-id="e1"].enemy--targeted .enemy__hit-area').click()
    await action(defect, () => resolveButton(defect).click())
    await waiting(defect, 'Silent')
    await defect.screenshot({ path: `${out}/${screen}-waiting.png` })
    const confirmOrder = silent.getByRole('button', { name: 'Confirm start-of-turn order', exact: true })
    if (await confirmOrder.count()) await action(silent, () => confirmOrder.click())
    await silent.locator('[data-enemy-id="e3"].enemy--targeted .enemy__hit-area').click()
    const orderPanel = silent.locator('.start-turn-order')
    if (await orderPanel.getAttribute('open') === null) await orderPanel.locator('summary').click()
    const poisonBadge = silent.getByRole('button', { name: /^Applying 1 Poison/ })
    const beforeRetarget = JSON.stringify(room.run.combat)
    await poisonBadge.click()
    assert.equal(await orderPanel.getAttribute('open'), null, 'editing a target must clear the board')
    await silent.locator('[data-enemy-id="e0"].enemy--targeted .enemy__hit-area').click()
    await orderPanel.locator('summary').click()
    await poisonBadge.focus()
    await silent.keyboard.press('Enter')
    assert.equal(await orderPanel.getAttribute('open'), null, 'keyboard retargeting must clear the board')
    await silent.locator('[data-enemy-id="e3"].enemy--targeted .enemy__hit-area').click()
    assert.equal(JSON.stringify(room.run.combat), beforeRetarget, 'editing an online target must not submit or apply it')
    for (const other of [defect, watcher]) assert.equal(
      await other.locator('.start-turn-order button.start-turn-order__badge').count(), 0,
      "a teammate must not be able to edit the active owner's target")
    await action(silent, () => resolveButton(silent).click())
    assert.equal(room.run.combat.phase, 'start', 'Pen Nib skipped its owner target choice')
    assert.equal(await orderPanel.getAttribute('open'), null, 'a submitted step must not cover the next target')
    await silent.locator('[data-enemy-id="e3"].enemy--targeted .enemy__hit-area').click()
    await action(silent, () => resolveButton(silent).click())
    for (const page of pages) await page.locator('.combat[data-phase="player"]').waitFor()
    assert.equal(room.run.combat.phase, 'player', 'the party needed a reload to finish its start turn')
    assert.deepEqual(room.run.combat.players[0].orbs, ['lightning', 'lightning', 'dark'])
    assert.equal(room.run.combat.players[0].block, 1)
    assert.equal(room.run.combat.enemies[1].hp, 0)
    assert.deepEqual(room.run.combat.enemies.map((enemy) => enemy.poison), [0, 0, 0, 1, 1])
    assert.deepEqual(room.run.combat.enemies.map((enemy) => enemy.vulnerable), [0, 0, 0, 1, 0])
    for (const page of pages) assert.equal(await page.locator('.online-error').count(), 0)
    assert.deepEqual(errors, [])

    // Every enemy dies before Silent's effects, but the real Slime Boss Split keeps combat going.
    loadParty(true)
    await Promise.all(pages.map((page) => page.locator('.combat[data-phase="start"]').waitFor()))
    await defect.getByRole('button', { name: 'Evoke lightning Orb 1', exact: true }).click()
    await defect.locator('[data-enemy-id="e0"].enemy--targeted .enemy__hit-area').click()
    await defect.getByRole('button', { name: 'Evoke dark Orb 1', exact: true }).click()
    // The projected board now has one living enemy, so Dark targets it automatically.
    await defect.locator('[data-enemy-id="e1"].enemy--targeted').waitFor({ state: 'hidden' })
    await defect.getByRole('button', { name: 'Evoke lightning Orb 1', exact: true }).click()
    await action(defect, () => resolveButton(defect).click())
    if (room.run.combat.phase === 'start') {
      const finish = resolveButton(silent)
      await finish.waitFor()
      await action(silent, () => finish.click())
    }
    for (const page of pages) await page.locator('.combat[data-phase="player"]').waitFor()
    assert(room.run.combat.enemies.every((enemy) => enemy.dead))
    assert.deepEqual(room.run.combat.pendingSummons.map((summon) => [summon.row, summon.turn]), [[0, 3], [1, 3], [2, 3]])
    for (const page of pages) assert.equal(await page.locator('.online-error').count(), 0)
    assert.deepEqual(errors, [])
  }
  console.log('✓ start-turn party browser: die changes, three Evokes, row Poison, Pen Nib and waiting controls passed on desktop and horizontal phone')
} finally {
  for (let index = 0; index < pages.length; index++) {
    await pages[index].screenshot({ path: `${out}/final-seat-${index}.png` }).catch(() => {})
  }
  await browser.close()
  await vite.close()
  await rooms.close()
}
