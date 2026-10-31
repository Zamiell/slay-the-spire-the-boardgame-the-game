import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { pickUpCard, confirmCardPlay, dragCardTo } from './lib/card-interactions.mjs'

const output = 'artifacts/sever-soul'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
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
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const base = enterRoom(run, room)
    base.campaign.runId = `sever-soul-${screen}`
    Object.assign(base.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined })
    const card = (defId, uid, upgraded = false) => ({ defId, uid, upgraded })
    const sever = card('sever_soul', 'sever')
    const upgraded = card('sever_soul', 'sever-plus', true)
    const fuel = [card('defend_ironclad', 'defend'), card('daze', 'daze'), card('strike_ironclad', 'strike')]
    const deck = [sever, upgraded, ...fuel]
    Object.assign(base.combat.players[0], {
      hand: [], draw: [], discard: [], exhaust: [], relics: [], potions: [],
      powers: [card('feel_no_pain', 'feel-no-pain')], energy: 2, strength: 0, weak: 0, block: 0, deck,
    })
    base.players[0].deck = structuredClone(deck)
    base.combat.enemies = [{ ...base.combat.enemies[0], uid: 'target', defId: 'small_slime',
      hp: 30, maxHp: 30, block: 0, vulnerable: 0, dead: false }]
    let fixtureNumber = 0
    const setHand = async (hand, draw = [], energy = 2) => {
      const fixture = structuredClone(base)
      fixture.combat.combatId = `sever-${screen}-${fixtureNumber++}`
      fixture.combat.players[0].hand = hand
      fixture.combat.players[0].draw = draw
      fixture.combat.players[0].energy = energy
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
      await page.waitForFunction(id => window.__STS_DEBUG__.getState()?.combatId === id, fixture.combat.combatId)
      await page.locator('.hand .card').first().waitFor()
    }
    const activate = locator => phone ? locator.tap() : locator.click()
    const play = async (name) => {
      const target = page.locator('[data-enemy-id="target"] .enemy__hit-area')
      await pickUpCard(page, name)
      if (name.startsWith('Sever Soul')) await targetInstruction.waitFor()
      await confirmCardPlay(page, target)
    }
    const dialog = page.getByRole('dialog', { name: /Choose .* in your hand to Exhaust/ })
    const targetInstruction = page.locator('.combat__target-instruction')
    const read = () => page.evaluate(() => structuredClone(window.__STS_DEBUG__.getState()))
    const confirm = () => dialog.getByRole('button', { name: /^Exhaust / })
    const dragForcedCard = async name => {
      const source = page.locator(`.hand .card[data-card-name="${name}"]`)
      const target = page.locator('[data-enemy-id="target"] .enemy__hit-area')
      await source.focus()
      await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
      if (!phone) return dragCardTo(page, source, target)
      const touch = await page.context().newCDPSession(page)
      try {
        const from = await source.boundingBox()
        const to = await target.boundingBox()
        assert(from && to)
        const start = { x: from.x + from.width / 2, y: from.y + from.height / 4 }
        const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] })
        for (const progress of [.25, .5, 1]) {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
            x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress, id: 1,
          }] })
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } finally {
        await touch.detach()
      }
    }

    const originalEnemy = base.combat.enemies[0]
    base.combat.enemies[0] = { ...originalEnemy, defId: 'book_of_stabbing', hp: 35, maxHp: 35 }
    const crowdedHand = [
      ...Array.from({ length: 4 }, (_, index) => card('defend_ironclad', `crowded-defend-${index}`)),
      ...Array.from({ length: 2 }, (_, index) => card('strike_ironclad', `crowded-strike-${index}`)),
      card('power_through', 'power-through'), card('sentinel', 'sentinel', true),
      card('inflame', 'inflame'), card('body_slam', 'body-slam', true),
    ]
    await setHand([card('havoc', 'havoc-crowded', true), ...crowdedHand], [sever], 6)
    await page.locator('.hand .card[data-card-name="Havoc+"]').focus()
    await page.keyboard.press('Enter')
    await dialog.waitFor()
    await activate(dialog.locator('.card[data-card-name="Strike"]').first())
    await activate(confirm())
    await dialog.waitFor({ state: 'detached' })
    await dragForcedCard('Sever Soul')
    await page.waitForFunction(() => !window.__STS_DEBUG__.getState().startTurnProgress?.forcedCard)
    assert.equal((await read()).enemies[0].hp, 32)
    assert.equal((await read()).players[0].energy, 6)
    assert.deepEqual((await read()).players[0].exhaust.map(card => card.uid).sort(), ['crowded-strike-0', 'sever'])
    base.combat.enemies[0] = originalEnemy

    for (const [drawn, count, damage] of [[sever, 1, 3], [upgraded, 2, 4]]) {
      await setHand([card('havoc', 'havoc'), ...fuel], [drawn], 1)
      await play('Havoc')
      await dialog.waitFor()
      assert.equal(await targetInstruction.count(), 0, 'choose the Exhaust card before asking for an enemy')
      assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).count(), 0,
        'Havoc has committed the forced play: cancelling must not abandon its required Exhaust choice')
      await dialog.focus()
      await page.keyboard.press('Escape')
      assert(await dialog.isVisible(), 'Escape must not dismiss Havoc’s mandatory Exhaust choice')
      await activate(dialog.locator('.card[data-card-name="Defend"]'))
      if (count === 2) await activate(dialog.locator('.card[data-card-name="Daze"]'))
      await page.screenshot({ path: `${output}/${screen}-havoc-${count}-choice.png` })
      await activate(confirm())
      await dialog.waitFor({ state: 'detached' })
      await targetInstruction.waitFor()
      assert.equal(await targetInstruction.innerText(), 'Select an enemy')
      assert(await targetInstruction.evaluate(label => {
        const box = label.getBoundingClientRect()
        const bar = label.closest('.combat__bar').getBoundingClientRect()
        return box.width > 100 && box.height > 15 && box.left >= 0 && box.right <= innerWidth &&
          box.top >= bar.top && box.bottom <= bar.bottom && box.bottom < innerHeight / 3 &&
          getComputedStyle(label).clipPath === 'none'
      }), `${screen}: the enemy instruction must be readable near the top of the screen`)
      await page.screenshot({ path: `${output}/${screen}-select-enemy-${count}.png` })
      if (count === 1) await dragForcedCard('Sever Soul')
      else await activate(page.locator('[data-enemy-id="target"] .enemy__hit-area'))
      await page.waitForFunction(() => !window.__STS_DEBUG__.getState().startTurnProgress?.forcedCard)
      await targetInstruction.waitFor({ state: 'detached' })
      const havocPlayed = await read()
      assert.equal(havocPlayed.enemies[0].hp, 30 - damage)
      assert.equal(havocPlayed.players[0].energy, 0, 'Havoc must not charge Sever Soul’s printed cost')
      assert.deepEqual(havocPlayed.players[0].exhaust.map(card => card.uid).sort(),
        [...['defend', 'daze'].slice(0, count), drawn.uid].sort())
      assert(havocPlayed.players[0].discard.some(card => card.uid === 'havoc'))
    }
    await setHand([card('havoc', 'havoc-empty')], [sever], 1)
    await play('Havoc')
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getState()
      return !state.startTurnProgress?.forcedCard && state.players[0].exhaust.some(card => card.uid === 'sever')
    })
    assert.equal(await dialog.count(), 0, 'forced Sever Soul with no Exhaust choices must finish automatically')

    await setHand([sever, ...fuel])
    const before = await read()
    await play('Sever Soul')
    await dialog.waitFor()
    assert.equal(await dialog.locator('.card').count(), 3, 'only other hand cards may be exhausted')
    assert.equal(await dialog.locator('.card[data-card-name="Sever Soul"]').count(), 0)
    assert(await confirm().isDisabled())
    await activate(dialog.locator('.card[data-card-name="Defend"]'))
    await activate(dialog.locator('.card[data-card-name="Daze"]'))
    assert.equal(await dialog.locator('.card--selected').count(), 1, 'base card allows one choice')
    await activate(dialog.locator('.card[data-card-name="Daze"]'))
    assert(await confirm().isDisabled(), 'deselecting the only choice must disable confirmation')
    assert.deepEqual(await read(), before, 'inspection must not spend Energy, deal damage or exhaust cards')
    if (phone) await activate(dialog.getByRole('button', { name: 'Cancel', exact: true }))
    else await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await read(), before, 'cancelling must leave the play uncommitted')
    await play('Sever Soul')
    await dialog.waitFor()
    await activate(dialog.getByRole('button', { name: 'Cancel', exact: true }))
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await read(), before, 'Cancel must leave the entire combat unchanged')
    await play('Sever Soul')
    await dialog.waitFor()
    await activate(dialog.locator('.card[data-card-name="Daze"]'))
    assert(await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const controls = [...element.querySelectorAll('.hand-exhaust__actions button')]
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
        controls.every(control => {
          const box = control.getBoundingClientRect()
          return box.top >= rect.top && box.bottom <= rect.bottom
        }) && element.matches(':modal') && element.contains(document.activeElement)
    }), `${screen}: modal, focus and confirmation controls must fit the screen`)
    await page.screenshot({ path: `${output}/${screen}-base.png` })
    await activate(confirm())
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
    const basePlayed = await read()
    assert.deepEqual(basePlayed.players[0].exhaust.map(card => card.uid), ['daze'])
    assert.equal(basePlayed.enemies[0].hp, 27)
    assert.equal(basePlayed.players[0].block, 1, 'Feel No Pain must still observe the Exhaust')

    for (const count of [1, 2]) {
      await setHand([upgraded, ...fuel])
      await play('Sever Soul+')
      await dialog.waitFor()
      assert.match(await dialog.locator('h2').innerText(), /1 or 2 cards/)
      assert(await confirm().isDisabled(), 'the upgrade cannot skip an available Exhaust')
      await activate(dialog.locator('.card[data-card-name="Defend"]'))
      if (count === 2) await activate(dialog.locator('.card[data-card-name="Daze"]'))
      await page.screenshot({ path: `${output}/${screen}-upgrade-${count}.png` })
      await activate(confirm())
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
      const played = await read()
      assert.deepEqual(played.players[0].exhaust.map(card => card.uid), ['defend', 'daze'].slice(0, count))
      assert.equal(played.enemies[0].hp, 26)
      assert.equal(played.players[0].hand.length, 3 - count)
    }

    await setHand([upgraded, ...fuel])
    await play('Sever Soul+')
    await dialog.waitFor()
    await activate(dialog.locator('.card[data-card-name="Defend"]'))
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].hand = run.combat.players[0].hand.filter(card => card.uid !== 'defend')
      window.__STS_DEBUG__.setRun(run)
    })
    await dialog.locator('.card[data-card-name="Defend"]').waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelector('.hand-exhaust__actions button')?.disabled)
    await activate(dialog.locator('.card[data-card-name="Daze"]'))
    await activate(confirm())
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
    assert.deepEqual((await read()).players[0].exhaust.map(card => card.uid), ['daze'],
      'live hand updates must discard stale selections')

    await setHand([sever])
    await play('Sever Soul')
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
    assert.equal(await dialog.count(), 0, 'an empty eligible hand must not strand the play')
    assert.equal((await read()).enemies[0].hp, 27)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: Sever Soul picker, cancellation, upgrade range, live hand and empty hand`)
  }
} finally {
  await browser.close()
  await server.close()
}
