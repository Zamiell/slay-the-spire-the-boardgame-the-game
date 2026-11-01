import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'
import { createRelicInstance } from '../../src/game/relics.ts'

test.use({ appKey: import.meta.url })

test('die-breakdown', async ({ page, screen, phone, appURL }) => {
  const output = 'artifacts/die-breakdown'
  mkdirSync(output, { recursive: true })
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const fixture = enterRoom(run, room)
  fixture.campaign.runId = `die-breakdown-${screen}`
  Object.assign(fixture.combat, { phase: 'player', die: 5, pendingTriggers: [], startTurnProgress: undefined })
  Object.assign(fixture.combat.players[0], {
    relics: ['snecko_eye', 'loaded_die', 'duality', 'tungsten_rod', 'dollys_mirror', 'nilrys_codex', 'charons_ashes'].map(createRelicInstance),
    hand: [{ uid: 'lucky', defId: 'just_lucky', upgraded: false }], energy: 3,
  })
  fixture.combat.enemies = [{ ...fixture.combat.enemies[0], uid: 'snecko', defId: 'snecko', row: 0,
    hp: 23, maxHp: 23, dead: false, actionIndex: 0 }]
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
  const button = page.getByRole('button', { name: 'Die 5: show all six outcomes', exact: true })
  await button.waitFor()
  const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
  if (phone) await button.tap()
  else { await button.focus(); await page.keyboard.press('Enter') }
  const dialog = page.getByRole('dialog', { name: 'Die breakdown', exact: true })
  await dialog.waitFor()
  assert.equal(await dialog.locator('.die-breakdown__face').count(), 6)
  assert.equal(await dialog.locator('[data-current="true"]').getAttribute('data-face'), '5')
  const face = value => dialog.getByRole('region', { name: `Roll ${value}`, exact: true })
  assert.match(await face(5).innerText(), /next card this turn costs 2 Energy/)
  assert.match(await face(6).innerText(), /next card this turn costs 0 Energy/)
  assert.match(await face(6).innerText(), /Alternative:.*instead/s)
  assert.match(await face(1).innerText(), /Optional/)
  assert.match(await face(5).innerText(), /Tungsten Rod/)
  assert.match(await face(1).innerText(), /Just Lucky/)
  assert.match(await face(1).innerText(), /Snecko/)
  await page.keyboard.press('1')
  await page.keyboard.press('e')
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
    'inspection and gameplay hotkeys inside the modal must not mutate the run')
  for (const section of await dialog.locator('.die-breakdown__face').all()) {
    await section.scrollIntoViewIfNeeded()
    assert(await section.evaluate(element => {
      const box = element.getBoundingClientRect(), panel = element.closest('dialog').getBoundingClientRect()
      return box.left >= panel.left && box.right <= panel.right && element.scrollWidth <= element.clientWidth + 1
    }), 'all six face columns must fit horizontally')
  }
  assert(await dialog.evaluate(element => {
    const box = element.getBoundingClientRect(), close = element.querySelector('button').getBoundingClientRect()
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
      close.top >= box.top && close.bottom <= innerHeight
  }), 'the modal and its close button must fit the viewport')
  await dialog.locator('.die-breakdown__scroll').evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: `${output}/${screen}.png` })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert(await button.evaluate(element => element === document.activeElement), 'closing must restore die focus')
  if (phone) await button.tap()
  else await button.click()
  await dialog.waitFor()
  await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.combat.die = 6
    run.combat.players[0].relics = [{ defId: 'horn_cleat', spent: false }]
    run.combat.players[0].hand = [{ uid: 'strike', defId: 'strike_watcher', upgraded: false }]
    run.combat.enemies = [{ ...run.combat.enemies[0], defId: 'the_champ', isBoss: true }]
    window.__STS_DEBUG__.setRun(run)
  })
  await page.waitForFunction(() => document.querySelector('.die-breakdown [data-current="true"]')?.getAttribute('data-face') === '6')
  assert.equal(await dialog.getByText('Snecko Eye', { exact: true }).count(), 0, 'changed inventories must update the reference')
  assert.match(await face(6).innerText(), /No die-dependent effects/)
  const updated = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
  await dialog.getByRole('button', { name: 'Close die breakdown', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), updated)
  console.log(`PASS ${screen}: six outcomes, read-only modal, keyboard/touch, live updates and viewport fit`)
})
