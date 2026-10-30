import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, devices } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { pickUpCard, confirmCardPlay } from './lib/card-interactions.mjs'

// Double Tap queues a Headbutt copy. When the first Headbutt takes the only
// discarded card, the copy sees an empty discard pile and must still ask for its target.
const root = resolve(import.meta.dirname, '..')
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
const card = (defId, i) => ({ uid: `live-${i}`, defId, upgraded: false })
const browser = await chromium.launch()

try {
  for (const [screen, options] of [['desktop', { viewport: { width: 1440, height: 900 } }],
    ['horizontal-phone', devices['iPhone 13 landscape']]]) {
    const context = await browser.newContext(options)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`http://localhost:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    const id = run.map.rows[0][0]
    run.map.rooms[id].kind = 'encounter'
    const combat = enterRoom(run, id)
    const player = combat.combat.players[0]
    player.energy = 3
    player.hand = ['double_tap', 'headbutt', 'strike_ironclad'].map(card)
    player.discard = []
    combat.combat.enemies = [{
      ...combat.combat.enemies[0], uid: 'target', defId: 'jaw_worm', row: 0, hp: 60, maxHp: 60, block: 0,
      dead: false, isBoss: false, vulnerable: 0, weak: 0,
    }]
    await page.evaluate((state) => window.__STS_DEBUG__.setRun(state), combat)
    await page.locator('.hand .card').first().waitFor()
    await page.waitForTimeout(1200)

    const hp = () => page.locator('[data-enemy-def="jaw_worm"]').getAttribute('aria-label')
      .then((label) => Number(label.match(/(\d+) of 60/)[1]))
    const handCard = (name) => page.locator(`.hand .card[aria-label^="${name}"]`)
    await pickUpCard(page, handCard('Double Tap'))
    await confirmCardPlay(page)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    await pickUpCard(page, handCard('Headbutt'))
    await confirmCardPlay(page, page.locator('[data-enemy-def="jaw_worm"] .enemy__hit-area'))
    // The first Headbutt recovers the only card in the discard pile: Double Tap.
    await page.locator('dialog[open] .card').click()
    await page.getByRole('button', { name: 'Put selected card on top', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.hand .card').length === 1)
    // The copy now has an empty discard pile; it must go straight to targeting.
    assert.match(await page.locator('.prompt').first().innerText(), /Choose an enemy/, `${screen}: copy asks for a target`)
    await page.locator('[data-enemy-def="jaw_worm"] .enemy__hit-area').click()
    await page.waitForFunction(() => document.querySelector('[data-enemy-def="jaw_worm"]')?.getAttribute('aria-label')?.includes('56 of 60'),
      undefined, { timeout: 5000 })
    assert.equal(await hp(), 56, `${screen}: both Headbutts hit`)
    assert.deepEqual(errors, [], `${screen}: page errors`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
