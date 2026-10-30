import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { canActivateRelic } from '../src/game/combat.ts'
import { createRelicInstance, RELICS } from '../src/game/relics.ts'
import { relicIconPath } from '../src/game/assets.ts'

const output = 'artifacts/relic-action-icons'
mkdirSync(output, { recursive: true })
const ids = Object.keys(RELICS)
for (const id of ids) assert(existsSync(`public${relicIconPath(id)}`), `${id}: missing relic icon`)
const manualIds = ids.filter(id => id !== 'the_courier' && (RELICS[id].activation ||
  ['charons_ashes', 'dollys_mirror', 'nilrys_codex', 'loaded_die', 'holy_water'].includes(id.replace(/^downfall_/, ''))))
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
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
          summary: control.tagName === 'SUMMARY', iconSummary: control.classList.contains('relic-action__icon') }
      }))
      for (const [at, relic] of available.entries()) {
        assert(rendered[at].label.startsWith(`Use ${RELICS[relic.defId].name}`))
        assert.equal(rendered[at].src, relicIconPath(relic.defId))
        assert(rendered[at].loaded && rendered[at].width > 0)
        assert(!rendered[at].summary || rendered[at].iconSummary, `${relic.defId}: disclosure lacks icon styling`)
      }
    }
    assert.deepEqual(manualIds.filter(id => !seen.has(id)), [], 'every activatable relic must be exercised')

    const candle = structuredClone(base)
    Object.assign(candle.combat, { phase: 'start', turn: 2, die: 3, combatId: `candle-${screen}`,
      pendingTriggers: [], startTurnStage: 'effects', startTurnProgress: undefined })
    candle.combat.players[0].relics = ['blue_candle', 'toolbox'].map(createRelicInstance)
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), candle)
    const summary = page.getByRole('button', { name: /^Use Blue Candle:/ })
    await summary.waitFor()
    const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
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
    const panel = summary.locator('..')
    assert.equal(await panel.getAttribute('open'), '', 'a single activation must still open Blue Candle choices')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
      'opening or inspecting a relic must not spend it')
    for (const count of [0, 2]) {
      for (let index = 0; index < count; index++) {
        const card = panel.locator('.campfire__deck .card').nth(index)
        if (phone) await card.tap()
        else await card.click()
      }
      assert.equal(await panel.locator('.card--selected').count(), count)
      const cancel = panel.getByRole('button', { name: 'Cancel', exact: true })
      if (phone) await cancel.tap()
      else await cancel.click()
      assert.equal(await panel.getAttribute('open'), null, 'Cancel must close the picker')
      assert(await summary.evaluate(element => element === document.activeElement), 'Cancel must restore focus')
      assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
        'cancelling must not exhaust cards or spend the relic')
      if (phone) await summary.tap()
      else await summary.click()
      assert.equal(await panel.getAttribute('open'), '')
      assert.equal(await panel.locator('.card--selected').count(), 0, 'reopening must start with no selection')
    }
    await page.screenshot({ path: `${output}/${screen}-blue-candle-cancel.png` })
    const first = panel.locator('.campfire__deck .card').first()
    if (phone) await first.tap()
    else await first.click()
    await panel.getByRole('button', { name: 'Activate', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].relics[0].spent)
    assert(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].exhaust.some(card => card.uid === 'hand-0')))
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: ${ids.length} relic icon assets, ${seen.size} manual relics, all die faces and Blue Candle activation`)
  }
} finally {
  await browser.close()
  await server.close()
}
