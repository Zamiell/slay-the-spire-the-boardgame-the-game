import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url, hasTouch: false, isMobile: false })

test('runic-pyramid', async ({ page, screen, appURL }) => {
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const next = enterRoom(run, room)
  Object.assign(next.combat.players[0], {
    relics: [{ defId: 'runic_pyramid', spent: false }],
    hand: Array.from({ length: 8 }, (_, index) =>
      ({ uid: `choose-${index}`, defId: 'defend_ironclad', upgraded: false })),
    draw: Array.from({ length: 6 }, (_, index) =>
      ({ uid: `draw-${index}`, defId: 'strike_ironclad', upgraded: false })),
    discard: [],
  })
  await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), next)
  const activate = page.getByRole('button', { name: /^Use Runic Pyramid:/ })
  const panel = page.getByRole('dialog', { name: 'Retain 1 to 8 cards' })
  await activate.waitFor()
  const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
  await activate.click()
  assert(await panel.getByRole('button', { name: 'Retain 0 cards', exact: true, includeHidden: true }).isDisabled())
  await panel.locator('.hand-discard__hand .card').first().focus()
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
    'opening or closing the picker must not spend the relic')
  await activate.click()
  assert.equal(await panel.locator('.hand-discard__selection .card').count(), 0, 'cancel clears tentative picks')
  await panel.locator('.hand-discard__hand .card').first().focus()
  await page.keyboard.press('Enter')
  await panel.locator('.hand-discard__hand .card').last().focus()
  await page.keyboard.press('Enter')
  const confirm = panel.getByRole('button', { name: 'Retain 2 cards', exact: true })
  await confirm.scrollIntoViewIfNeeded()
  assert(await confirm.evaluate((button) => {
    const box = button.getBoundingClientRect()
    return box.top >= 0 && box.bottom <= innerHeight &&
      button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  }), `${screen}: the retain confirmation is clipped or covered`)
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
    'selecting cards must not activate the relic before confirmation')
  await confirm.click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].relics[0].spent)
  assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].hand
    .filter((card) => card.retainThisTurn).map((card) => card.uid)), ['choose-0', 'choose-7'])
  assert.equal(await panel.count(), 0, 'a spent Runic Pyramid must not be usable again')
  const turn = next.combat.turn
  await page.getByRole('button', { name: /^End Turn \d+/ }).click()
  await page.waitForFunction((turn) => window.__STS_DEBUG__.getRun().combat.turn > turn, turn)
  const actor = await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0])
  assert.deepEqual(actor.hand.filter((card) => card.uid.startsWith('choose-')).map((card) => card.uid),
    ['choose-0', 'choose-7'], 'only the chosen cards should survive the end-of-turn discard')
  assert.equal(await page.locator('dialog[data-action="retain"]').count(), 0, 'Runic Pyramid must not ask for the same choices twice')
  console.log(`PASS ${screen}: Runic Pyramid selection, safe confirmation and actual retention`)
})
