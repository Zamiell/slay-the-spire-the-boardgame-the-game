import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRun } from '../src/game/run.ts'
import { createCombat, activatePotion, activatePower, playCard, spendSoulburn } from '../src/game/combat.ts'
import { cardDef } from '../src/game/cards.ts'
import { POTIONS } from '../src/game/relics.ts'
import { createRng } from '../src/game/rng.ts'
import { bruiserSlime } from '../src/game/downfall/slime-boss.ts'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom } from './lib/rooms.mjs'

const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: {
  '/api': { target: `http://127.0.0.1:${address.port}` },
  '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true },
} } })
await server.listen()
const browser = await chromium.launch()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const card = (defId, uid = defId) => ({ defId, uid, upgraded: false })
let sequence = 0
function fixture({ enemies = 1, potions = [], power, character = 'ironclad', hand = [], orbs,
  soulburn = 0, die = 1, relics = [] } = {}) {
  const run = createRun(107, [{ id: 'p1', name: 'Target test', character }])
  run.phase = 'combat'
  run.neow = null
  run.combat = createCombat(createRng(107), run.players, Array.from({ length: enemies }, (_, index) => ({
    uid: `enemy-${index}`, defId: 'small_slime', row: 0, isBoss: false, hp: 50, maxHp: 50,
    block: 0, strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0,
    abilityUsed: true, dead: false, goldReward: 0, cardReward: null,
  })), `single-target-${sequence++}`)
  Object.assign(run.combat, { phase: 'player', die, pendingTriggers: [], startTurnProgress: undefined })
  Object.assign(run.combat.players[0], {
    energy: 9, block: 0, strength: 0, weak: 0, soulburn, heat: 4, shivs: 0,
    hand, draw: [], discard: [], exhaust: [], potions, relics, powers: power ? [card(power, 'power')] : [],
    chamber: character === 'hermit' ? [card('hermit_strike', 'loaded')] : [],
    orbs: orbs ?? [null, null, null],
  })
  return run
}

try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    page.setDefaultTimeout(10_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const set = async run => {
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
      await page.waitForFunction(id => window.__STS_DEBUG__.getState()?.combatId === id, run.combat.combatId)
    }
    const read = () => page.evaluate(() => structuredClone(window.__STS_DEBUG__.getState()))
    const noTargetPrompt = async () => assert.equal(await page.locator('.combat__target-instruction').count(), 0)
    const targetedPotions = Object.values(POTIONS).filter(potion => potion.target)
    for (const [potion, die] of [
      ...targetedPotions.map(potion => [potion, 1]),
      ...[1, 2, 6].map(die => [POTIONS.mystery_potion, die]),
    ]) {
      const run = fixture({ potions: [potion.id], die })
      const context = potion.target === 'row' ? { enemyRow: 0 }
        : potion.target === 'enemy' || potion.id === 'mystery_potion' && die <= 2 ? { enemyUid: 'enemy-0' } : {}
      const expected = activatePotion(run.combat, 'p1', potion.id, context)
      assert.notEqual(expected, run.combat, `${potion.id}: fixture must be usable`)
      await set(run)
      const button = page.getByRole('button', { name: `Use ${potion.name}`, exact: true })
      if (phone && potion.id === 'vulnerable_potion') {
        await button.tap()
        assert.deepEqual((await read()).players[0].potions, [potion.id], 'the first touch still reads the potion')
        await button.tap()
      } else await button.press('Enter')
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].potions.length === 0)
      await noTargetPrompt()
      assert.deepEqual((await read()).enemies, expected.enemies, `${potion.id}: automatic targeting changed its effect`)
    }
    for (const enemies of [2, 1]) {
      const run = fixture({ enemies: 2, potions: ['vulnerable_potion'] })
      if (enemies === 1) Object.assign(run.combat.enemies[0], { hp: 0, dead: true })
      await set(run)
      await page.getByRole('button', { name: 'Use Vulnerable Potion', exact: true }).press('Enter')
      if (enemies === 2) {
        await page.locator('.combat__target-instruction').waitFor()
        assert.equal((await read()).players[0].potions.length, 1)
        await page.locator('[data-enemy-id="enemy-1"] .enemy__hit-area').click()
      }
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].potions.length === 0)
      assert.equal((await read()).enemies[1].vulnerable, 1)
      assert.equal((await read()).enemies[0].vulnerable, 0)
    }
    for (const power of ['battle_hymn', 'combust', 'slayer_infernal_blade', 'hermit_snipe']) {
      const run = fixture({ power, character: power === 'hermit_snipe' ? 'hermit' : 'ironclad',
        hand: power === 'slayer_infernal_blade' ? [card('daze')] : [] })
      const expected = activatePower(run.combat, 'p1', 'power',
        cardDef(power).target === 'row' ? { enemyRow: 0 } : { enemyUid: 'enemy-0' })
      assert.notEqual(expected, run.combat, `${power}: fixture must be usable`)
      await set(run)
      await page.getByRole('button', { name: `Use ${cardDef(power).name}`, exact: true }).press('Enter')
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().powerTriggersUsedThisTurn.length > 0)
      await noTargetPrompt()
      assert.deepEqual((await read()).enemies, expected.enemies)
    }
    for (const boosted of [false, true]) {
      const run = fixture({ character: 'hexaghost', soulburn: 2, power: boosted ? 'extra_crispy' : undefined })
      const expected = spendSoulburn(run.combat, 'p1', 'enemy-0', boosted ? 'power' : undefined)
      await set(run)
      await page.getByRole('button', { name: 'Spend Soulburn, 2 available', exact: true }).press('Enter')
      await noTargetPrompt()
      if (boosted) {
        assert.equal((await read()).players[0].soulburn, 2, 'Extra Crispy remains an optional decision')
        assert(await page.getByRole('button', { name: 'Spend without Extra Crispy', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Use Extra Crispy with Soulburn', exact: true }).click()
      }
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].soulburn === 1)
      assert.deepEqual((await read()).enemies, expected.enemies)
    }
    for (const power of ['guardian_floating_orbs', 'guardian_gem_finder']) {
      const run = fixture({ character: 'guardian', power })
      run.combat.players[0].powers[0].attachedGemId = 'guardian_ruby'
      run.combat.players[0].draw = [card('defend_ironclad')]
      await set(run)
      await page.getByRole('button', { name: `Use ${cardDef(power).name} with Ruby`, exact: true }).press('Enter')
      if (power === 'guardian_gem_finder') {
        const scry = page.getByRole('dialog', { name: 'Gem Finder — Scry 3', exact: true })
        await scry.locator('.card[data-card-name="Defend"]').click()
        await scry.getByRole('button', { name: 'Discard 1 and continue', exact: true }).click()
      }
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().powerTriggersUsedThisTurn.length > 0)
      assert.equal((await read()).enemies[0].hp, 49)
      await noTargetPrompt()
    }
    for (const defId of ['strike_ironclad', 'bouncing_flask', 'dual_cast']) {
      await set(fixture({ hand: [card(defId)], orbs: ['lightning', null, null] }))
      await page.locator(`.hand .card[data-card-name="${cardDef(defId).name}"]`).press('Enter')
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
      await noTargetPrompt()
    }
    await set(fixture({ enemies: 2, hand: [card('strike_ironclad')] }))
    await page.locator('.hand .card[data-card-name="Strike"]').press('Enter')
    await page.locator('.combat__target-instruction').waitFor()
    assert.equal((await read()).players[0].cardsPlayedThisTurn, 0)
    await page.locator('[data-enemy-id="enemy-1"] .enemy__hit-area').click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)

    const ashes = fixture({ relics: [{ defId: 'charons_ashes', spent: false }],
      hand: [card('defend_ironclad'), card('strike_ironclad')] })
    Object.assign(ashes.combat, { phase: 'start', turn: 2, startTurnStage: 'effects' })
    await set(ashes)
    await page.getByRole('button', { name: /^Use Charon's Ashes:/ }).press('Enter')
    await page.locator('.hand-discard__hand .card[data-card-name="Defend"]').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('button', { name: /^Hit Small Slime/ }).count(), 0)
    await page.getByRole('dialog').getByRole('button', { name: 'Activate', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].relics[0].spent)
    assert.equal((await read()).enemies[0].hp, 48)

    const ninja = fixture({ relics: [{ defId: 'ninja_scroll', spent: false }] })
    ninja.combat.players[0].shivs = 4
    await set(ninja)
    await page.getByRole('button', { name: /^Use Ninja Scroll:/ }).press('Enter')
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].relics[0].spent)
    assert.equal((await read()).enemies[0].hp, 49)
    assert.equal((await read()).players[0].shivs, 5)

    await set(fixture({ potions: ['destiny_draught'], relics: [{ defId: 'red_mask', spent: false }] }))
    await page.getByRole('button', { name: 'Use Destiny Draught', exact: true }).press('Enter')
    const dieAbility = page.locator('.die-relic--single').filter({ hasText: 'Red Mask' })
    await dieAbility.waitFor()
    assert.equal(await page.locator('.die-relic__targets').count(), 0)
    await dieAbility.click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].potions.length === 0)
    assert.equal((await read()).enemies[0].weak, 1)

    const minionMaster = fixture({ character: 'slime_boss', power: 'slime_boss_minion_master' })
    minionMaster.combat.players[0].slimes = [bruiserSlime('first'), bruiserSlime('second')]
    minionMaster.combat.pendingTriggers = [{ id: 1, playerId: 'p1', sourceId: 'power:power' }]
    await set(minionMaster)
    await page.locator('.prompt').getByRole('button', { name: 'Bruiser Slime', exact: true }).first().click()
    assert.equal((await read()).enemies[0].hp, 50, 'choosing a Slime still needs confirmation')
    await page.getByRole('button', { name: 'Confirm 1 Slime', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().pendingTriggers.length === 0)
    assert((await read()).enemies[0].hp < 50)
    assert.equal((await read()).players[0].slimes[1].commandsThisTurn, 0)
    await noTargetPrompt()

    const combo = fixture({ character: 'hermit', power: 'hermit_combo' })
    Object.assign(combo.combat.players[0], { chamber: [], chamberSlots: 2,
      draw: [card('hermit_grudge'), card('hermit_defend')] })
    combo.combat.pendingTriggers = [{ id: 2, playerId: 'p1', sourceId: 'power:power' }]
    await set(combo)
    const load = page.getByRole('dialog', { name: "Target test's Combo", exact: true })
    await load.locator('.card[data-card-name="Grudge"]').click()
    await load.getByRole('button', { name: 'Load Grudge', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().pendingTriggers.length === 0)
    assert.equal((await read()).enemies[0].hp, 48)
    await noTargetPrompt()

    const room = createRoom(rooms.store)
    const seat = joinRoom(room, { name: 'Target test', character: 'ironclad' })
    room.phase = 'run'
    room.run = fixture({ potions: ['vulnerable_potion'] })
    room.run.players[0].id = seat.playerId
    room.run.combat.players[0].id = seat.playerId
    room.version++
    await page.evaluate(session => sessionStorage.setItem('sts-room-session', JSON.stringify(session)),
      { code: room.code, token: seat.token })
    await page.reload()
    const [potionResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/action') &&
        response.request().postDataJSON()?.action?.kind === 'usePotion'),
      page.getByRole('button', { name: 'Use Vulnerable Potion', exact: true }).press('Enter'),
    ])
    assert.equal(potionResponse.status(), 200, await potionResponse.text())
    await page.waitForFunction(() => !document.querySelector('[aria-label="Use Vulnerable Potion"]'))
    assert.equal(room.run.combat.enemies[0].vulnerable, 1)
    assert.equal(room.run.combat.players[0].potions.length, 0)
    await noTargetPrompt()

    const copied = fixture({ hand: [card('cut_through_fate')] })
    copied.players[0].id = seat.playerId
    Object.assign(copied.combat.players[0], { id: seat.playerId, doubledAttacksThisTurn: 1,
      draw: [card('defend_ironclad'), card('strike_ironclad'), card('bash'), card('inflame')] })
    copied.combat = playCard(copied.combat, seat.playerId, 'cut_through_fate',
      { enemyUid: 'enemy-0', playerId: null, scryDiscardUids: [] })
    assert.equal(copied.combat.phase, 'copy')
    let previews = 0
    await page.route('**/api/rooms/*/action', async route => {
      const body = route.request().postDataJSON()
      if (body.action?.kind === 'previewCardCopy') {
        previews++
        if (previews === 1) body.action.copyId = -1
      }
      await route.continue({ postData: JSON.stringify(body) })
    })
    const refused = page.waitForResponse(response => response.request().method() === 'POST' &&
      response.request().postDataJSON()?.action?.kind === 'previewCardCopy')
    room.run = copied
    room.version++
    rooms.publishRoom(room.code)
    await refused
    await page.waitForTimeout(300)
    assert.equal(previews, 1, 'a refused automatic copy preview must not retry itself')
    await page.locator('[data-enemy-id="enemy-0"] .enemy__hit-area').click()
    const playedCopy = page.waitForResponse(response => response.request().method() === 'POST' &&
      response.request().postDataJSON()?.action?.kind === 'playCardCopy')
    await page.getByRole('button', { name: 'Keep all', exact: true }).click()
    await playedCopy
    assert.equal(room.run.combat.pendingCardCopy, undefined)
    assert.equal(previews, 2, 'the player can explicitly retry a refused preview')
    assert.equal(room.run.combat.enemies[0].hp, 48)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: targeted potions, Powers, Soulburn, cards, Orbs and authoritative online targeting`)
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
