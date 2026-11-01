import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url, isMobile: false })

test('card-choices', async ({ page, screen, viewport, phone, appURL }) => {
  const output = 'artifacts/card-choices'
  mkdirSync(output, { recursive: true })
  const card = (uid, defId) => ({ uid, defId, upgraded: false })
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const baseline = enterRoom(run, room)
  let sequence = 0
  const load = async player => {
    const fixture = structuredClone(baseline)
    Object.assign(fixture.combat, { phase: 'player', combatId: `choices-${screen}-${sequence++}`,
      pendingTriggers: [], startTurnProgress: undefined })
    Object.assign(fixture.combat.players[0], {
      hand: [], draw: [], discard: [], exhaust: [], powers: [], relics: [], potions: [], block: 0, energy: 9,
    }, player)
    await page.evaluate(fixture => window.__STS_DEBUG__.setRun(fixture), fixture)
  }
  const read = () => page.evaluate(() => window.__STS_DEBUG__.getState().players[0])
  const play = async name => {
    await page.locator(`.hand .card[data-card-name="${name}"]`).focus()
    await page.keyboard.press('Enter')
  }
  const choose = locator => phone ? locator.tap() : locator.click()
  const revealed = [card('revealed-defend', 'defend_ironclad'),
    card('revealed-strike', 'strike_ironclad'), card('revealed-daze', 'daze')]
  await load({ hand: [card('source', 'secret_technique')], draw: revealed })
  await play('Secret Technique')
  const scry = page.getByRole('dialog', { name: 'Scry 3', exact: true })
  await scry.waitFor()
  await choose(scry.locator('.hand-discard__hand .card[data-card-name="Strike"]'))
  const toHand = scry.getByRole('button', { name: 'Put in hand', exact: true })
  await toHand.scrollIntoViewIfNeeded()
  const hit = await toHand.evaluate(button => {
    const box = button.getBoundingClientRect()
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return { bounds: box.toJSON(), width: innerWidth, height: innerHeight, target: target?.className,
      reachable: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth &&
        button.contains(target) }
  })
  await page.screenshot({ path: `${output}/${screen}-scry-controls.png` })
  assert(hit.reachable, `${screen}: Scry-to-hand action is clipped or covered: ${JSON.stringify(hit)}`)
  await choose(toHand)
  assert.equal(await scry.getByRole('button', { name: 'Will put in hand', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await scry.locator('.hand-discard__selection .card').count(), 1,
    'putting a card into hand must not also select it for discard')
  await page.screenshot({ path: `${output}/${screen}-scry-to-hand.png` })
  await scry.getByRole('button', { name: 'Discard 1, put selected card in hand', exact: true }).click()
  await scry.waitFor({ state: 'detached' })
  assert.deepEqual((await read()).hand.map(card => card.uid), ['revealed-defend'])
  assert.deepEqual((await read()).discard.map(card => card.uid), ['revealed-strike'])
  assert.deepEqual((await read()).draw.map(card => card.uid), ['revealed-daze'])
  await load({ hand: [card('source', 'slayer_deceive_reality')], draw: revealed })
  await play('Deceive Reality')
  await scry.waitFor()
  assert(await scry.getByRole('button', { name: 'Choose a card to play', exact: true }).isDisabled())
  await choose(scry.locator('.hand-discard__hand .card[data-card-name="Daze"]'))
  await choose(scry.locator('.hand-discard__option').filter({
    has: page.locator('.card[data-card-name="Defend"]'),
  }).getByRole('button', { name: 'Play for 0', exact: true }))
  await scry.getByRole('button', { name: 'Discard 1, play selected card', exact: true }).click()
  await scry.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn >= 1)
  if ((await read()).cardsPlayedThisTurn === 1) await play('Defend')
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].cardsPlayedThisTurn === 2)
  assert.equal((await read()).energy, 7)
  assert.equal((await read()).block, 2)
  await load({ potions: ['liquid_memories'], discard: revealed.slice(0, 2) })
  await page.getByRole('button', { name: 'Use Liquid Memories', exact: true }).press('Enter')
  const recover = page.getByRole('dialog', { name: 'Liquid Memories', exact: true })
  await recover.waitFor()
  assert(await recover.locator('.hand-discard__hand .card').evaluateAll(cards => cards.every(card => {
    const box = card.getBoundingClientRect()
    const viewport = card.closest('.hand-discard__hand-scroll').getBoundingClientRect()
    return box.left >= viewport.left - 1 && box.right <= viewport.right + 1 &&
      box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1
  })), `${screen}: pile choices must stay inside their grid rather than receiving hand-fan transforms`)
  await choose(recover.locator('.hand-discard__hand .card[data-card-name="Defend"]'))
  await recover.waitFor({ state: 'detached' })
  assert.deepEqual((await read()).discard.map(card => card.uid), ['revealed-strike'])
  assert.equal((await read()).potions.length, 0)
  assert.match(await page.locator('.hand .card[data-card-name="Defend"]').getAttribute('aria-label'), /cost 0/)
  await load({ potions: ['purity_potion'], hand: revealed })
  await page.getByRole('button', { name: 'Use Purity Potion', exact: true }).press('Enter')
  const purity = page.getByRole('dialog', { name: 'Purity Potion', exact: true })
  await purity.getByRole('button', { name: 'Exhaust none', exact: true }).click()
  await purity.waitFor({ state: 'detached' })
  assert.equal((await read()).hand.length, 3)
  assert.equal((await read()).potions.length, 0)
  const event = structuredClone(baseline)
  event.phase = 'room'
  event.roomState = {
    kind: 'event', card: {
      id: 'downfall_event_act3_mysterious_sphere', instanceId: `scry-${screen}`, act: 3,
      minAscension: 0, requiresColorlessUnlock: false, name: 'Mysterious Sphere', scope: 'party',
      prompt: 'Choose after drawing opening hands.', options: [
        { id: 'open', label: 'Open Sphere', description: 'Open the sphere.', effects: [] },
      ],
    },
    decisions: {}, dieRolls: {}, preparedCombat: structuredClone(baseline.combat),
    preparedStartTurnScryAbilities: [],
    preparedStartTurnScry: { id: 'foresight', playerId: 'p1', label: 'Foresight', amount: 3, cards: revealed },
    preparedStartTurnCoordinatorId: 'p1',
  }
  await page.evaluate(event => window.__STS_DEBUG__.setRun(event), event)
  const prepared = page.getByRole('dialog', { name: /^Foresight.*Scry 3$/ })
  await prepared.waitFor()
  assert.equal(await prepared.locator('.hand-discard__hand .card').count(), 3)
  await choose(prepared.locator('.hand-discard__hand .card[data-card-name="Daze"]'))
  await prepared.getByRole('button', { name: 'Discard 1 and draw', exact: true }).waitFor()
  await prepared.getByRole('button', { name: 'View encounter', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await prepared.waitFor()
  assert(await prepared.isVisible(), 'a committed pre-draw reveal cannot be abandoned')
  assert.equal(await prepared.locator('.hand-discard__selection .card').count(), 1)
  console.log(`PASS ${screen}: independent Scry actions, mandatory free play, potion recovery, optional Exhaust and event reveals`)
})
