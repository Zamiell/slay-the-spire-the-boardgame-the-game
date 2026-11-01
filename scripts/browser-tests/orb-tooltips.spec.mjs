import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url, reducedMotion: "reduce" })

test('orb-tooltips', async ({ page, screen, phone, appURL }) => {
  const output = 'artifacts/orb-tooltips'
  mkdirSync(output, { recursive: true })
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Defect', character: 'defect' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const fixture = enterRoom(run, room)
  Object.assign(fixture.combat, { phase: 'player', startTurnProgress: undefined, pendingTriggers: [] })
  Object.assign(fixture.combat.players[0], {
    orbs: ['lightning', 'frost', 'dark'], powers: [], relics: [], potions: [], block: 0, energy: 3,
    orbEndTurnBonus: 0, lightningEndTurnBonus: 0, orbEvokeBonus: 0, darkOrbEvokeBonus: 0,
    hand: [{ uid: 'dual', defId: 'dual_cast', upgraded: false }],
  })
  await page.evaluate(fixture => window.__STS_DEBUG__.setRun(fixture), fixture)
  await page.waitForFunction(id => window.__STS_DEBUG__?.getState()?.combatId === id, fixture.combat.combatId)
  await page.locator('.combat[data-phase="player"]').waitFor()
  const snapshot = () => page.evaluate(() => window.__STS_DEBUG__.getState())
  const anchor = orb => page.locator(`.orbs__help:has(.token--orb-${orb})`)
  const tipFor = name => page.locator('.potion-tip').filter({ has: page.locator('.relic-tip__name', { hasText: name }) })
  const inspect = async (orb, name) => {
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement?.blur())
    await page.waitForTimeout(180)
    const before = await snapshot()
    if (phone) await anchor(orb).tap()
    else await anchor(orb).hover()
    const tip = tipFor(name)
    await tip.waitFor()
    const text = await tip.innerText()
    assert(text.includes('Passive:') && text.includes('Evoke:'), `${name}: both effects must be explained`)
    assert(text.includes('remove'), `${name}: Evoke must explain that the Orb is removed`)
    assert(await tip.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), `${screen}/${name}: tooltip is clipped`)
    assert.deepEqual(await snapshot(), before, 'inspecting an Orb must not spend it or select a target')
    await page.screenshot({ path: `${output}/${screen}-${orb}.png` })
    return tip
  }
  let tip = await inspect('lightning', 'Lightning Orb')
  assert.match(await tip.innerText(), /Passive: Deal 1 damage to a chosen enemy/)
  assert.match(await tip.innerText(), /Evoke: Deal 2 damage to a chosen enemy/)
  await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    Object.assign(run.combat.players[0], {
      orbEndTurnBonus: 2, lightningEndTurnBonus: 1, orbEvokeBonus: 3, darkOrbEvokeBonus: 2,
      powers: [{ uid: 'focus', defId: 'defragment', upgraded: false },
        { uid: 'row-lightning', defId: 'electrodynamics', upgraded: false }],
    })
    window.__STS_DEBUG__.setRun(run)
  })
  await tip.getByText(/Passive: Deal 4 damage to each enemy in a chosen row and every boss/).waitFor()
  assert.match(await tip.innerText(), /Evoke: Deal 5 damage/)
  tip = await inspect('frost', 'Frost Orb')
  assert.match(await tip.innerText(), /Passive: Gain 3 Block/)
  assert.match(await tip.innerText(), /Evoke: Gain 4 Block/)
  tip = await inspect('dark', 'Dark Orb')
  assert.match(await tip.innerText(), /Passive: No passive effect/)
  assert.match(await tip.innerText(), /Evoke: Deal 10 damage/)
  assert.match(await tip.innerText(), /3 plus 1 for each Power/)
  await page.keyboard.press('Escape')
  await tip.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.pause-menu[open]').count(), 0, 'dismissing an Orb tooltip must not pause the game')
  await page.evaluate(fixture => window.__STS_DEBUG__.setRun(fixture), fixture)
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].orbEvokeBonus === 0)
  await page.locator('.hand .card[data-card-name="Dual Cast"]').focus()
  await page.keyboard.press('Enter')
  const frost = page.getByRole('button', { name: 'Evoke frost Orb 2', exact: true })
  await frost.waitFor()
  const beforeEvoke = await snapshot()
  await page.keyboard.press('Tab')
  await frost.focus()
  tip = page.locator('.hand-discard .card-keyword-tips').filter({ hasText: 'Frost Orb' })
  await tip.waitFor()
  assert.match(await tip.innerText(), /Passive: Gain 1 Block/)
  assert.match(await frost.getAttribute('aria-description'), /Evoke: Gain 1 Block/)
  assert.deepEqual(await snapshot(), beforeEvoke, 'focusing a selectable Orb must not Evoke it')
  if (phone) await frost.tap()
  else await page.keyboard.press(' ')
  assert.deepEqual(await snapshot(), beforeEvoke, 'selecting an Orb must wait for confirmation')
  await page.getByRole('button', { name: 'Confirm evoke', exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].block === 2)
  const after = await page.evaluate(() => window.__STS_DEBUG__.getState())
  assert.deepEqual(after.players[0].orbs, ['lightning', null, 'dark'])
  assert.equal(after.players[0].energy, 2)
  assert.equal(after.turn, fixture.combat.turn, 'Space on an Orb must not end the turn')
  assert.equal(await page.locator('.orbs__help').count(), 2, 'empty slots must not advertise Orb effects')
  console.log(`PASS ${screen}: Orb rules, live bonuses, keyboard/touch inspection and confirmed Evoke`)
})
