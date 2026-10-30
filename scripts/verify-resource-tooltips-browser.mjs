import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { CAPS } from '../src/game/types.ts'

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
    const run = postNeowRun(47, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const next = enterRoom(run, room)
    Object.assign(next.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined })
    Object.assign(next.combat.players[0], {
      energy: 3, miracles: 2, shivs: 2, strength: 0, shivDamageBonus: 0, relics: [], powers: [], potions: [],
    })
    next.combat.enemies = [{ ...next.combat.enemies[0], uid: 'target', hp: 50, maxHp: 50, block: 0, dead: false }]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), next)
    await page.waitForFunction(id => window.__STS_DEBUG__.getRun().combat?.combatId === id, next.combat.combatId)
    const miracle = page.getByRole('button', { name: /^Use Miracle/ })
    await miracle.waitFor()
    const shiv = page.getByRole('button', { name: 'Use Shiv', exact: true })
    const allShivs = page.getByRole('button', { name: 'Use all Shivs', exact: true })
    const actor = () => page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0])
    const activate = button => phone ? button.tap() : button.click()
    const inspect = async (button, name) => {
      const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
      if (phone) {
        await page.keyboard.press('Tab')
        await button.focus()
      } else await button.hover()
      const tip = page.locator('.potion-tip').filter({ hasText: name })
      await tip.waitFor()
      assert.equal(await tip.locator('.relic-tip__name').innerText(), name)
      assert(await tip.evaluate(tip => {
        const box = tip.getBoundingClientRect()
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      }), `${screen}: resource tooltip must fit the screen`)
      assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
        `${screen}/${name}: reading a resource tooltip must not consume resources or arm an action`)
      return tip
    }
    await inspect(miracle, 'Miracles: 2')
    await activate(miracle)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].miracles === 1)
    assert.equal((await actor()).energy, 4)
    await inspect(shiv, 'Shivs: 2')
    await activate(shiv)
    assert.equal((await actor()).shivs, 2, 'arming a Shiv must still wait for its target')
    await activate(page.locator('[data-enemy-id="target"] .enemy__hit-area'))
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].shivs === 1)
    await inspect(miracle, 'Miracles: 1')
    assert.equal(await miracle.getAttribute('aria-description'), '1 Miracle available')
    await inspect(shiv, 'Shivs: 1')
    assert.equal(await shiv.getAttribute('aria-description'), '1 Shiv available')
    const allTip = await inspect(allShivs, 'Shivs: 1')
    assert.match(await allTip.innerText(), /individual attacks/)
    await activate(allShivs)
    await activate(page.locator('[data-enemy-id="target"] .enemy__hit-area'))
    await shiv.waitFor({ state: 'detached' })
    assert.equal(await allShivs.count(), 0)
    await page.evaluate(energy => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].energy = energy
      window.__STS_DEBUG__.setRun(run)
    }, CAPS.energy)
    await page.waitForFunction(energy => window.__STS_DEBUG__.getRun().combat.players[0].energy === energy, CAPS.energy)
    const cappedTip = await inspect(miracle, 'Miracles: 1')
    assert.match(await cappedTip.innerText(), /maximum Energy/)
    await activate(miracle)
    assert.equal(await miracle.getAttribute('aria-pressed'), 'true')
    assert.equal((await actor()).miracles, 1, 'at the cap, a Miracle must be staged rather than wasted')
    await activate(miracle)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].energy = 3
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].energy === 3)
    await activate(miracle)
    await miracle.waitFor({ state: 'detached' })
    assert.equal((await actor()).energy, 4)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: resource tooltips, live counts including one, and unchanged activation`)
  }
} finally {
  await browser.close()
  await server.close()
}
