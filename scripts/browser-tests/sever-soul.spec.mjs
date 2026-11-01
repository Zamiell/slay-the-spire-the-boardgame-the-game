import { test as browserTest, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'
import { CARDS, faceOf } from '../../src/game/cards.ts'
import { pickUpCard, confirmCardPlay, dragCardTo } from '../lib/card-interactions.mjs'

const test = browserTest.extend({
  soul: async ({ page, screen, phone, appURL, artifacts }, use) => {
    await use(await setupSeverSoul({ page, screen, phone, appURL, artifacts }))
  },
})

test.use({ appKey: import.meta.url, reducedMotion: 'reduce' })

async function setupSeverSoul({ page, screen, phone, appURL, artifacts: output }) {
  page.setDefaultTimeout(10_000)
  await startStandardCampaign(page, appURL)
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
  const activate = async locator => {
    if (await locator.evaluate(element => Boolean(element.closest('.hand-discard__hand')))) {
      await locator.focus()
      await page.waitForFunction(() => !document.querySelector('.hand-discard__hand[data-hand-moving]'))
    }
    return phone ? locator.tap() : locator.click()
  }
  const play = async (name) => {
    const target = page.locator('[data-enemy-id="target"] .enemy__hit-area')
    await pickUpCard(page, name)
    if (name.startsWith('Sever Soul')) assert.equal(await targetInstruction.count(), 0,
      'a sole enemy is selected automatically while lifting the attack')
    await confirmCardPlay(page, target)
  }
  const dialog = page.getByRole('dialog', { name: /^Exhaust (?:\d|up to)/ })
  const targetInstruction = page.locator('.combat__target-instruction')
  const read = () => page.evaluate(() => structuredClone(window.__STS_DEBUG__.getState()))
  const confirm = () => dialog.getByRole('button', { name: 'Confirm exhaust', exact: true, includeHidden: true })
  const choiceCards = () => dialog.locator('.hand-discard__selection > .card, .hand-discard__hand > .card')
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
  return { output, base, card, sever, upgraded, fuel, setHand, activate, play, dialog, targetInstruction,
    read, confirm, choiceCards, dragForcedCard }
}

const exhaustFaces = Object.values(CARDS).flatMap(def => [false, true].flatMap(upgraded => {
  const face = faceOf(def, upgraded)
  const effect = face.effects.find(effect => effect.kind === 'exhaustFromHand' || effect.kind === 'exhaustAny')
  return effect && (face.type !== 'power' || face.resolvesOnPlay)
    ? [{ defId: def.id, upgraded, face, effect }] : []
}))

for (const { defId, upgraded, face, effect } of exhaustFaces) {
  test(`Exhaust choices: ${defId}${upgraded ? '+' : ''}`, async ({ page, screen, soul }) => {
    const { card, fuel, setHand, read, play, dialog, choiceCards, confirm, activate, output } = soul
    const source = card(defId, 'audit-source', upgraded)
    const minimum = effect.kind === 'exhaustAny' ? effect.minimum ?? 0 : effect.amount
    for (const count of minimum === 0 ? [0, Math.min(effect.amount, fuel.length)] : [minimum]) {
      await setHand([source, ...fuel], [card('strike_ironclad', 'audit-draw')], 9)
      const before = await read()
      await play(face.name)
      await dialog.waitFor()
      const available = dialog.getByRole('group', { name: 'Cards available to exhaust', exact: true })
      const selected = dialog.getByRole('group', { name: 'Selected exhaust', exact: true })
      assert.equal(await selected.locator('.card').count(), 0)
      assert.equal(await available.locator('.card').count(), fuel.length)
      assert.equal(await page.locator('.hand-scroll').evaluate(hand => getComputedStyle(hand).opacity), '0')
      if (minimum === 1 && effect.amount === 1) assert.equal(await dialog.locator('h2').innerText(), 'Choose a card to Exhaust.')
      assert.equal(await choiceCards().count(), fuel.length, `${face.name}: wrong Exhaust pool`)
      assert.equal(await confirm().isDisabled(), minimum > 0, `${face.name}: incorrect minimum`)
      assert.equal(await available.locator(`.card[data-card-name="${face.name}"]`).count(), 0)
      for (let index = 0; index < count; index++) await activate(choiceCards().nth(index))
      assert.equal(await selected.locator('.card').count(), count, `${face.name}: selection must move to the upper area`)
      assert.equal(await available.locator('.card').count(), fuel.length - count)
      assert.deepEqual(await read(), before, `${face.name}: selection must not commit the play`)
      if (defId === 'rampage') await page.screenshot({ path: `${output}/${screen}-rampage-upgrade.png` })
      await activate(confirm())
      await dialog.waitFor({ state: 'detached' })
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
      const exhausted = (await read()).players[0].exhaust.map(card => card.uid)
      assert.deepEqual(exhausted.filter(uid => uid !== source.uid).sort(),
        fuel.slice(0, count).map(card => card.uid).sort(), `${face.name}: wrong cards exhausted`)
    }
  })
}

for (const defId of ['all_out_attack', 'concentrate', 'storm_of_steel', 'slayer_forethought']) {
  test(`Related card choices: ${defId}`, async ({ page, soul }) => {
    const { card, fuel, setHand, read, play, activate } = soul
    for (const upgraded of [false, true]) {
      const face = faceOf(CARDS[defId], upgraded)
      const effect = face.effects.find(effect =>
        ['discard', 'discardAny', 'bottomdeck'].includes(effect.kind))
      const bottom = effect.kind === 'bottomdeck'
      const optional = effect.kind === 'discardAny' || effect.amount === 'any'
      for (const count of optional ? [0, 2] : [1]) {
        await setHand([card(defId, 'related-source', upgraded), ...fuel],
          [card('strike_ironclad', 'related-draw')], 9)
        const before = await read()
        await play(face.name)
        const choice = page.locator(`dialog.hand-discard[data-action="${bottom ? 'put on bottom' : 'discard'}"]`)
        await choice.waitFor()
        for (let index = 0; index < count; index++)
          await activate(choice.locator(`.hand-discard__hand .card[data-card-name="${CARDS[fuel[index].defId].name}"]`))
        assert.deepEqual(await read(), before, `${face.name}: choosing cards must not play them`)
        await activate(choice.getByRole('button', { name: bottom ? 'Confirm put on bottom' : 'Confirm discard', exact: true }))
        await choice.waitFor({ state: 'detached' })
        await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
        assert.deepEqual((await read()).players[0][bottom ? 'draw' : 'discard']
          .filter(card => fuel.some(held => held.uid === card.uid)).map(card => card.uid),
        fuel.slice(0, count).map(card => card.uid), `${face.name}: wrong selection resolved`)
      }
    }
  })
}

test('Automatic Exhaust effects do not open a picker', async ({ page, soul }) => {
  const { card, fuel, setHand, play, dialog } = soul
  for (const defId of ['rampage', 'second_wind', 'fiend_fire', 'blasphemy', 'virus']) {
    await setHand([card(defId, 'automatic'), ...fuel], [card('strike_ironclad', 'automatic-draw')], 9)
    await play(CARDS[defId].name)
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
    assert.equal(await dialog.count(), 0, `${defId}: automatic effects must remain automatic`)
  }
})

for (const defId of ['exhume', 'deep_breath', 'eerie_expedition']) {
  test(`Exhaust recovery and forced recovery: ${defId}`, async ({ page, soul }) => {
    const { base, card, fuel, setHand, play, dialog, activate, read } = soul
    base.combat.players[0].exhaust = [card('defend_ironclad', 'recover-me')]
    await setHand([card(defId, 'recovery'), ...fuel], [], 9)
    await play(CARDS[defId].name)
    const recovery = page.getByRole('dialog', { name: /from your Exhaust pile/ })
    await recovery.waitFor()
    assert.equal(await dialog.count(), 0)
    assert.equal(await recovery.locator('.hand-discard__hand .card').count(), 1)
    await activate(recovery.locator('.hand-discard__hand .card'))
    await activate(recovery.getByRole('button', { name: /Return selected|Put selected/ }))
    await recovery.waitFor({ state: 'detached' })
    await page.waitForFunction(() => !window.__STS_DEBUG__.getState().players[0].exhaust.some(card => card.uid === 'recover-me'))

    base.combat.players[0].exhaust = [
      card('defend_ironclad', 'recover-me'), card('strike_ironclad', 'leave-exhausted'),
    ]
    await setHand([card('havoc', 'recovery-havoc'), ...fuel], [card(defId, 'forced-recovery')], 1)
    await play('Havoc')
    await recovery.waitFor()
    assert.equal(await recovery.getByRole('button', { name: 'Cancel', exact: true }).count(), 0)
    await recovery.focus()
    await page.keyboard.press('Escape')
    assert(await recovery.isVisible(), `${defId}: forced Exhaust recovery cannot be abandoned`)
    await activate(recovery.locator('.hand-discard__hand .card').first())
    await activate(recovery.getByRole('button', { name: /Return selected|Put selected/ }))
    await recovery.waitFor({ state: 'detached' })
    await page.waitForFunction(() => !window.__STS_DEBUG__.getState().startTurnProgress?.forcedCard)
    assert(!(await read()).players[0].exhaust.some(card => card.uid === 'recover-me'))
  })
}

test('Jasper card Exhaust limits', async ({ page, soul }) => {
  const { base, card, setHand, play, dialog, confirm, choiceCards, activate, read } = soul
  base.combat.players[0].guardianMode = 'defense'
  for (const [defId, maximum] of [['guardian_harden', 3], ['guardian_bauble_burst', 6]]) {
    const source = { ...card(defId, 'jasper-source'), attachedGemId: 'guardian_jasper' }
    const spares = Array.from({ length: 7 }, (_, index) => card('defend_ironclad', `jasper-${index}`))
    await setHand([source, ...spares], [], 9)
    await play(CARDS[defId].name)
    await dialog.waitFor()
    assert(await confirm().isEnabled())
    for (let index = 0; index <= maximum; index++) await activate(choiceCards().nth(index))
    assert.equal(await dialog.locator('.card--selected').count(), maximum)
    await activate(confirm())
    await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
    assert.deepEqual((await read()).players[0].exhaust.map(card => card.uid),
      spares.slice(1, maximum + 1).map(card => card.uid))
  }
})

test('Jasper Power and Gem Finder Exhaust choices', async ({ page, soul }) => {
  const { base, card, fuel, setHand, dialog, confirm, activate } = soul
  base.combat.players[0].guardianMode = 'defense'
  for (const defId of ['guardian_floating_orbs', 'guardian_gem_finder']) {
    base.combat.players[0].powers = [{
      ...card(defId, 'jasper-power'), attachedGemId: 'guardian_jasper',
    }]
    await setHand(fuel, [card('defend_ironclad', 'scry-spare')], 9)
    await page.getByRole('button', { name: `Use ${CARDS[defId].name} with Jasper`, exact: true }).click()
    if (defId === 'guardian_gem_finder') {
      await page.getByRole('dialog', { name: /Gem Finder/ }).getByRole('button', { name: /Keep all/ }).click()
    }
    await dialog.waitFor()
    await activate(dialog.locator('.card[data-card-name="Defend"]'))
    await activate(confirm())
    await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].exhaust.some(card => card.uid === 'defend'))
  }
})

test('Copied Rampage makes its own Exhaust choice', async ({ page, soul }) => {
  const { card, fuel, setHand, play, dialog, activate, confirm, read } = soul
  await setHand([card('double_tap', 'double'), card('rampage', 'copied-rampage', true), ...fuel], [], 9)
  await play('Double Tap')
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
  await play('Rampage+')
  await dialog.waitFor()
  await activate(dialog.locator('.card[data-card-name="Defend"]'))
  await activate(confirm())
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().pendingCardCopy?.card.defId === 'rampage')
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Cancel play', exact: true }).count(), 0)
  await activate(dialog.locator('.card[data-card-name="Daze"]'))
  await activate(confirm())
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => !window.__STS_DEBUG__.getState().pendingCardCopy)
  assert.deepEqual((await read()).players[0].exhaust.map(card => card.uid), ['defend', 'daze'])
  assert.equal((await read()).enemies[0].hp, 27, 'the copied Rampage must count its own new Exhaust')
})

test('Crowded Havoc hand supports forced-card dragging', async ({ page, soul }) => {
  const { base, card, sever, setHand, dialog, activate, confirm, dragForcedCard, read } = soul
  const originalEnemy = base.combat.enemies[0]
  base.combat.enemies.push({ ...originalEnemy, uid: 'other-target' })
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
})

for (const [boosted, count, damage] of [[false, 1, 3], [true, 2, 4]]) {
  test(`Havoc resolves mandatory Exhaust before targeting: ${boosted ? 'upgraded' : 'base'}`, async ({ page, screen, soul }) => {
    const { base, card, fuel, sever, upgraded, setHand, play, dialog, targetInstruction,
      activate, output, confirm, dragForcedCard, read } = soul
    const drawn = boosted ? upgraded : sever
    base.combat.enemies.push({ ...base.combat.enemies[0], uid: 'other-target' })
    await setHand([card('havoc', 'havoc'), ...fuel], [drawn], 1)
    await play('Havoc')
    await dialog.waitFor()
    assert.equal(await targetInstruction.count(), 0, 'choose the Exhaust card before asking for an enemy')
    assert.equal(await dialog.getByRole('button', { name: 'Cancel play', exact: true }).count(), 0,
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
  })
}

test('Havoc finishes automatically without Exhaust candidates', async ({ page, soul }) => {
  const { card, sever, setHand, play, dialog } = soul
  await setHand([card('havoc', 'havoc-empty')], [sever], 1)
  await play('Havoc')
  await page.waitForFunction(() => {
    const state = window.__STS_DEBUG__.getState()
    return !state.startTurnProgress?.forcedCard && state.players[0].exhaust.some(card => card.uid === 'sever')
  })
  assert.equal(await dialog.count(), 0, 'forced Sever Soul with no Exhaust choices must finish automatically')
})

test('Sever Soul selection, cancellation, focus, and confirmation', async ({ page, screen, phone, soul }) => {
  const { sever, fuel, setHand, read, play, dialog, choiceCards, confirm, activate, output } = soul
  await setHand([sever, ...fuel])
  const before = await read()
  await play('Sever Soul')
  await dialog.waitFor()
  assert.equal(await choiceCards().count(), 3, 'only other hand cards may be exhausted')
  assert.equal(await dialog.locator('.hand-discard__hand .card[data-card-name="Sever Soul"]').count(), 0)
  assert(await confirm().isDisabled())
  await activate(dialog.locator('.card[data-card-name="Defend"]'))
  await activate(dialog.locator('.card[data-card-name="Daze"]'))
  assert.equal(await dialog.locator('.card--selected').count(), 1, 'base card allows one choice')
  await activate(dialog.locator('.card[data-card-name="Daze"]'))
  assert(await confirm().isDisabled(), 'deselecting the only choice must disable confirmation')
  assert.deepEqual(await read(), before, 'inspection must not spend Energy, deal damage or exhaust cards')
  if (phone) await activate(dialog.getByRole('button', { name: 'Cancel play', exact: true }))
  else await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(await read(), before, 'cancelling must leave the play uncommitted')
  await play('Sever Soul')
  await dialog.waitFor()
  await activate(dialog.getByRole('button', { name: 'Cancel play', exact: true }))
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(await read(), before, 'Cancel must leave the entire combat unchanged')
  await play('Sever Soul')
  await dialog.waitFor()
  await activate(dialog.locator('.card[data-card-name="Daze"]'))
  assert(await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const controls = [...element.querySelectorAll('.hand-discard__footer button')]
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
})

test('Upgraded Sever Soul accepts one or two Exhaust cards', async ({ page, screen, soul }) => {
  const { upgraded, fuel, setHand, play, dialog, confirm, activate, output, read } = soul
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
})

test('Live hand updates discard stale Exhaust selections', async ({ page, soul }) => {
  const { upgraded, fuel, setHand, play, dialog, activate, confirm, read } = soul
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
  await page.waitForFunction(() => document.querySelector('.hand-discard__footer button:last-child')?.disabled)
  await activate(dialog.locator('.card[data-card-name="Daze"]'))
  await activate(confirm())
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
  assert.deepEqual((await read()).players[0].exhaust.map(card => card.uid), ['daze'],
    'live hand updates must discard stale selections')
})

test('Empty and mandatory singleton Exhaust pools resolve automatically', async ({ page, soul }) => {
  const { card, sever, fuel, setHand, play, dialog, read } = soul
  await setHand([sever])
  await play('Sever Soul')
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
  assert.equal(await dialog.count(), 0, 'an empty eligible hand must not strand the play')
  assert.equal((await read()).enemies[0].hp, 27)
  for (const [defId, upgraded] of [
    ['true_grit', false], ['burning_pact', false], ['sever_soul', false], ['sever_soul', true], ['rampage', true],
  ]) {
    await setHand([card(defId, 'only-source', upgraded), fuel[0]], [], 9)
    await play(faceOf(CARDS[defId], upgraded).name)
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 1)
    assert.equal(await dialog.count(), 0, `${defId}: one mandatory candidate must bypass the picker`)
    assert.deepEqual((await read()).players[0].exhaust.map(card => card.uid), ['defend'])
  }
})

test('An optional singleton Exhaust pool still permits keeping the card', async ({ soul }) => {
  const { card, fuel, setHand, play, dialog, confirm, activate, read } = soul
  await setHand([card('purity', 'optional-source'), fuel[0]], [], 9)
  await play('Purity')
  await dialog.waitFor()
  assert(await confirm().isEnabled(), 'one optional candidate must still allow exhausting none')
  await activate(confirm())
  await dialog.waitFor({ state: 'detached' })
  assert((await read()).players[0].hand.some(card => card.uid === 'defend'))
})

test('A live Exhaust pool reduced to one required card resolves automatically', async ({ page, soul }) => {
  const { sever, fuel, setHand, play, dialog } = soul
  await setHand([sever, ...fuel], [], 9)
  await play('Sever Soul')
  await dialog.waitFor()
  await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.combat.players[0].hand = run.combat.players[0].hand.filter(card => card.uid === 'sever' || card.uid === 'defend')
    window.__STS_DEBUG__.setRun(run)
  })
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].exhaust.some(card => card.uid === 'defend'))
})
