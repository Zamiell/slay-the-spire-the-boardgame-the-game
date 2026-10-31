#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { assert, check, report, suite } from './lib/harness.mjs'
import { ENEMIES, enemyAbilities } from '../src/game/enemies.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'artifacts/enemy-effects-browser')
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
const address = server.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('Vite did not report a port')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))

async function readHelp(defId) {
  const card = page.locator(`[data-enemy-def="${defId}"]`)
  await card.locator('.enemy__hit-area').hover()
  const help = page.locator('.card-keyword-tips[data-open]')
  await help.waitFor()
  return {
    label: await card.getAttribute('aria-label'),
    help: await help.innerText(),
    bounds: await help.boundingBox(),
  }
}

try {
  suite('enemy effects browser')
  await page.goto(`http://localhost:${address.port}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Single Player', exact: true }).click()
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('button', { name: 'Embark' }).click()
  await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'neow')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    debug.reset(1, 'enemy-effects')
    const run = structuredClone(debug.getRun())
    debug.setRun({ ...run, phase: 'map', neow: null })
  })
  await page.locator('.room--reachable').first().click()
  await page.locator('.combat').waitFor()
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    const enemy = run.combat.enemies[0]
    run.combat.phase = 'player'
    run.combat.enemies = [
      { ...enemy, uid: 'time', defId: 'time_eater', isBoss: true, hp: 60, maxHp: 60,
        actionIndex: 1, abilityUsed: false, abilityCubes: undefined, dead: false },
      { ...enemy, uid: 'heart', defId: 'corrupt_heart', isBoss: true, hp: 100, maxHp: 100,
        actionIndex: 0, abilityUsed: false, abilityCubes: 2, dead: false },
      { ...enemy, uid: 'spiker', defId: 'spiker_add', isBoss: false, row: 0, hp: 10, maxHp: 10,
        actionIndex: 0, abilityUsed: false, abilityCubes: 3, dead: false },
    ]
    debug.setRun(run)
  })
  await page.locator('[data-enemy-id="spiker"]').waitFor()
  const fixture = await page.evaluate(() => window.__STS_DEBUG__.getRun())
  const flyingIds = Object.values(ENEMIES).filter(def => enemyAbilities(def).some(ability => ability.kind === 'flying'))
    .map(def => def.id)
  assert(flyingIds.length > 0, 'the Flying fixture must exercise real enemy abilities')

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'horizontal-phone', width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
    await page.locator('[data-enemy-id="spiker"]').waitFor()
    assert(await page.locator('.enemy__flying').count() === 0, 'grounded enemies must not show Flying')
    const time = await readHelp('time_eater')
    await page.screenshot({ path: join(output, `${viewport.name}-time-warp.png`) })
    const heart = await readHelp('corrupt_heart')
    const thorns = await readHelp('spiker_add')
    check(`${viewport.name} shows concrete enemy effect consequences`, () => {
      assert(time.label?.includes('each player can play at most 4 cards this turn'))
      assert(time.help.includes('each player can play at most 4 cards this turn'))
      assert(heart.label?.includes('every player takes 2 damage'))
      assert(heart.help.includes('every player takes 2 damage'))
      assert(thorns.label?.includes('the attacking player takes 3 damage'))
      assert(thorns.help.includes('the attacking player takes 3 damage'))
      for (const result of [time, heart, thorns]) assert(result.bounds &&
        result.bounds.x >= 0 && result.bounds.y >= 0 &&
        result.bounds.x + result.bounds.width <= viewport.width &&
        result.bounds.y + result.bounds.height <= viewport.height,
      `effect help is clipped at ${viewport.name}: ${JSON.stringify(result.bounds)}`)
    })
    for (const [index, id] of flyingIds.entries()) {
      await page.mouse.move(0, 0)
      const combatId = `flying-${viewport.name}-${id}`
      await page.evaluate(({ fixture, id, combatId }) => {
        const run = structuredClone(fixture)
        const template = run.combat.enemies[0]
        Object.assign(run.combat, { combatId, phase: 'player', startTurnProgress: undefined,
          pendingTriggers: [], presentationEvents: [] })
        Object.assign(run.combat.players[0], { relics: [], powers: [], energy: 3,
          hand: [{ uid: 'flying-test', defId: 'bludgeon', upgraded: false }] })
        run.combat.enemies = [
          { ...template, uid: 'byrd', defId: id, isBoss: false, hp: 10, maxHp: 10,
            block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0, dead: false, row: 0 },
          { ...template, uid: 'grounded', defId: 'jaw_worm', isBoss: false, hp: 10, maxHp: 10, dead: false, row: 0 },
        ]
        window.__STS_DEBUG__.setRun(run)
      }, { fixture, id, combatId })
      await page.waitForFunction(id => window.__STS_DEBUG__.getState()?.combatId === id, combatId)
      const badge = page.locator(`[data-enemy-def="${id}"] .enemy__flying`)
      await badge.waitFor()
      assert(await badge.innerText() === 'Flying', `${id}: Flying must be visible without inspecting the enemy`)
      assert(await page.locator('[data-enemy-id="grounded"] .enemy__flying').count() === 0)
      assert(await badge.evaluate(element => {
        const badge = element.getBoundingClientRect()
        const enemy = element.closest('.enemy').getBoundingClientRect()
        const hp = element.closest('.enemy').querySelector('.bar').getBoundingClientRect()
        return badge.width > 0 && badge.height > 0 && badge.left >= enemy.left - 1 &&
          badge.right <= enemy.right + 1 && badge.top >= hp.bottom - 1 && badge.bottom <= innerHeight
      }), `${viewport.name}/${id}: Flying must fit beside status tokens without covering HP`)
      if (index === 0) await page.screenshot({ path: join(output, `${viewport.name}-flying.png`) })
      const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getState()))
      await badge.hover()
      const help = page.locator('.card-keyword-tips[data-open]')
      await help.waitFor()
      assert((await help.innerText()).includes('takes at most 1 damage from each Hit'))
      assert(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getState())) === before,
        'reading Flying must not mutate combat')
      if (index === 0) await page.screenshot({ path: join(output, `${viewport.name}-flying-help.png`) })
    }
    await page.locator('.hand .card[data-card-name="Bludgeon"]').focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-enemy-id="byrd"] .enemy__flying').click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies[0].hp === 9)
    assert(await page.evaluate(() => window.__STS_DEBUG__.getState().enemies[1].hp) === 10,
      'clicking the Flying badge must still target its own enemy')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.enemies[0], { hp: 0, dead: true })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.locator('.enemy__flying').waitFor({ state: 'detached' })
    const defeated = await page.evaluate(() => window.__STS_DEBUG__.getState().enemies[0].dead)
    const remainingBadges = await page.locator('.enemy__flying').count()
    check(`${viewport.name} shows Flying for every base and Downfall variant and clears it on defeat`, () => {
      assert(defeated && remainingBadges === 0, 'defeated enemies must not retain an active Flying badge')
    })
  }
  assert(pageErrors.length === 0, `browser errors: ${pageErrors.join('\n')}`)
} finally {
  await browser.close()
  await server.close()
}

report('enemy effects browser')
