import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { CAPS } from '../src/game/types.ts'

const output = 'artifacts/resource-tooltips'
mkdirSync(output, { recursive: true })
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
      energy: 3, miracles: 3, shivs: 2, strength: 0, shivDamageBonus: 0, relics: [], powers: [], potions: [],
    })
    next.combat.enemies = [{ ...next.combat.enemies[0], uid: 'target', hp: 50, maxHp: 50, block: 0, dead: false }]
    const starting = structuredClone(next)
    Object.assign(starting.combat, { phase: 'start', turn: 1, die: 6, startTurnStage: 'effects' })
    Object.assign(starting.combat.players[0], {
      miracles: 2, shivs: 1,
      relics: ['pure_water', 'loaded_die', 'vajra'].map(defId => ({ defId, spent: false })),
      powers: [{ uid: 'start-shiv', defId: 'infinite_blades', upgraded: false }],
    })
    const unseen = structuredClone(next)
    Object.assign(unseen.combat.players[0], { miracles: 0, shivs: 0, vigor: 0, soulburn: 0, clawCubesGainedThisCombat: 0 })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), unseen)
    await page.waitForFunction(id => window.__STS_DEBUG__.getRun().combat?.combatId === id, unseen.combat.combatId)
    await page.locator('.combat').waitFor()
    assert.equal(await page.getByRole('button', { name: /^Use Miracle/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Use Shiv', exact: true }).count(), 0)
    assert.equal(await page.locator('.combat__claw-cubes').count(), 0)
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), starting)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'start')
    const miracle = page.getByRole('button', { name: /^Use Miracle/ })
    await miracle.waitFor()
    const shiv = page.getByRole('button', { name: 'Use Shiv', exact: true })
    const allShivs = page.getByRole('button', { name: 'Use all Shivs', exact: true })
    await page.locator('.start-turn-order').waitFor()
    assert.equal(await miracle.innerText(), 'x2', 'start-turn inventory must show held Miracles, not pending gains')
    assert.equal(await shiv.innerText(), 'x1', 'start-turn inventory must show held Shivs, not pending gains')
    await page.screenshot({ path: `${output}/${screen}-start.png` })
    const beforeStart = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat))
    const visibleViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.equal(await allShivs.count(), 0, 'start-turn inventory needs only one counter per resource')
    for (const button of [miracle, shiv]) {
      assert(await button.isDisabled(), 'resources must be unavailable during start-turn ordering')
      assert.equal(await button.evaluate(button => getComputedStyle(button).filter), 'saturate(0.45) brightness(0.8)')
      const box = await button.boundingBox()
      assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= visibleViewport.width &&
        box.y + box.height <= visibleViewport.height, `${screen}: disabled resource counter is clipped: ${JSON.stringify(box)}`)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat)), beforeStart,
      'clicking disabled resources must not spend them or resolve start-of-turn effects')
    await miracle.locator('..').focus()
    await page.locator('.potion-tip').filter({ hasText: 'Miracles: 2' }).waitFor()
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.players[0], { miracles: 0, shivs: 0 })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.combat-resource button[aria-label^="Use Miracle"]')
      ?.textContent === 'x0')
    assert.equal(await shiv.innerText(), 'x0', 'empty start-turn counters should remain visible')
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), starting)
    await page.getByRole('button', { name: 'Resolve start of turn 1', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.phase === 'player')
    for (const button of [miracle, shiv, allShivs]) assert(await button.isEnabled())
    assert.equal(await miracle.innerText(), 'x3')
    assert.equal(await shiv.innerText(), 'x2')
    assert.equal(await allShivs.innerText(), 'All x2')
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
    assert.equal(await miracle.innerText(), 'x3', 'the action icon must display the held Miracle count')
    assert(await miracle.evaluate(button => {
      const box = button.getBoundingClientRect()
      const count = button.querySelector('span').getBoundingClientRect()
      return count.width > 0 && count.left >= box.left && count.right <= box.right &&
        count.top >= box.top && count.bottom <= box.bottom && box.right <= innerWidth
    }), `${screen}: the visible Miracle count must fit inside the button`)
    await activate(miracle)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].miracles === 2)
    assert.equal(await miracle.innerText(), 'x2')
    await inspect(shiv, 'Shivs: 2')
    await inspect(miracle, 'Miracles: 2')
    await activate(miracle)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].miracles === 1)
    assert.equal((await actor()).energy, 5)
    assert.equal(await miracle.innerText(), 'x1')
    await inspect(shiv, 'Shivs: 2')
    await activate(shiv)
    assert.equal((await actor()).shivs, 2, 'arming a Shiv must still wait for its target')
    await activate(page.locator('[data-enemy-id="target"] .enemy__hit-area'))
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].shivs === 1)
    await inspect(miracle, 'Miracles: 1')
    assert.equal(await miracle.getAttribute('aria-description'), '1 Miracle available')
    await inspect(shiv, 'Shivs: 1')
    assert.equal(await shiv.innerText(), 'x1')
    assert.equal(await allShivs.innerText(), 'All x1')
    assert.equal(await shiv.getAttribute('aria-description'), '1 Shiv available')
    const allTip = await inspect(allShivs, 'Shivs: 1')
    assert.match(await allTip.innerText(), /individual attacks/)
    await activate(allShivs)
    await activate(page.locator('[data-enemy-id="target"] .enemy__hit-area'))
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].shivs === 0)
    assert.equal(await shiv.innerText(), 'x0')
    assert(await shiv.isDisabled())
    assert.equal(await allShivs.innerText(), 'All x0')
    assert(await allShivs.isDisabled())
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
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].miracles === 0)
    assert.equal(await miracle.innerText(), 'x0')
    assert(await miracle.isDisabled())
    assert.equal((await actor()).energy, 4)
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.players[0], {
        character: 'guardian', guardianMode: 'attack', vigor: 3, soulburn: 3,
        clawCubesGainedThisCombat: 3, potions: ['energy_potion', 'energy_potion'],
      })
      window.__STS_DEBUG__.setRun(run)
    })
    const vigor = page.getByRole('button', { name: /^Spend 1 Vigor,/ })
    const soulburn = page.getByRole('button', { name: /^Spend Soulburn,/ })
    const potion = page.getByRole('button', { name: /^Use Energy Potion/ })
    await vigor.waitFor()
    assert.equal(await vigor.innerText(), 'x3')
    assert.equal(await soulburn.innerText(), 'x3')
    assert.equal(await page.locator('.combat__claw-cubes strong').innerText(), 'x3')
    assert.equal(await potion.innerText(), 'x2', 'grouped potion actions must expose their quantity')
    await activate(vigor)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].vigor === 2)
    assert.equal(await vigor.innerText(), 'x2')
    await potion.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].potions.length === 1)
    assert.equal(await potion.innerText(), 'x1')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.phase = 'start'
      run.combat.turn++
      run.combat.startTurnProgress = undefined
      Object.assign(run.combat.players[0], {
        vigor: 0, soulburn: 0, clawCubesGainedThisCombat: 0, powers: [],
        relics: [{ defId: 'gambling_chip', spent: false }],
      })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.phase === 'start')
    for (const button of [miracle, shiv, vigor, soulburn]) {
      assert.equal(await button.innerText(), 'x0', 'acquired resources must remain visible through later phases')
      assert(await button.isDisabled())
    }
    assert.equal(await page.locator('.combat__claw-cubes strong').innerText(), 'x0')
    unseen.combat.combatId = `unseen-next-fight-${screen}`
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), unseen)
    await page.waitForFunction(id => window.__STS_DEBUG__.getRun().combat?.combatId === id, unseen.combat.combatId)
    for (const button of [miracle, shiv, vigor, soulburn]) {
      assert.equal(await button.count(), 0, 'a new fight must reset resource visibility')
    }
    assert.equal(await page.locator('.combat__claw-cubes').count(), 0)
    const statuses = structuredClone(next)
    statuses.combat.combatId = `status-help-${screen}`
    Object.assign(statuses.combat.players[0], {
      block: 3, strength: 2, vigorSpentThisTurn: 1, vulnerable: 2, weak: 1,
      shivs: 2, miracles: 1, clawCubesGainedThisCombat: 2,
    })
    Object.assign(statuses.combat.enemies[0], { block: 2, poison: 3 })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), statuses)
    await page.waitForFunction(id => window.__STS_DEBUG__.getRun().combat?.combatId === id, statuses.combat.combatId)
    const statusStrip = page.locator('.row--viewer .seat__status-strip')
    const beforeHelp = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    for (const [key, name, rule] of [
      ['block', 'Block: 3', /Prevents 1 damage per Block/],
      ['strength', 'Strength: 2', /Adds 1 damage to every hit/],
      ['vigorSpent', 'Vigor active this turn: 1', /Each spent Vigor.*Attack Mode.*Defense Mode/],
      ['vulnerable', 'Vulnerable: 2', /doubled.*removes 1 Vulnerable/],
      ['weak', 'Weak: 1', /−1 damage.*removes 1 Weak/],
      ['shivs', 'Shivs: 2', /separate hit.*not cards/],
      ['miracles', 'Miracles: 1', /gain 1 Energy/],
      ['clawCubes', 'Claw cubes: 2', /Each cube adds 1 damage.*not spent/],
    ]) {
      const token = statusStrip.locator(`.token--${key}`)
      await token.scrollIntoViewIfNeeded()
      assert.equal(await token.evaluate(el => Boolean(el.closest('[aria-hidden="true"]'))), false)
      assert((await token.getAttribute('aria-label')).includes(name))
      if (phone) await token.tap()
      else await token.hover()
      const tip = page.locator('.potion-tip').filter({ hasText: name })
      await tip.waitFor()
      assert.match(await tip.locator('.relic-tip__text').innerText(), rule)
      assert(await tip.evaluate(el => {
        const box = el.getBoundingClientRect()
        return el.parentElement === document.body && box.left >= 0 && box.top >= 0 &&
          box.right <= innerWidth && box.bottom <= innerHeight
      }), `${screen}/${name}: status help must escape the clipped strip and fit the viewport`)
    }
    await page.keyboard.press('Tab')
    await statusStrip.locator('.token--block').focus()
    const blockTip = page.locator('.potion-tip').filter({ hasText: 'Block: 3' })
    await blockTip.waitFor()
    const tipImage = await blockTip.screenshot({ path: `${output}/${screen}-status-tooltip.png` })
    const corners = await blockTip.evaluate(async (tip, png) => {
      const image = new Image()
      image.src = `data:image/png;base64,${png}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const style = getComputedStyle(tip)
      context.fillStyle = style.getPropertyValue('--trim-dim')
      context.fillRect(0, 0, 1, 1)
      const expected = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      const box = tip.getBoundingClientRect()
      const inset = parseFloat(style.getPropertyValue('--chamfer')) / 2 + 1
      return [[false, false], [true, false], [false, true], [true, true]].map(([right, bottom]) => {
        const x = Math.floor((right ? box.width - inset : inset) * image.width / box.width)
        const y = Math.floor((bottom ? box.height - inset : inset) * image.height / box.height)
        const pixels = context.getImageData(x - 1, y - 1, 3, 3).data
        for (let i = 0; i < pixels.length; i += 4) {
          if (expected.every((channel, index) => Math.abs(pixels[i + index] - channel) <= 15)) return true
        }
        return false
      })
    }, tipImage.toString('base64'))
    assert(corners.every(Boolean), `${screen}: the tooltip trim must follow all four cut corners: ${JSON.stringify(corners)}`)
    await page.screenshot({ path: `${output}/${screen}-status-help.png` })
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeHelp,
      'hovering, focusing, or tapping status help must not change the run')
    await page.keyboard.press('Escape')
    await page.locator('.potion-tip').waitFor({ state: 'hidden' })
    const enemyTokens = page.locator('[data-enemy-id="target"] .tokens')
    assert.equal(await enemyTokens.getAttribute('aria-hidden'), 'true')
    assert.equal(await enemyTokens.locator('[tabindex]').count(), 0,
      'decorative enemy tokens must not introduce nested focusable controls')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: resource tooltips, live counts including one, and unchanged activation`)
  }
} finally {
  await browser.close()
  await server.close()
}
