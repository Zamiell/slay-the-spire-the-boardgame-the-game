import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, devices, webkit } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { dragCardTo } from './lib/card-interactions.mjs'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'artifacts/all-out-attack')
mkdirSync(out, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
try {
  for (const [engineName, engine, phone] of [
    ['chromium', chromium, false], ['webkit', webkit, true],
  ]) {
    const browser = await engine.launch()
    try {
      const context = await browser.newContext(phone ? devices['iPhone 13 landscape'] : {
        viewport: { width: 1280, height: 720 },
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(String(error)))
      await page.goto(`http://localhost:${server.httpServer.address().port}`)
      for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
        await page.getByRole('button', { name, exact: true }).click()
      }
      const run = postNeowRun(712, [{ id: 'p1', name: 'Silent', character: 'silent' }])
      const roomId = run.map.rows[0][0]
      run.map.rooms[roomId].kind = 'encounter'
      const active = enterRoom(run, roomId)
      const actor = active.combat.players[0]
      Object.assign(actor, {
        hand: [
          { uid: 'all-out', defId: 'all_out_attack', upgraded: false },
          { uid: 'discard-me', defId: 'defend_silent', upgraded: false },
        ],
        discard: [], energy: 2,
      })
      Object.assign(active.combat.enemies[0], {
        uid: 'all-out-target', row: 0, hp: 10, maxHp: 10, block: 0, dead: false, isBoss: false,
      })
      active.combat.enemies = [active.combat.enemies[0]]
      await page.evaluate((nextRun) => window.__STS_DEBUG__.setRun(nextRun), active)
      const card = page.getByRole('button', { name: /^All-Out Attack,/ })
      const target = page.locator('[data-enemy-id="all-out-target"] .enemy__hit-area')
      await card.focus()
      await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving], .hand .card--drawn'))
      await dragCardTo(page, card, target)
      const discard = page.getByRole('dialog', { name: 'Choose a card in your hand to Discard', exact: true })
      await discard.getByRole('button', { name: /^Defend,/ }).click()
      await discard.getByRole('button', { name: 'Discard 1 card', exact: true }).click()
      await page.waitForFunction(() => {
        const combat = window.__STS_DEBUG__.getRun().combat
        return combat.players[0].discard.some((card) => card.uid === 'all-out') &&
          combat.players[0].discard.some((card) => card.uid === 'discard-me') &&
          combat.enemies[0].hp === 8
      })
      await page.locator('.card-flight-effect').waitFor({ state: 'detached' })
      await page.screenshot({ path: resolve(out, `${engineName}-${phone ? 'horizontal-phone' : 'desktop'}.png`) })
      assert.deepEqual(errors, [], `${engineName}: page errors ${errors.join('\n')}`)
      await context.close()
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}
