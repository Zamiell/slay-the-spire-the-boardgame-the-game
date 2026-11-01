import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { createRun } from '../../src/game/run.ts'
import { createCombat } from '../../src/game/combat.ts'
import { createRng } from '../../src/game/rng.ts'
import { pickUpCard, confirmCardPlay } from '../lib/card-interactions.mjs'

test.use({ appKey: import.meta.url })

test('card-block-preview', async ({ page, screen, appURL, artifacts: output }) => {
  await startStandardCampaign(page, appURL)
  const run = createRun(47, [{ id: 'p1', name: 'Silent', character: 'silent' }])
  run.phase = 'combat'
  run.neow = null
  run.combat = createCombat(createRng(47), run.players, [{
    uid: 'enemy', defId: 'jaw_worm', row: 0, isBoss: false, hp: 30, maxHp: 30, block: 0,
    strength: 0, weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false, dead: false,
  }])
  Object.assign(run.combat, { phase: 'player' })
  Object.assign(run.combat.players[0], { energy: 9, block: 0, relics: [], powers: [],
    hand: ['accuracy', 'footwork', 'defend_silent', 'survivor', 'strike_silent']
      .map(defId => ({ defId, uid: defId, upgraded: false })) })
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
  const held = name => page.locator(`.hand .card[data-card-name="${name}"]`)
  await held('Accuracy').press('Enter')
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].shivDamageBonus === 1)
  assert.equal(await page.locator('.hand .card__live-block').count(), 0, 'Accuracy must not claim to boost Block')
  await held('Footwork').press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.hand .card__live-block').length === 2)
  assert.equal(await held('Defend').locator('.card__live-block').innerText(), '2\nwas 1')
  assert.equal(await held('Survivor').locator('.card__live-block').innerText(), '3\nwas 2')
  assert.equal(await held('Strike').locator('.card__live-block').count(), 0)
  assert.match(await held('Defend').getAttribute('aria-label'), /2 Block now, normally 1/)
  await held('Survivor').press('Enter')
  const discard = page.getByRole('dialog', { name: 'Discard 1 card', exact: true })
  await discard.waitFor()
  assert.equal(await discard.locator('.hand-discard__source .card__live-block').innerText(), '3\nwas 2')
  assert.equal(await discard.locator('.hand-discard__hand .card__live-block').innerText(), '2\nwas 1')
  await discard.getByRole('button', { name: 'Cancel play', exact: true }).click()
  await discard.waitFor({ state: 'detached' })
  await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.combat.players[0].nextCardCost = 0
    window.__STS_DEBUG__.setRun(run)
  })
  await held('Defend').locator('.card__live-cost').waitFor()
  await pickUpCard(page, held('Defend'))
  const preview = page.locator('.card-interaction:is([data-stage="dragging"], [data-stage="aiming"])')
  await preview.waitFor()
  assert.equal(await preview.locator('.card__live-block').innerText(), '2\nwas 1')
  assert.equal(await preview.locator('.card__live-cost').innerText(), '0\nwas 1')
  assert(await preview.evaluate(element => {
    const cost = element.querySelector('.card__live-cost').getBoundingClientRect()
    const block = element.querySelector('.card__live-block').getBoundingClientRect()
    return cost.right <= block.left && block.top >= 0 && block.right <= innerWidth && block.bottom <= innerHeight
  }), `${screen}: cost and Block overlays must remain visible and separate`)
  await page.screenshot({ path: `${output}/${screen}-modified-block.png` })
  await confirmCardPlay(page)
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].block === 2)
  await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
  await page.waitForFunction(() => document.querySelectorAll('.hand .card__live-block').length === 0)
  console.log(`PASS ${screen}: Block bonuses update scanned cards and pickup previews alongside changed costs`)
})
