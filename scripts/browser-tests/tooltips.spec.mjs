import { test } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url, reducedMotion: "reduce" })

test('tooltips', async ({ page, screen, phone, appURL, artifacts: output }) => {
  const surface = panel => panel.evaluate(element => {
    const style = getComputedStyle(element)
    return Object.fromEntries(['backgroundImage', 'borderTopColor', 'borderTopWidth', 'borderRadius',
  'color', 'fontFamily', 'textShadow'].map(property => [property, style[property]]))
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /cannot be a (child|descendant)|validateDOMNesting/.test(message.text()))
      errors.push(message.text())
  })
  const noNative = async () => assert.equal(await page.locator('[title]').count(), 0, `${screen}: native tooltip remains`)
  const fit = async tip => assert(await tip.evaluate(element => {
    const box = element.getBoundingClientRect()
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
  }), `${screen}: tooltip is clipped`)
  const inspect = async (anchor, name) => {
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Tab')
    await anchor.focus()
    const id = await anchor.getAttribute('data-keyword-help-id')
    assert(id, `${name}: missing shared help anchor`)
    const tip = page.locator(`[id="${id}"][data-open]`)
    await tip.waitFor()
    assert((await tip.innerText()).includes(name))
    await fit(tip)
    return tip
  }
  await page.goto(appURL)
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  let tip = await inspect(settings, 'Settings')
  const expected = await surface(tip.locator('.card-keyword-tip'))
  assert.match(expected.backgroundImage, /linear-gradient/)
  assert.notEqual(expected.borderTopWidth, '0px')
  if (!phone) {
    await page.evaluate(() => document.activeElement?.blur())
    await settings.hover()
    await tip.waitFor()
  }
  await noNative()
  if (phone) await settings.tap()
  else { await settings.focus(); await page.keyboard.press('Enter') }
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await inspect(page.getByRole('button', { name: 'All heroes', exact: true }), 'All heroes')
  await page.getByRole('button', { name: 'Expression', exact: true }).click()
  tip = await inspect(page.getByRole('textbox', { name: 'Card expression' }), 'Card expression')
  assert.match(await tip.innerText(), /Quote names with spaces/)
  assert.deepEqual(await surface(tip.locator('.card-keyword-tip')), expected)
  await page.screenshot({ path: `${output}/${screen}-expression.png` })
  await noNative()
  await page.getByRole('button', { name: 'Back to main menu', exact: true }).click()
  for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
    await page.getByRole('button', { name, exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
  const run = postNeowRun(47, [{ id: 'p1', name: 'Defect', character: 'defect' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const fixture = enterRoom(run, room)
  Object.assign(fixture.combat, { phase: 'player', startTurnProgress: undefined, pendingTriggers: [] })
  Object.assign(fixture.combat.players[0], {
    relics: [{ defId: 'calipers', spent: false }], potions: ['block_potion'],
    powers: [], orbs: ['frost', null, null], block: 0, energy: 3,
    hand: [{ uid: 'tooltip-defend', defId: 'defend_defect', upgraded: false }],
  })
  await page.evaluate(fixture => window.__STS_DEBUG__.setRun(fixture), fixture)
  await page.waitForFunction(id => window.__STS_DEBUG__?.getState()?.combatId === id, fixture.combat.combatId)
  await page.locator('.combat[data-phase="player"]').waitFor()
  const snapshot = () => page.evaluate(() => window.__STS_DEBUG__.getState())
  const before = await snapshot()
  tip = await inspect(page.locator('.combat__end-turn'), 'Keyboard shortcut: Space')
  assert.deepEqual(await surface(tip.locator('.card-keyword-tip')), expected)
  tip = await inspect(page.locator('.hand .card[data-card-name="Defend"]'), 'Block')
  assert.deepEqual(await surface(tip.locator('.card-keyword-tip').first()), expected)
  assert.deepEqual(await snapshot(), before, 'reading help must not play a card or end the turn')
  const relic = page.locator('.relic-chip[data-relic="calipers"]').first()
  await relic.focus()
  const relicTip = relic.locator('.relic-tip')
  await relicTip.waitFor()
  assert.deepEqual(await surface(relicTip), expected)
  await page.evaluate(() => document.activeElement?.blur())
  const potion = page.getByRole('button', { name: 'Use Block Potion', exact: true })
  if (phone) await potion.tap()
  else await potion.hover()
  const potionTip = page.locator('.potion-tip').filter({ hasText: 'Block Potion' })
  await potionTip.waitFor()
  await fit(potionTip)
  assert.deepEqual(await surface(potionTip), expected)
  assert.deepEqual(await snapshot(), before, 'first touch must still inspect, not drink the potion')
  if (phone) await potion.tap()
  else await potion.click()
  await page.waitForFunction(() => !window.__STS_DEBUG__.getState().players[0].potions.includes('block_potion'))
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  const map = page.getByRole('dialog', { name: 'Act 1 map', exact: true })
  await map.waitFor()
  tip = await inspect(map.getByRole('button', { name: 'Close', exact: true }), 'Close map (M)')
  assert(await tip.evaluate(element => element.closest('dialog')?.matches(':modal')),
    'custom help must render inside the native dialog top layer')
  assert.deepEqual(await surface(tip.locator('.card-keyword-tip')), expected)
  await page.screenshot({ path: `${output}/${screen}-dialog.png` })
  const node = map.locator('.room').first()
  if (phone) await node.tap({ force: true })
  else await node.hover()
  const roomTip = node.locator('.room-tip')
  await roomTip.waitFor()
  assert.deepEqual(await surface(roomTip), expected)
  await noNative()
  await page.keyboard.press('m')
  await map.waitFor({ state: 'hidden' })
  assert.equal((await snapshot()).turn, before.turn, 'inspection must preserve the turn')
  const shopping = postNeowRun(97, [{ id: 'p1', name: 'Defect', character: 'defect' }])
  const merchantRoom = shopping.map.rows[0][0]
  shopping.map.rooms[merchantRoom].kind = 'merchant'
  shopping.players[0].gold = 99
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), enterRoom(shopping, merchantRoom))
  await page.getByRole('button', { name: 'Enter merchant shop', exact: true }).click()
  const ware = page.locator('.merchant-item:has(.merchant-tooltip)').first()
  await ware.waitFor()
  if (!phone) {
    await ware.hover()
    await ware.locator('.merchant-tooltip').waitFor()
    await page.screenshot({ path: `${output}/${screen}-merchant.png` })
  }
  assert.deepEqual(await surface(ware.locator('.merchant-tooltip')), expected)
  await noNative()
  assert.deepEqual(errors, [])
  console.log(`PASS ${screen}: unified surfaces, native-title audit, focus/hover, dialog help and touch confirmation`)
})
