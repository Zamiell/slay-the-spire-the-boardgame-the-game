import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { enemyDef } from '../src/game/enemies.ts'

const output = 'artifacts/enemy-card-cube'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { port: 0 } })
await server.listen()
const browser = await chromium.launch()
const errors = []
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone })
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://localhost:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const fixture = enterRoom(run, room)
    fixture.combat.enemies = [{ ...fixture.combat.enemies[0], uid: 'preview-enemy' }]
    fixture.combat.turn = 17
    fixture.combat.players[0].relics = []
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fixture)
    await page.locator('.combat').waitFor()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.enemies[0]?.uid === 'preview-enemy')
    const tip = page.locator('.card-keyword-tips[data-open]')
    const inspect = async (defId, actionIndex, ascension = 0) => {
      await page.mouse.move(2, 2)
      await page.evaluate(({ defId, actionIndex, ascension, boss }) => {
        const run = structuredClone(window.__STS_DEBUG__.getRun())
        Object.assign(run.combat.enemies[0], { defId, actionIndex, ascension, isBoss: boss, dead: false, hp: 30, maxHp: 30 })
        run.combat.turn += 1
        window.__STS_DEBUG__.setRun(run)
      }, { defId, actionIndex, ascension, boss: enemyDef(defId).isBoss === true })
      const enemy = page.locator(`[data-enemy-def="${defId}"] .enemy__hit-area`)
      await enemy.waitFor()
      if (phone) await enemy.tap()
      else await enemy.hover()
      await tip.waitFor()
      await tip.locator('img').evaluate(image => image.decode())
      assert(await tip.locator('.card-keyword-image-frame').evaluate(frame => {
        const edge = getComputedStyle(frame, '::after')
        const box = frame.getBoundingClientRect()
        const image = frame.querySelector('img').getBoundingClientRect()
        return edge.content !== 'none' && edge.borderTopStyle === 'solid' &&
          parseFloat(edge.borderTopWidth) >= 2 && edge.borderTopColor === 'rgb(232, 207, 145)' &&
          edge.pointerEvents === 'none' && edge.position === 'absolute' &&
          Math.abs(box.width - image.width) < 1 && Math.abs(box.height - image.height) < 1 &&
          box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      }), `${screen}: the card preview needs a visible frame without resizing its image or intercepting input`)
      return tip.locator('.enemy-card-cube')
    }
    await inspect('chosen_14', 0)
    await page.screenshot({ path: `${output}/${screen}-chosen-frame.png` })
    for (const index of [0, 1, 2, 0]) {
      const cube = await inspect('time_eater', index)
      assert.equal(await cube.getAttribute('data-action-index'), String(index))
      assert.match(await tip.locator('img').getAttribute('alt'), new RegExp(`Current action ${index + 1} of 3`))
      const alignment = await tip.evaluate((tip, index) => {
        const image = tip.querySelector('img')
        const face = image.getBoundingClientRect()
        const cube = tip.querySelector('.enemy-card-cube').getBoundingClientRect()
        const y = [423, 490, 557.5][index]
        return { dx: Math.abs(cube.x + cube.width / 2 - face.x - 70.5 * face.width / image.naturalWidth),
          dy: Math.abs(cube.y + cube.height / 2 - face.y - y * face.height / image.naturalHeight) }
      }, index)
      assert(alignment.dx < 1 && alignment.dy < 1, `${screen}: the cube missed its printed square ${JSON.stringify(alignment)}`)
    }
    await page.screenshot({ path: `${output}/${screen}-time-eater.png` })
    const attack = await inspect('guardian_attack', 1)
    const attackX = await attack.evaluate(cube => parseFloat(cube.style.left))
    const defense = await inspect('guardian_defensive', 0)
    assert(await defense.evaluate((cube, x) => parseFloat(cube.style.left) > x, attackX),
      'Guardian must move to the defensive-mode column')
    await page.screenshot({ path: `${output}/${screen}-guardian-defense.png` })
    await inspect('lagavulin', 0)
    const sleepY = await tip.locator('.enemy-card-cube').evaluate(cube => parseFloat(cube.style.top))
    await inspect('lagavulin', 1)
    assert(await tip.locator('.enemy-card-cube').evaluate((cube, y) => parseFloat(cube.style.top) > y, sleepY))
    await inspect('downfall_blasphemer_divinity', 0, 10)
    assert(await tip.locator('.enemy-card-cube').evaluate(cube => parseFloat(cube.style.top) > 60))
    const ordinary = await inspect('jaw_worm', 0)
    assert.equal(await ordinary.count(), 0, 'die-pattern enemies must not get an invented cube square')
    await inspect('time_eater', 1, 10)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.enemies[0], { hp: 0, dead: true })
      window.__STS_DEBUG__.setRun(run)
    })
    await tip.waitFor({ state: 'hidden' })
    await page.close()
    console.log(`PASS ${screen}: printed-square alignment, looping, boss modes, Ascension and touch`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
