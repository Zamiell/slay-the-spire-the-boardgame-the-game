import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { createRoom, joinRoom, snapshotFor } from './lib/rooms.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { createRun, enterRoom } from '../src/game/run.ts'
import { createCombat, beginEndTurnResolution } from '../src/game/combat.ts'

const output = 'artifacts/card-choices'
mkdirSync(output, { recursive: true })
const rooms = createRoomServer()
const address = await rooms.listen(0)
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: `http://127.0.0.1:${address.port}` },
    '/ws': { target: `ws://127.0.0.1:${address.port}`, ws: true } },
} })
await server.listen()
const browser = await chromium.launch()
const card = (uid, defId, extra = {}) => ({ uid, defId, upgraded: false, ...extra })
try {
  for (const [screen, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['horizontal-phone', { width: 844, height: 390 }],
  ]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
      await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const run = postNeowRun(47, [{ id: 'p1', name: 'Silent', character: 'silent' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const baseline = enterRoom(run, room)
    for (const [source, upgraded, picks, bonus] of [
      ['well_laid_plans', false, 1, false],
      ['well_laid_plans', true, 2, false],
      ['equilibrium', true, 2, false],
      ['well_laid_plans', false, 0, false],
      ['well_laid_plans', false, 1, true],
    ]) {
      const fixture = structuredClone(baseline)
      const player = fixture.combat.players[0]
      Object.assign(player, {
        hand: [card('strike', 'strike_silent'), card('defend', 'defend_silent'), card('neutralize', 'neutralize'),
          card('automatic', 'regret'), card('protected', 'defend_silent', { endTurnProtected: true }),
          card('already', 'defend_silent', { retainThisTurn: true }),
          ...(bonus ? [card('bonus', 'eruption', { mayRetainThisTurn: true })] : [])],
        draw: Array.from({ length: 10 }, (_, i) => card(`draw-${i}`, 'strike_silent')),
        discard: source === 'equilibrium' ? [card('source', source, { upgraded })] : [],
        powers: source === 'well_laid_plans' ? [card('source', source, { upgraded })] : [],
        retainCardsThisTurn: source === 'equilibrium' ? 2 : 0,
        relics: [], exhaust: [], energy: 3,
      })
      await page.evaluate(fixture => window.__STS_DEBUG__.setRun(fixture), fixture)
      await page.getByRole('button', { name: /^End Turn \d+/ }).click()
      const dialog = page.locator('dialog.hand-discard[data-action="retain"]')
      await dialog.waitFor()
      assert.equal(await dialog.locator('.hand-discard__hand .card').count(), bonus ? 4 : 3)
      assert.equal(await dialog.locator('.hand-discard__source .card').getAttribute('data-card-name'),
        source === 'equilibrium' ? 'Equilibrium+' : `Well-Laid Plans${upgraded ? '+' : ''}`)
      const pick = async name => {
        await dialog.locator(`.hand-discard__hand .card[data-card-name="${name}"]`).focus()
        await page.keyboard.press('Enter')
      }
      if (picks) await pick('Strike')
      if (picks === 2) await pick('Defend')
      if (bonus) {
        assert(await dialog.locator('.hand-discard__hand .card[data-card-name="Defend"]').isDisabled())
        await pick('Eruption')
      }
      const confirm = dialog.getByRole('button', { name: 'Confirm retain', exact: true })
      assert(await confirm.isEnabled(), 'zero Retain must remain a valid choice')
      if (source === 'well_laid_plans' && picks === 1 && !bonus)
        await page.screenshot({ path: `${output}/${screen}-retain.png` })
      await dialog.getByRole('button', { name: 'View battlefield' }).click()
      await page.keyboard.press('Escape')
      assert.equal(await dialog.locator('.hand-discard__selection .card').count(), picks + Number(bonus))
      await confirm.click()
      await page.waitForFunction(turn => window.__STS_DEBUG__.getRun().combat.turn > turn, fixture.combat.turn)
      const retained = await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].hand
        .filter(card => !card.uid.startsWith('draw-')).map(card => card.uid))
      assert.deepEqual(retained.sort(), ['automatic', 'protected', 'already',
        ...(picks ? ['strike'] : []), ...(picks === 2 ? ['defend'] : []), ...(bonus ? ['bonus'] : [])].sort())
    }
    const party = createRun(47, [
      { id: 'p1', name: 'Silent', character: 'silent' }, { id: 'p2', name: 'Defect', character: 'defect' },
    ])
    party.phase = 'combat'
    party.neow = null
    party.combat = createCombat({ seed: 47, calls: 0 }, party.players, baseline.combat.enemies, `hotseat-${screen}`)
    party.combat.players.forEach((player, index) => Object.assign(player, {
      hand: index ? [card('ally-zap', 'zap'), card('ally-strike', 'strike_defect')]
        : [card('host-defend', 'defend_silent'), card('host-strike', 'strike_silent')],
      powers: [], relics: [], discard: [], retainCardsThisTurn: 1,
      draw: Array.from({ length: 10 }, (_, i) => card(`party-draw-${index}-${i}`, 'strike_ironclad')),
    }))
    party.combat = beginEndTurnResolution(party.combat)
    await page.evaluate(party => window.__STS_DEBUG__.setRun(party), party)
    const hotseat = page.locator('dialog.hand-discard[data-action="retain"]')
    await hotseat.locator('.hand-discard__hand .card[data-card-name="Defend"]').focus()
    await page.keyboard.press('Enter')
    await hotseat.getByRole('button', { name: 'Confirm retain', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'general', exact: true }).click()
    await settings.getByLabel('Seat').selectOption('p2')
    assert.equal(await hotseat.isVisible(), false, 'a newly selected seat must not cover the open settings dialog')
    await settings.getByRole('button', { name: /Back/ }).click()
    await hotseat.locator('.hand-discard__hand .card[data-card-name="Zap"]').focus()
    await page.keyboard.press('Enter')
    await hotseat.getByRole('button', { name: 'Confirm retain', exact: true }).click()
    await page.waitForFunction(turn => window.__STS_DEBUG__.getState().turn > turn, party.combat.turn)
    const kept = await page.evaluate(() => window.__STS_DEBUG__.getState().players.map(player =>
      player.hand.filter(card => !card.uid.startsWith('party-draw-')).map(card => card.uid)))
    assert.deepEqual(kept, [['host-defend'], ['ally-zap']])

    const table = createRoom(rooms.store)
    const seats = ['silent', 'ironclad'].map(character => joinRoom(table, { name: character, character }))
    table.phase = 'run'
    table.run = createRun(47, seats.map(seat => ({ id: seat.playerId, name: seat.name, character: seat.character })))
    table.run.phase = 'combat'
    table.run.neow = null
    table.run.combat = createCombat({ seed: 47, calls: 0 }, table.run.players, baseline.combat.enemies, `retain-${screen}`)
    table.run.combat.players.forEach((player, index) => Object.assign(player, {
      hand: index ? [card('ally-bash', 'bash'), card('ally-daze', 'daze')]
        : [card('own-strike', 'strike_silent'), card('own-defend', 'defend_silent'), card('own-neutralize', 'neutralize')],
      powers: [], relics: [], discard: [], retainCardsThisTurn: 1,
      draw: [card(`top-reader-${index}`, 'claw'),
        ...Array.from({ length: 10 }, (_, i) => card(`online-draw-${index}-${i}`, 'strike_ironclad'))],
    }))
    table.run.combat = beginEndTurnResolution(table.run.combat)
    assert.equal(table.run.combat.phase, 'discard')
    table.version++
    await page.evaluate(session => sessionStorage.setItem('sts-room-session', JSON.stringify(session)),
      { code: table.code, token: seats[0].token })
    await page.reload()
    const dialog = page.locator('dialog.hand-discard[data-action="retain"]')
    await dialog.locator('.hand-discard__hand .card[data-card-name="Defend"]').focus()
    await page.keyboard.press('Enter')
    await dialog.getByRole('button', { name: 'Confirm retain', exact: true }).click()
    const topDialog = page.getByRole('dialog', { name: 'Choose top discard', exact: true })
    await topDialog.locator('.hand-discard__selection .card[data-card-name="Neutralize"]').waitFor()
    const submit = async name => {
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/action') &&
          response.request().postDataJSON()?.action?.kind === 'discardHand'),
        page.getByRole('button', { name }).click(),
      ])
    }
    await submit('Confirm discard order')
    await page.getByRole('button', { name: /^Update end-turn effect/ }).waitFor()
    assert.equal(snapshotFor(table, seats[0].token).discardOrder.at(-1), 'own-neutralize')
    assert(!snapshotFor(table, seats[0].token).discardOrder.includes('own-defend'))
    await page.reload()
    await page.getByRole('button', { name: /^Update end-turn effect/ }).waitFor()
    assert.equal(await dialog.count(), 0, 'a submitted seat must not be trapped in the selector after reconnect')
    await page.getByRole('button', { name: 'Choose retained cards', exact: true }).click()
    assert.equal(await dialog.locator('.hand-discard__selection .card[data-card-name="Defend"]').count(), 1)
    await dialog.locator('.hand-discard__selection .card').click()
    await dialog.locator('.hand-discard__hand .card[data-card-name="Strike"]').focus()
    await page.keyboard.press('Enter')
    await dialog.getByRole('button', { name: 'Confirm retain', exact: true }).click()
    await submit('Confirm discard order')
    assert(snapshotFor(table, seats[0].token).discardOrder.includes('own-defend'))
    assert(!snapshotFor(table, seats[0].token).discardOrder.includes('own-strike'))
    assert.equal(table.run.combat.phase, 'discard', "one seat cannot submit another seat's choices")
    assert.deepEqual(errors, [])
    console.log(`PASS ${screen}: Retain rules, supported layout, online ordering, readiness, updates and reconnect`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
