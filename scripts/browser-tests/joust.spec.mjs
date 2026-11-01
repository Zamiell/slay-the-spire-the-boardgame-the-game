import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'

test.use({ appKey: import.meta.url, reducedMotion: "reduce" })

test('joust', async ({ page, screen, phone, appURL, artifacts: output }) => {
  page.setDefaultTimeout(10_000)
  await startStandardCampaign(page, appURL)
  const base = await page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun()))
  const activate = locator => phone ? locator.tap() : locator.click()
  let nonce = 0
  const fixture = async (gold, items = true) => {
    await page.evaluate(async ({ base, gold, items, instanceId }) => {
      const { EVENT_DEFINITIONS } = await import('/src/game/events.ts')
      const { createEventRoom } = await import('/src/game/event-room.ts')
      const run = structuredClone(base)
      run.phase = 'room'
      run.neow = null
      Object.assign(run.players[0], {
        gold, relics: items ? [{ defId: 'anchor', spent: false }] : [],
        potions: items ? ['swift_potion'] : [],
      })
      run.rng = { ...run.rng, replayValues: Array(8).fill(0.01) }
      run.roomState = createEventRoom({ ...EVENT_DEFINITIONS.the_joust, instanceId,
        act: 2, minAscension: 0, requiresColorlessUnlock: false })
      window.__STS_DEBUG__.setRun(run)
    }, { base, gold, items, instanceId: `joust-${screen}-${nonce++}` })
    await activate(page.locator('[data-event-option="bet"]'))
    await page.getByRole('group', { name: 'Gold payment', exact: true }).waitFor()
  }
  const gold = page.getByRole('button', { name: 'Pay 2 Gold', exact: true })
  const relic = page.getByRole('group', { name: 'Your relic', exact: true }).getByRole('button')
  const potion = page.getByRole('group', { name: 'Your potions', exact: true }).getByRole('button')
  const confirm = page.getByRole('button', { name: /Confirm choice/ })
  await fixture(10)
  assert(await confirm.isDisabled(), 'having enough Gold must not silently select the Gold bet')
  assert.equal(await gold.getAttribute('aria-pressed'), 'false')
  const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
  await activate(gold)
  assert(await confirm.isEnabled())
  await activate(relic)
  assert.equal(await gold.getAttribute('aria-pressed'), 'false')
  assert.equal(await relic.getAttribute('aria-pressed'), 'true')
  await activate(potion)
  assert.equal(await relic.getAttribute('aria-pressed'), 'false')
  assert.equal(await potion.getAttribute('aria-pressed'), 'true')
  await activate(gold)
  assert.equal(await potion.getAttribute('aria-pressed'), 'false')
  await activate(gold)
  assert(await confirm.isDisabled(), 'clearing a selection must not fall back to Gold')
  assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before)
  await activate(gold)
  await activate(page.getByRole('button', { name: 'Back to choices', exact: true }))
  await activate(page.locator('[data-event-option="bet"]'))
  assert(await confirm.isDisabled(), 'returning to the bet must clear the previous payment choice')
  await page.screenshot({ path: `${output}/${screen}-explicit-payment.png` })
  for (const payment of ['gold', 'relic', 'potion']) {
    await fixture(payment === 'gold' ? 2 : 0, payment !== 'gold')
    assert(await confirm.isDisabled(), 'even the only available payment must be selected explicitly')
    if (payment !== 'gold') assert(await gold.isDisabled(), 'unaffordable Gold must not be selectable')
    await activate(payment === 'gold' ? gold : payment === 'relic' ? relic : potion)
    await activate(confirm)
    await page.waitForFunction(() => {
      const run = window.__STS_DEBUG__.getRun()
      return Boolean(run.roomState?.pendingRolls?.[run.players[0].id])
    })
    assert.equal(await page.getByRole('group', { name: /^(Gold payment|Your relic|Your potions)$/ }).count(), 0)
    assert(await confirm.isEnabled(), 'a locked payment must not require another selection after rolling')
    const paid = await page.evaluate(() => structuredClone(window.__STS_DEBUG__.getRun().players[0]))
    assert.equal(paid.gold, 0)
    assert.equal(paid.relics.length, payment === 'potion' ? 1 : 0)
    assert.equal(paid.potions.length, payment === 'relic' ? 1 : 0)
    await activate(confirm)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    const resolved = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0])
    assert.equal(resolved.gold, 0, 'resolving a losing roll must not charge again')
    assert.deepEqual(resolved.relics, paid.relics)
    assert.deepEqual(resolved.potions, paid.potions)
  }
  console.log(`PASS ${screen}: explicit exclusive Joust payments, clearing, affordability and locked-roll continuation`)
})
