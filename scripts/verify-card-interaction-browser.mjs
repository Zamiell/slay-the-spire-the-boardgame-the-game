import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/card-interaction'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    let nonce = 0
    const fixture = async ({ skill = 'defend_ironclad', doubled = 0 } = {}) => {
      const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
      const room = run.map.rows[0][0]
      run.map.rooms[room].kind = 'encounter'
      const next = enterRoom(run, room)
      next.combat.combatId = `interaction-${++nonce}`
      const actor = next.combat.players[0]
      actor.energy = 9
      actor.block = 0
      actor.relics = []
      actor.doubledCardsThisTurn = doubled
      actor.hand = [
        { uid: 'strike', defId: 'strike_ironclad', upgraded: false },
        { uid: 'defend', defId: skill, upgraded: false },
        { uid: 'complex', defId: 'bash', upgraded: false },
      ]
      next.combat.enemies = [
        { ...next.combat.enemies[0], uid: 'target', hp: 30, maxHp: 30, block: 0, dead: false },
      ]
      await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), next)
      await page.waitForFunction((id) => window.__STS_DEBUG__.getRun().combat?.combatId === id, next.combat.combatId)
      await page.locator('.hand .card[title="Strike"]').waitFor()
      await page.waitForFunction(() => !document.querySelector('.card-interaction') &&
        [...document.querySelectorAll('.hand .card')].every((card) =>
          card.getAnimations().every((animation) => animation.playState === 'finished')))
    }
    const snapshot = () => page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const target = () => page.locator('[data-enemy-id="target"] .enemy__hit-area')
    const lift = async (name) => {
      const card = page.locator(`.hand .card[title="${name}"]`)
      const rect = await card.boundingBox()
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.25 }
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      return point
    }
    await fixture()
    const before = await snapshot()
    const origin = await lift('Strike')
    await page.locator('.card-interaction__card').waitFor()
    await page.mouse.move(origin.x + 120, origin.y - 30, { steps: 4 })
    await page.waitForFunction((x) => {
      const box = document.querySelector('.card-interaction__card')?.getBoundingClientRect()
      return box && Math.abs(box.x + box.width / 2 - x) < 10
    }, origin.x + 120)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await snapshot(), before, 'cancelling pickup changed combat')

    await lift('Strike')
    const empty = await page.evaluate(() => ({ x: innerWidth * 0.45, y: innerHeight * 0.25 }))
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await page.mouse.up()
    await page.locator('.card-interaction[data-stage="aiming"]').waitFor()
    assert.equal(await snapshot(), before, 'releasing without a target played the attack')
    await page.evaluate(() => { window.interactionCard = document.querySelector('.card-interaction__card') })
    const hit = await target().boundingBox()
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2, { steps: 5 })
    await page.locator('.card-interaction[data-target="target"]').waitFor()
    await page.screenshot({ path: `${output}/${screen}-aiming.png` })
    await page.mouse.down()
    await page.mouse.up()
    await page.locator('.card-interaction[data-stage="resolving"]').waitFor()
    assert(await page.evaluate(() => document.querySelector('.card-interaction__card') === window.interactionCard),
      'the played card was replaced instead of continuing its motion')
    assert.equal(await page.locator('.card-flight').count(), 0, 'legacy and continuous flights both played')
    await page.waitForFunction(() => !window.__STS_DEBUG__.getRun().combat.players[0].hand.some((card) => card.uid === 'strike'))
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.enemies[0].hp), 29)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })

    await lift('Defend')
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 1)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].energy), 7)
    await page.locator('.hand .card[title="Bash"]').click()
    assert.equal(await page.locator('.card-interaction').count(), 0, 'complex cards entered the new adapter')
    await target().click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.enemies[0].vulnerable === 1)

    for (const [skill, name, doubled, block] of [
      ['defend_ironclad', 'Defend', 0, 1],
      ['defend_ironclad', 'Defend', 1, 2],
      ['shrug_it_off', 'Shrug It Off', 0, 2],
      ['survivor', 'Survivor', 0, 2],
    ]) {
      await fixture({ skill, doubled })
      const untouched = await snapshot()
      const source = page.locator(`.hand .card[title="${name}"]`)
      await source.click()
      await page.locator('.card-interaction__card').waitFor()
      // A late native click must not leak through to the legacy immediate-play handler.
      await source.evaluate((card) => card.click())
      await page.mouse.move(empty.x, empty.y, { steps: 4 })
      await page.waitForFunction((point) => {
        const box = document.querySelector('.card-interaction__card')?.getBoundingClientRect()
        return box && Math.abs(box.x + box.width / 2 - point.x) < 10
      }, empty)
      assert.equal(await snapshot(), untouched, `${name}: pickup spent energy, revealed cards, or applied effects`)
      assert.equal(await page.getByRole('dialog', { name: 'Discard 1 card', exact: true }).count(), 0)
      await page.mouse.click(empty.x, empty.y, { button: 'right' })
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      assert.equal(await snapshot(), untouched, `${name}: cancelling pickup changed combat`)
      await source.click()
      await page.mouse.click(empty.x, empty.y)
      if (skill === 'survivor') {
        const dialog = page.getByRole('dialog', { name: 'Discard 1 card', exact: true })
        await dialog.waitFor()
        assert.equal(await snapshot(), untouched, 'confirming pickup prematurely committed a choice-bearing skill')
        await dialog.getByRole('group', { name: 'Cards available to discard' }).locator('.card[title="Strike"]').click()
        await dialog.getByRole('button', { name: 'Confirm discard', exact: true }).click()
      }
      await page.waitForFunction(() => !window.__STS_DEBUG__.getRun().combat.players[0].hand.some((card) => card.uid === 'defend'))
      const actor = await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0])
      assert.equal(actor.energy, 8, `${name}: confirmation did not spend energy exactly once`)
      assert.equal(actor.block, block, `${name}: confirmation did not preserve the card's effects`)
      if (skill === 'shrug_it_off') {
        assert.equal(actor.draw.length, JSON.parse(untouched).combat.players[0].draw.length - 1)
        assert.equal(actor.hand.length, 3, 'Shrug It Off should draw exactly one card after confirmation')
      }
      await page.waitForFunction(() => !document.querySelector('.card-interaction'))
    }

    await fixture({ skill: 'shrug_it_off' })
    await lift('Shrug It Off')
    await page.mouse.move(empty.x, empty.y, { steps: 4 })
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 2)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].energy), 8,
      'drag-to-play must still confirm a complex skill exactly once')

    await fixture()
    const fresh = await snapshot()
    await lift('Strike')
    await page.mouse.move(empty.x, empty.y, { steps: 4 })
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await page.mouse.up()
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await snapshot(), fresh, 'right-click cancellation changed combat')
    await lift('Defend')
    await page.mouse.move(empty.x, empty.y, { steps: 3 })
    const cancelPoint = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight * 0.98 }))
    await page.mouse.move(cancelPoint.x, cancelPoint.y, { steps: 3 })
    await page.mouse.up()
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await snapshot(), fresh, 'dragging back into the hand played the card')
    if (phone) {
      const touch = await context.newCDPSession(page)
      const startTouch = async () => {
        const rect = await page.locator('.hand .card[title="Defend"]').boundingBox()
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.25, id: 1 }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        return point
      }
      const swipe = await startTouch()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...swipe, x: swipe.x - 100 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      assert.equal(await snapshot(), fresh, 'horizontal touch scrolling played a card')
      await startTouch()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...empty, id: 1 }] })
      await page.locator('.card-interaction__card').waitFor()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      assert.equal(await snapshot(), fresh, 'pointer cancellation played a card')
      await startTouch()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...empty, id: 1 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 1)
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      await fixture()
    }

    // A visual flight must not lock input or get replaced by the next played card.
    await lift('Strike')
    const enemyBox = await target().boundingBox()
    await page.mouse.move(enemyBox.x + enemyBox.width / 2, enemyBox.y + enemyBox.height / 2)
    await page.mouse.up()
    await page.locator('.card-interaction[data-stage="resolving"]').waitFor()
    await page.evaluate(() => { window.previousFlight = document.querySelector('.card-interaction__card') })
    await lift('Defend')
    assert(await page.evaluate(() => window.previousFlight.isConnected), 'new pickup discarded an in-flight card')
    await page.mouse.move(empty.x, empty.y)
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].hand.length === 1)
    await page.waitForFunction(() => !document.querySelector('.card-interaction'))
    await fixture()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await lift('Defend')
    await page.mouse.move(empty.x, empty.y)
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 1)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    if (!phone) {
      await page.evaluate(async () => {
        const state = structuredClone(window.__STS_DEBUG__.getRun().combat)
        state.combatId = 'interaction-network'
        state.players[0].energy = 3
        state.players[0].block = 0
        state.players[0].hand = [{ uid: 'network-defend', defId: 'defend_ironclad', upgraded: false }]
        const [React, ReactDom, ReactDomCore, { CombatScreen }, { playCard }] = await Promise.all([
          import('/@id/react'), import('/@id/react-dom/client'), import('/@id/react-dom'), import('/src/ui/CombatScreen.tsx'),
          import('/src/game/combat.ts'),
        ])
        document.querySelector('#root').style.display = 'none'
        const host = document.createElement('main')
        host.className = 'app-shell app-shell--combat sts-scope'
        host.style.gridTemplateRows = 'minmax(0, 1fr)'
        document.body.append(host)
        const createElement = React.createElement ?? React.default.createElement
        const flushSync = ReactDomCore.flushSync ?? ReactDomCore.default.flushSync
        const root = (ReactDom.createRoot ?? ReactDom.default.createRoot)(host)
        const fixture = window.networkFixture = { state, actions: [], connected: true, restoration: 0 }
        fixture.render = () => flushSync(() => root.render(createElement(CombatScreen, {
          state: fixture.state, act: 1, viewerId: 'p1', autoAdvance: false, animateOpeningHand: false,
          authoritativeConnected: fixture.connected, authoritativeRestoration: fixture.restoration,
          onAction: (action) => new Promise((resolve) => {
            fixture.actions.push(action)
            fixture.reply = (accepted) => {
              if (accepted) {
                fixture.state = playCard(fixture.state, 'p1', action.cardUid, action)
                fixture.render()
              }
              resolve({ status: accepted ? 'accepted' : 'refused' })
            }
          }),
        })))
        fixture.render()
      })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const serverBefore = await page.evaluate(() => JSON.stringify(window.networkFixture.state))
      await page.locator('.hand .card[title="Defend"]:visible').waitFor()
      const networkLift = async () => {
        const card = page.locator('.hand .card[title="Defend"]:visible')
        const rect = await card.boundingBox()
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 4)
        await page.mouse.down()
        await page.mouse.move(empty.x, empty.y, { steps: 4 })
      }
      await networkLift()
      await page.evaluate(() => {
        window.networkFixture.connected = false
        window.networkFixture.render()
      })
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      await page.mouse.up()
      assert.equal(await page.evaluate(() => window.networkFixture.actions.length), 0,
        'disconnecting during a drag allowed its release to submit')
      await page.evaluate(() => {
        window.networkFixture.connected = true
        window.networkFixture.restoration++
        window.networkFixture.render()
      })
      await networkLift()
      await page.mouse.up()
      await page.locator('.card-interaction[data-stage="submitted"]').waitFor()
      await page.waitForTimeout(200)
      assert.equal(await page.evaluate(() => JSON.stringify(window.networkFixture.state)), serverBefore,
        'waiting for a server reply spent the card optimistically')
      await page.evaluate(() => window.networkFixture.reply(false))
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => JSON.stringify(window.networkFixture.state)), serverBefore)
      await networkLift()
      await page.mouse.up()
      await page.locator('.card-interaction[data-stage="submitted"]').waitFor()
      await page.evaluate(() => window.networkFixture.reply(true))
      await page.locator('.card-interaction[data-stage="resolving"]').waitFor()
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => window.networkFixture.state.players[0].block), 1)
      assert.equal(await page.evaluate(() => window.networkFixture.actions.length), 2)
      await page.evaluate(() => {
        const fixture = window.networkFixture
        fixture.state = structuredClone(fixture.state)
        Object.assign(fixture.state.players[0], {
          block: 0, energy: 3, doubledCardsThisTurn: 0,
          hand: [{ uid: 'modified-skill', defId: 'shrug_it_off', upgraded: false }],
        })
        fixture.render()
      })
      const modifiedBefore = await page.evaluate(() => JSON.stringify(window.networkFixture.state))
      for (const accepted of [false, true]) {
        const actions = await page.evaluate(() => window.networkFixture.actions.length)
        await page.locator('.hand .card[title="Shrug It Off"]:visible').click()
        await page.locator('.card-interaction__card').waitFor()
        assert.equal(await page.evaluate(() => window.networkFixture.actions.length), actions,
          'picking up a modified skill submitted a network action')
        await page.mouse.click(empty.x, empty.y)
        await page.waitForFunction((count) => window.networkFixture.actions.length === count, actions + 1)
        assert.equal(await page.evaluate(() => JSON.stringify(window.networkFixture.state)), modifiedBefore)
        await page.evaluate((accepted) => window.networkFixture.reply(accepted), accepted)
        await page.waitForFunction(() => !document.querySelector('.card-interaction'))
        if (!accepted) {
          assert.equal(await page.evaluate(() => JSON.stringify(window.networkFixture.state)), modifiedBefore)
        }
      }
      await page.waitForFunction(() => window.networkFixture.state.players[0].block === 2)
      assert.equal(await page.evaluate(() => window.networkFixture.state.players[0].energy), 2)
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${screen}: pickup, aim, click targeting, continuous flight, skill play, cancellation and legacy choices`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
