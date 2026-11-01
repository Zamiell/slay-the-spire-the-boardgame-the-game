import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'
import { pickUpCard, confirmCardPlay } from '../lib/card-interactions.mjs'

test.use({ appKey: import.meta.url })

test('flurry-stance', async ({ page, screen, appURL, artifacts: output }) => {
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const fixture = enterRoom(run, room)
  fixture.campaign.runId = `flurry-${screen}`
  Object.assign(fixture.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined,
    stanceChangedThisTurn: [] })
  const card = (defId, uid, upgraded = false) => ({ defId, uid, upgraded })
  const hand = [
    card('flurry_of_blows', 'flurry'), card('flurry_of_blows', 'flurry-plus', true),
    card('tranquility', 'calm'), card('crescendo', 'wrath'), card('empty_body', 'neutral'),
  ]
  const draw = [card('flurry_of_blows', 'next-flurry'), card('flurry_of_blows', 'next-plus', true)]
  Object.assign(fixture.combat.players[0], {
    hand, draw, discard: [], exhaust: [], powers: [], relics: [], potions: [],
    energy: 9, block: 0, stance: 'calm', deck: [...hand, ...draw],
  })
  fixture.players[0].deck = structuredClone(fixture.combat.players[0].deck)
  fixture.combat.enemies = [{ ...fixture.combat.enemies[0], uid: 'target', defId: 'small_slime',
    hp: 30, maxHp: 30, block: 0, dead: false }]
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
  const flurries = page.locator('.hand .card[data-card-name^="Flurry of Blows"]')
  const badge = flurries.locator('.card__stance-bonus')
  await flurries.first().waitFor()
  assert.deepEqual(await badge.allTextContents(), ['No stance change', 'No stance change'])
  assert.equal(await page.locator('.hand .card:not([data-card-name^="Flurry"]) .card__stance-bonus').count(), 0)
  const play = async name => {
    await pickUpCard(page, name)
    await confirmCardPlay(page)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
  }
  await play('Tranquility')
  assert.deepEqual(await badge.allTextContents(), ['No stance change', 'No stance change'],
    'entering the current stance must not activate Flurry')
  await flurries.first().focus()
  await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
  await page.screenshot({ path: `${output}/${screen}-inactive.png` })
  await play('Crescendo')
  assert.deepEqual(await badge.allTextContents(), ['Stance changed', 'Stance changed'])
  await play('Empty Body')
  assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].stance), 'neutral')
  assert.deepEqual(await badge.allTextContents(), ['Stance changed', 'Stance changed'],
    'leaving stance must not clear an already-earned bonus')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sts-solo-run')).run.combat.stanceChangedThisTurn.includes('p1'))
  await page.reload()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await flurries.first().waitFor()
  assert.deepEqual(await badge.allTextContents(), ['No stance change', 'No stance change'],
    'solo Resume restores the combat-start checkpoint, including its inactive stance bonus')
  await play('Crescendo')
  await play('Empty Body')
  assert.deepEqual(await badge.allTextContents(), ['Stance changed', 'Stance changed'])
  await flurries.first().focus()
  assert.match(await flurries.first().evaluate(card => document.getElementById(card.getAttribute('aria-describedby')).textContent),
    /You changed stance this turn/)
  await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
  assert(await badge.first().evaluate(mark => {
    const card = mark.parentElement.getBoundingClientRect(), box = mark.getBoundingClientRect()
    const damage = mark.parentElement.querySelector('.card__live-damage')?.getBoundingClientRect()
    return box.left >= card.left && box.right <= card.right && box.top >= card.top &&
      box.bottom < card.top + card.height * 0.58 && mark.scrollWidth <= mark.clientWidth &&
      (!damage || box.top >= damage.bottom || box.bottom <= damage.top || box.left >= damage.right || box.right <= damage.left)
  }), 'the badge must fit above the printed rules and not cover the damage preview')
  await page.screenshot({ path: `${output}/${screen}-active.png` })
  await page.keyboard.press('d')
  const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
  await deck.waitFor()
  assert((await deck.locator('.card__stance-bonus').allTextContents()).every(text => text === 'Stance changed'))
  await page.keyboard.press('d')
  await pickUpCard(page, 'Flurry of Blows+')
  assert.equal(await page.locator('.card-interaction__card .card__stance-bonus').innerText(), 'Stance changed')
  await confirmCardPlay(page, page.locator('[data-enemy-id="target"] .enemy__hit-area'))
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies[0].hp === 27)
  await page.locator('.card-interaction').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: /^End Turn 1/ }).click()
  await page.waitForFunction(() => {
    const state = window.__STS_DEBUG__.getState()
    return state.turn === 2 && state.phase === 'player'
  })
  assert((await badge.count()) >= 2)
  assert((await badge.allTextContents()).every(text => text === 'No stance change'),
    'the indicator must reset with the engine at the next turn')
  console.log(`PASS ${screen}: stance changes, same-stance entry, resume, aiming and next-turn reset`)
})
