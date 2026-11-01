import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'
import { relicDef } from '../../src/game/relics.ts'

test.use({ appKey: import.meta.url })

test('relic-refresh', async ({ page, screen, phone, appURL, artifacts: output }) => {
  const reusableIds = ['golden_eye', 'blue_candle', 'runic_pyramid', 'gambling_chip', 'the_abacus', 'toolbox']
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const fight = enterRoom(run, room)
  Object.assign(fight.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined })
  fight.combat.players[0].relics = [
    ...reusableIds.map(defId => ({ defId, spent: true })),
    { defId: 'holy_water', spent: false, cubes: 0 },
    { defId: 'wing_boots', spent: false, uses: 1 },
  ]
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fight)
  const chip = id => page.locator(`.app-shell__header .relic-chip[data-relic="${id}"]`)
  await chip('golden_eye').waitFor()
  assert.match(await chip('golden_eye').getAttribute('aria-label'), /Face down/)
  await page.reload()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await chip('golden_eye').waitFor()
  for (const id of reusableIds) assert.match(await chip(id).getAttribute('aria-label'), /Face down/,
    'resuming an active combat must not refresh its spent relics')
  assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].relics
    .find(relic => relic.defId === 'holy_water').cubes), 0)
  await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.combat.phase = 'won'
    run.combat.enemies.forEach(enemy => { enemy.dead = true; enemy.hp = 0 })
    window.__STS_DEBUG__.setRun(run)
  })
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat === null)
  await page.locator('.reward-screen--loot .reward-screen__skip').click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
  for (const id of reusableIds) {
    assert.doesNotMatch(await chip(id).getAttribute('aria-label'), /Face down/)
    assert(!(await chip(id).getAttribute('class')).includes('relic-chip--spent'))
  }
  assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].relics
    .find(relic => relic.defId === 'holy_water').cubes), 2)
  await page.evaluate(ids => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    for (const relic of run.players[0].relics) if (ids.includes(relic.defId)) relic.spent = true
    window.__STS_DEBUG__.setRun(run)
  }, reusableIds)
  await page.reload()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.locator('.map .room--reachable').first().waitFor()
  for (const id of reusableIds) assert.doesNotMatch(await chip(id).getAttribute('aria-label'), /Face down/,
    'resuming an older map save must clear stale relic cooldowns')
  await page.evaluate(async ids => {
    const { EVENT_DEFINITIONS } = await import('/src/game/events.ts')
    const { createEventRoom } = await import('/src/game/event-room.ts')
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.phase = 'room'
    run.act = 2
    run.rewards = []
    run.rewardDestination = null
    run.map.rooms[run.map.position].kind = 'event'
    run.roomState = createEventRoom({ ...EVENT_DEFINITIONS.we_meet_again,
      instanceId: 'refresh-event', act: 2, minAscension: 0, requiresColorlessUnlock: false })
    // Reproduce an event saved by the old end-of-combat cleanup.
    for (const relic of run.players[0].relics) if (ids.includes(relic.defId)) relic.spent = true
    run.players[0].relics.find(relic => relic.defId === 'holy_water').cubes = 0
    window.__STS_DEBUG__.setRun(run)
  }, reusableIds)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sts-solo-run')).run.roomState?.card.instanceId === 'refresh-event')
  await page.reload()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('heading', { name: 'We Meet Again!', exact: true }).waitFor()
  assert.doesNotMatch(await chip('golden_eye').getAttribute('aria-label'), /Face down/)
  for (const id of reusableIds) assert.doesNotMatch(await chip(id).getAttribute('aria-label'), /Face down/)
  assert.match(await chip('wing_boots').getAttribute('aria-label'), /1 use remaining/)
  const state = await page.evaluate(() => window.__STS_DEBUG__.getRun())
  assert.equal(state.players[0].relics.find(relic => relic.defId === 'holy_water').cubes, 2)
  if (phone) await chip('golden_eye').tap()
  else await chip('golden_eye').hover()
  const tip = chip('golden_eye').locator('.relic-tip')
  await tip.waitFor()
  assert.match(await tip.innerText(), /Once per combat: Scry 3/)
  assert.doesNotMatch(await tip.innerText(), /Face down/)
  await page.screenshot({ path: `${output}/${screen}-event.png` })
  await page.keyboard.press('Escape')
  const headerRules = new Map()
  for (const relic of state.players[0].relics) {
    await page.mouse.move(2, 2)
    if (phone) { await page.keyboard.press('Tab'); await chip(relic.defId).focus() }
    else await chip(relic.defId).hover()
    const help = chip(relic.defId).locator('.relic-tip')
    await help.waitFor()
    headerRules.set(relic.defId, await help.innerText())
    await page.keyboard.press('Escape')
  }
  await page.locator('[data-event-option="exchange"]').click()
  const picker = page.getByRole('group', { name: 'Your relic', exact: true })
  await picker.waitFor()
  const beforeInspection = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
  for (const relic of state.players[0].relics) {
    const option = picker.getByRole('button', { name: new RegExp(`^${relicDef(relic.defId).name}`) })
    if (phone) await option.focus()
    else await option.hover()
    const help = page.locator('.potion-tip').filter({ hasText: relicDef(relic.defId).name })
    await help.waitFor()
    assert.equal(await help.innerText(), headerRules.get(relic.defId),
      `${screen}: event choices must match the header's rules, remaining uses and spent status`)
    assert.equal(await option.getAttribute('aria-pressed'), 'false')
    assert.equal(await option.getAttribute('title'), null, 'native tooltips must not compete with the shared tooltip')
    assert(await help.evaluate(help => {
      const box = help.getBoundingClientRect()
      return help.parentElement === document.body && box.left >= 0 && box.top >= 0 &&
        box.right <= innerWidth && box.bottom <= innerHeight
    }), 'event relic help must escape the picker and fit the viewport')
    await page.keyboard.press('Escape')
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeInspection)
  const goldenEye = picker.getByRole('button', { name: /^Golden Eye/ })
  if (phone) await goldenEye.tap()
  else await goldenEye.click()
  assert.equal(await goldenEye.getAttribute('aria-pressed'), 'true', 'one activation must still select the relic')
  assert(await page.getByRole('button', { name: /Confirm choice/ }).isEnabled())
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeInspection,
    'selecting an exchange must still wait for confirmation')
  await goldenEye.focus()
  await page.screenshot({ path: `${output}/${screen}-event-choices.png` })
  if (phone) await goldenEye.tap()
  else await goldenEye.click()
  assert.equal(await goldenEye.getAttribute('aria-pressed'), 'false')
  await page.evaluate(async () => {
    const { EVENT_DEFINITIONS } = await import('/src/game/events.ts')
    const { createEventRoom } = await import('/src/game/event-room.ts')
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.roomState = createEventRoom({ ...EVENT_DEFINITIONS.moai_head,
      instanceId: 'tooltip-moai', act: 3, minAscension: 0, requiresColorlessUnlock: false })
    window.__STS_DEBUG__.setRun(run)
  })
  await page.locator('[data-event-option="offer"]').click()
  assert.match(await picker.getByRole('button', { name: /^Golden Eye/ }).innerText(), /7 Gold/,
    'replacing native tooltips must not hide an event-specific relic sale price')
  const teammate = postNeowRun(47, [
    { id: 'p1', name: 'Watcher', character: 'watcher' },
    { id: 'p2', name: 'Ironclad', character: 'ironclad' },
  ]).players[1]
  for (const party of [true, false]) {
    await page.evaluate(async ({ base, teammate }) => {
      const { EVENT_DEFINITIONS } = await import('/src/game/events.ts')
      const { createEventRoom } = await import('/src/game/event-room.ts')
      const run = structuredClone(base)
      if (teammate) run.players.push(teammate)
      run.roomState = createEventRoom({ ...EVENT_DEFINITIONS.face_trader,
        instanceId: `face-trader-label-${run.players.length}`, act: 3, minAscension: 0, requiresColorlessUnlock: false })
      window.__STS_DEBUG__.setRun(run)
    }, { base: state, teammate: party ? teammate : null })
    await page.getByRole('heading', { name: 'Face Trader', exact: true }).waitFor()
    const exchange = page.locator('[data-event-option="exchange"]')
    assert.equal(await exchange.locator('strong').innerText(), party ? '[Exchange]' : '[Leave]')
    assert.equal(await exchange.locator('span').innerText(), party
      ? 'Give one of your Relics to a player. Then they give a Relic to you.'
      : 'No other player to exchange with.')
    assert(await exchange.isEnabled())
    if (!party) await page.screenshot({ path: `${output}/${screen}-face-trader-leave.png` })
    if (phone) await exchange.tap()
    else await exchange.click()
    if (party) {
      await page.locator('.event-panel--resolver').waitFor()
    } else {
      await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
      assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].relics),
        state.players[0].relics, 'solo Leave must preserve every relic')
    }
  }
  console.log(`PASS ${screen}: relic refresh, legacy resume, shared event tooltips and unchanged selection`)
})
