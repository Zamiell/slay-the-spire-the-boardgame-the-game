import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createRun } from '../../src/game/run.ts'
import { createCombat } from '../../src/game/combat.ts'
import { pickUpCard, confirmCardPlay } from '../lib/card-interactions.mjs'

test.use({ appKey: import.meta.url, reducedMotion: "reduce" })

test('manual-end-turn', async ({ page, screen, phone, appURL }) => {
  const output = 'artifacts/manual-end-turn'
  mkdirSync(output, { recursive: true })
  page.setDefaultTimeout(10_000)
  await startStandardCampaign(page, appURL)
  const id = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].id)
  const card = (defId, uid = defId) => ({ defId, uid, upgraded: false })
  for (const [name, overrides] of [
    ['last-energy', { energy: 1, hand: [card('defend_ironclad'), card('bash')] }],
    ['empty-hand', {}],
    ['unusable-items', { energy: 6, miracles: 1, potions: ['liquid_memories'] }],
    ['passive-effects', { powers: [card('metallicize'), card('like_water')], stance: 'calm' }],
    ['post-roll-relic', { relics: [{ defId: 'loaded_die', spent: false }] }],
  ]) {
    const run = createRun(931, [{ id, name: 'Ironclad', character: 'ironclad' }])
    const enemy = { uid: 'target', defId: 'jaw_worm', row: 0, isBoss: false, hp: 30, maxHp: 30,
      block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0, goldReward: 0, cardReward: null,
      actionIndex: 0, abilityUsed: false, dead: false }
    run.combat = createCombat({ seed: 931, calls: 0 }, run.players, [enemy], `manual-${screen}-${name}`)
    run.phase = 'combat'
    run.neow = null
    Object.assign(run.combat, { phase: 'player', turn: 1, die: 6,
      startTurnProgress: undefined, pendingTriggers: [], presentationEvents: [] })
    Object.assign(run.combat.players[0], {
      hand: [], draw: Array.from({ length: 5 }, (_, index) => card('defend_ironclad', `draw-${index}`)),
      discard: [], exhaust: [], powers: [], relics: [], potions: [], energy: 0,
      shivs: 0, miracles: 0, soulburn: 0, vigor: 0, orbs: [null, null, null], ...overrides,
    })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    const endTurn = page.getByRole('button', { name: 'End Turn 1', exact: true })
    await endTurn.waitFor()
    if (name === 'last-energy') {
      await pickUpCard(page, 'Defend')
      await confirmCardPlay(page)
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].energy === 0)
    }
    // Wait beyond the removed 450ms idle-turn timer.
    await page.waitForTimeout(1000)
    const state = await page.evaluate(() => window.__STS_DEBUG__.getState())
    assert.equal(state.phase, 'player', `${screen}/${name}: ending the turn must require the player`)
    assert.equal(state.turn, 1)
    assert(await endTurn.isEnabled())
    if (name === 'last-energy') await page.screenshot({ path: `${output}/${screen}-zero-energy.png` })
    if (phone) await endTurn.tap()
    else await endTurn.click()
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getState()
      return state.turn === 2 && state.phase === 'player'
    })
  }
  console.log(`PASS ${screen}: exhausted actions wait for End Turn; requested turn resolution still advances`)
})
