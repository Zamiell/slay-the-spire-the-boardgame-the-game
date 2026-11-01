import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'
import { canActivateRelic } from '../../src/game/combat.ts'
import { createRelicInstance, RELICS } from '../../src/game/relics.ts'
import { relicIconPath } from '../../src/game/assets.ts'
import { pickUpCard, confirmCardPlay } from '../lib/card-interactions.mjs'

test.use({ appKey: import.meta.url })

test('relic-action-icons', async ({ page, screen, phone, appURL }) => {
  const output = 'artifacts/relic-action-icons'
  mkdirSync(output, { recursive: true })
  const ids = Object.keys(RELICS)
  for (const id of ids) assert(existsSync(`public${relicIconPath(id)}`), `${id}: missing relic icon`)
  const manualIds = ids.filter(id => id !== 'the_courier' && (RELICS[id].activation ||
    ['charons_ashes', 'dollys_mirror', 'nilrys_codex', 'loaded_die', 'holy_water'].includes(id.replace(/^downfall_/, ''))))
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const base = enterRoom(run, room)
  base.campaign.runId = `relic-icon-audit-${screen}`
  Object.assign(base.combat.players[0], {
    relics: ids.map(createRelicInstance), powers: [], potions: ['fire_potion'],
    energy: 3, lostHpThisCombat: true, shuffledThisCombat: true, powerPlayedThisTurn: true,
    attacksPlayedThisTurn: 3, drawLocked: false,
    hand: ['strike_ironclad', 'defend_ironclad', 'daze'].map((defId, index) => ({ uid: `hand-${index}`, defId, upgraded: false })),
    exhaust: ['strike_ironclad', 'defend_ironclad'].map((defId, index) => ({ uid: `exhaust-${index}`, defId, upgraded: false })),
  })
  const seen = new Set()
  const scenarios = [
    { phase: 'player', die: 1, shivs: 0 }, { phase: 'player', die: 1, shivs: 5, shortHand: true },
    ...[1, 2, 3, 4, 5, 6].map(die => ({ phase: 'start', die, shivs: 5 })),
  ]
  for (const [index, scenario] of scenarios.entries()) {
    const fixture = structuredClone(base)
    Object.assign(fixture.combat, { phase: scenario.phase, die: scenario.die, turn: 2,
      combatId: `icon-audit-${index}`, startTurnStage: 'effects', startTurnProgress: undefined,
      pendingTriggers: [], pendingDieRelicChoices: [], pendingHermitSetupLoads: [] })
    const actor = fixture.combat.players[0]
    actor.shivs = scenario.shivs
    if (scenario.shortHand) actor.hand = actor.hand.slice(-1)
    const available = actor.relics.filter((_, relicIndex) => canActivateRelic(fixture.combat, actor, relicIndex))
    const usableDuringPlayerTurn = relic =>
      canActivateRelic({ ...fixture.combat, phase: 'player' }, actor, actor.relics.indexOf(relic))
    const displayedOrder = [...available.filter(relic => !usableDuringPlayerTurn(relic)),
      ...available.filter(usableDuringPlayerTurn)]
    available.forEach(relic => seen.add(relic.defId))
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
    await page.waitForFunction(id => window.__STS_DEBUG__.getState()?.combatId === id, fixture.combat.combatId)
    const controls = page.locator('.relic-actions > section > .potion-chip > button, .relic-actions > section > details > summary')
    assert.equal(await controls.count(), available.length, `${screen}/${index}: audit did not reach all available actions`)
    const images = controls.locator('img.item-icon-image')
    assert.equal(await images.count(), available.length, `${screen}/${index}: a relic action is text-only`)
    await images.evaluateAll(images => Promise.all(images.map(image => image.decode())))
    const rendered = await controls.evaluateAll(controls => controls.map(control => {
      const image = control.querySelector('img.item-icon-image')
      return { label: control.getAttribute('aria-label'), src: image.getAttribute('src'),
        width: image.getBoundingClientRect().width, loaded: image.complete && image.naturalWidth > 0,
        summary: control.tagName === 'SUMMARY', iconSummary: control.classList.contains('relic-action__icon'),
        group: control.closest('section').getAttribute('aria-label') }
    }))
    for (const [at, relic] of displayedOrder.entries()) {
      assert(rendered[at].label.startsWith(`Use ${RELICS[relic.defId].name}`))
      assert.equal(rendered[at].src, relicIconPath(relic.defId))
      assert(rendered[at].loaded && rendered[at].width > 0)
      assert(!rendered[at].summary || rendered[at].iconSummary, `${relic.defId}: disclosure lacks icon styling`)
      assert.equal(rendered[at].group, usableDuringPlayerTurn(relic)
        ? 'Other relic abilities' : 'Start of Turn relic abilities',
      `${relic.defId}: action must be grouped by its actual phase restriction`)
    }
    assert.equal(await page.locator('.relic-actions__heading').count(),
      available.some(relic => !usableDuringPlayerTurn(relic)) ? 1 : 0)
  }
  assert.deepEqual(manualIds.filter(id => !seen.has(id)), [], 'every activatable relic must be exercised')
  const branch = structuredClone(base)
  Object.assign(branch.combat, { phase: 'player', turn: 2, combatId: `dead-branch-${screen}`,
    pendingTriggers: [], startTurnProgress: undefined })
  branch.combat.players[0].relics = [createRelicInstance('dead_branch')]
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), branch)
  const branchChip = page.locator('.relic-bar [data-relic="dead_branch"]')
  if (phone) await branchChip.tap()
  else await branchChip.hover()
  const branchTip = branchChip.locator('.relic-tip')
  await branchTip.waitFor()
  for (const count of [2, 1, 0]) {
    await page.evaluate(count => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].exhaust = run.combat.players[0].exhaust.slice(0, count)
      window.__STS_DEBUG__.setRun(run)
    }, count)
    const expected = `Exhaust pile (${count} card${count === 1 ? '' : 's'})`
    assert((await branchTip.innerText()).includes(expected), 'an open tooltip must follow the current Exhaust pile')
    assert((await branchChip.getAttribute('aria-label')).includes(expected))
    assert((await page.getByRole('button', { name: /^Use Dead Branch:/ }).getAttribute('aria-label')).includes(expected))
  }
  await page.keyboard.press('Escape')
  await page.mouse.move(2, 2)
  const branchAction = page.getByRole('button', { name: /^Use Dead Branch:/ })
  if (phone) await branchAction.tap()
  else await branchAction.hover()
  const branchActionTip = page.locator('.potion-tip').filter({ hasText: 'Dead Branch' })
  await branchActionTip.waitFor()
  assert((await branchActionTip.innerText()).includes('Exhaust pile (0 cards)'))
  assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].relics[0].spent), false)
  const outside = structuredClone(branch)
  outside.phase = 'map'
  outside.combat = null
  outside.players[0].relics = [createRelicInstance('dead_branch')]
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), outside)
  if (phone) await branchChip.tap()
  else await branchChip.hover()
  await branchTip.waitFor()
  assert(!(await branchTip.innerText()).includes('Exhaust pile ('), 'outside combat, do not show a stale Exhaust count')
  const skull = structuredClone(base)
  Object.assign(skull.combat, { phase: 'player', turn: 2, combatId: `red-skull-${screen}`,
    pendingTriggers: [], startTurnProgress: undefined })
  Object.assign(skull.combat.players[0], {
    relics: [createRelicInstance('red_skull')], strength: 0, energy: 3, draw: [],
    hand: [{ uid: 'shuffle-draw', defId: 'shrug_it_off', upgraded: false }],
    discard: [{ uid: 'reshuffled', defId: 'strike_ironclad', upgraded: false }],
  })
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), skull)
  const skullChip = page.locator('.app-shell__header .relic-chip[data-relic="red_skull"]')
  await skullChip.waitFor()
  assert.equal(await page.getByRole('button', { name: /^Use Red Skull/ }).count(), 0)
  await pickUpCard(page, 'Shrug It Off')
  await confirmCardPlay(page)
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].strength === 1)
  await page.locator('.card-interaction').waitFor({ state: 'detached' })
  assert.match(await skullChip.getAttribute('aria-label'), /Face down/)
  assert.equal(await page.getByRole('button', { name: /^Use Red Skull/ }).count(), 0)
  assert(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].hand.some(card => card.uid === 'reshuffled')))
  const candle = structuredClone(base)
  Object.assign(candle.combat, { phase: 'start', turn: 2, die: 3, combatId: `candle-${screen}`,
    pendingTriggers: [], startTurnStage: 'effects', startTurnProgress: undefined })
  candle.combat.players[0].relics = ['blue_candle', 'toolbox'].map(createRelicInstance)
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), candle)
  const startRow = page.getByRole('region', { name: 'Start of Turn relic abilities', exact: true })
  const otherRow = page.getByRole('region', { name: 'Other relic abilities', exact: true })
  await startRow.waitFor()
  await otherRow.waitFor()
  assert.equal(await startRow.locator('h3').innerText(), 'Start of Turn only')
  assert.equal(await startRow.getByRole('button', { name: /^Use Toolbox:/ }).count(), 1)
  assert.equal(await otherRow.getByRole('button', { name: /^Use Blue Candle:/ }).count(), 1)
  const startBounds = await startRow.boundingBox()
  const otherBounds = await otherRow.boundingBox()
  assert(startBounds.y + startBounds.height <= otherBounds.y,
    `${screen}: start-only and general relics must occupy separate rows`)
  assert(await startRow.evaluate(row => {
    const box = row.getBoundingClientRect()
    return parseFloat(getComputedStyle(row).borderTopWidth) > 0 &&
      box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
  }), `${screen}: the start-only row must be visibly delineated and fit the screen`)
  await page.screenshot({ path: `${output}/${screen}-start-turn-row.png` })
  await startRow.getByRole('button', { name: /^Use Toolbox:/ }).press('Enter')
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().die === 2)
  assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].relics[0].spent), false,
    'regrouping must preserve original relic indexes')
  await startRow.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().phase === 'player')
  const summary = page.getByRole('button', { name: /^Use Blue Candle:/ })
  await summary.waitFor()
  const before = await page.evaluate(() => window.__STS_DEBUG__.getRun())
  if (!phone) {
    await summary.hover()
    const tip = page.locator('.potion-tip').filter({ hasText: 'Blue Candle' })
    await tip.waitFor()
    assert.match(await tip.innerText(), /Exhaust up to 2 cards/)
    await page.keyboard.press('Escape')
  }
  await page.screenshot({ path: `${output}/${screen}-blue-candle-icon.png` })
  if (phone) await summary.tap()
  else await summary.click()
  const panel = page.getByRole('dialog', { name: 'Exhaust up to 2 cards', exact: true })
  await panel.waitFor()
  assert.equal(await panel.getAttribute('open'), '', 'a single activation must still open Blue Candle choices')
  assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun()), before,
    'opening or inspecting a relic must not spend it')
  for (const count of [0, 2]) {
    for (let index = 0; index < count; index++) {
      const card = panel.locator('.hand-discard__hand .card').first()
      await card.focus()
      await page.keyboard.press('Enter')
    }
    assert.equal(await panel.locator('.card--selected').count(), count)
    const cancel = panel.getByRole('button', { name: 'Cancel', exact: true })
    if (phone) await cancel.tap()
    else await cancel.click()
    await panel.waitFor({ state: 'detached' })
    assert(await summary.evaluate(element => element === document.activeElement), 'Cancel must restore focus')
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun()), before,
      'cancelling must not exhaust cards or spend the relic')
    if (phone) await summary.tap()
    else await summary.click()
    await panel.waitFor()
    assert.equal(await panel.locator('.card--selected').count(), 0, 'reopening must start with no selection')
  }
  await page.screenshot({ path: `${output}/${screen}-blue-candle-cancel.png` })
  const first = panel.locator('.hand-discard__hand .card').first()
  await first.focus()
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'Activate', exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].relics[0].spent)
  assert(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].exhaust.some(card => card.uid === 'hand-0')))
  console.log(`PASS ${screen}: ${ids.length} relic icon assets, ${seen.size} manual relics, all die faces and Blue Candle activation`)
})
