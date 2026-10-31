import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { bruiserSlime } from '../src/game/downfall/slime-boss.ts'
import { pickUpCard, confirmCardPlay, dragCardTo } from './lib/card-interactions.mjs'

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
    const fixture = async ({ skill = 'defend_ironclad', doubled = 0, party = false, chamber = false, phase = 'player', scryCards, slimes, enemyCount = 1 } = {}) => {
      const run = postNeowRun(47, [{ id: 'p1', name: 'Player', character: slimes ? 'slime_boss' : chamber ? 'hermit' : 'ironclad' },
        ...party ? [{ id: 'p2', name: 'Silent', character: 'silent' }] : []])
      const room = run.map.rows[0][0]
      run.map.rooms[room].kind = 'encounter'
      const next = enterRoom(run, room)
      next.combat.phase = phase
      if (phase === 'start') {
        next.combat.die = 4
        next.combat.startTurnStage = 'effects'
      }
      next.combat.combatId = `interaction-${++nonce}`
      const actor = next.combat.players[0]
      if (slimes) actor.slimes = slimes
      next.combat.pendingHermitSetupLoads = []
      actor.energy = 9
      actor.block = 0
      actor.relics = phase === 'start'
        ? [{ defId: 'gambling_chip', spent: false }, { defId: 'loaded_die', spent: false }] : []
      actor.doubledCardsThisTurn = doubled
      actor.hand = [
        { uid: 'strike', defId: 'strike_ironclad', upgraded: false },
        { uid: 'defend', defId: skill, upgraded: party },
        { uid: 'complex', defId: 'bash', upgraded: false },
      ]
      if (scryCards !== undefined) {
        next.combat.die = 1
        actor.draw = Array.from({ length: scryCards }, (_, index) =>
          ({ uid: `scry-${index}`, defId: 'defend_ironclad', upgraded: false }))
        actor.discard = [{ uid: 'scry-discard', defId: 'defend_ironclad', upgraded: false }]
        actor.powers = [{ uid: 'nirvana', defId: 'nirvana', upgraded: false }]
      }
      next.combat.enemies = Array.from({ length: enemyCount }, (_, index) =>
        ({ ...next.combat.enemies[0], uid: index === 0 ? 'target' : `target-${index}`, hp: 30, maxHp: 30, block: 0, dead: false }))
      if (chamber) actor.chamber = [{ uid: 'chamber-defend', defId: 'hermit_defend', upgraded: false }]
      await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), next)
      await page.waitForFunction((id) => window.__STS_DEBUG__.getRun().combat?.combatId === id, next.combat.combatId)
      await page.locator('.hand .card[data-card-name="Strike"]').waitFor()
      await page.waitForFunction(() => !document.querySelector('.card-interaction') &&
        [...document.querySelectorAll('.hand .card')].every((card) =>
          card.getAnimations().every((animation) => animation.playState === 'finished')))
    }
    const snapshot = () => page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    const target = () => page.locator('[data-enemy-id="target"] .enemy__hit-area')
    const lift = async (name) => {
      const card = page.locator(`.hand .card[data-card-name="${name}"]`)
      const rect = await card.boundingBox()
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.25 }
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      return point
    }
    const settleHand = () => page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
    await fixture({ phase: 'start' })
    await page.locator('.start-turn-order').waitFor()
    assert(await page.locator('.hand .card').evaluateAll(cards => cards.every(card =>
      getComputedStyle(card).filter.includes('grayscale(0.65) brightness(0.8)'))),
    `${screen}: the unavailable start-turn hand must be partially greyed out`)
    await page.screenshot({ path: `${output}/${screen}-start-turn-disabled.png` })
    const startBefore = await snapshot()
    for (const name of ['Strike', 'Defend', 'Bash']) {
      const card = page.locator(`.hand .card[data-card-name="${name}"]`)
      assert.equal(await card.getAttribute('aria-disabled'), 'true')
      await card.hover()
      await settleHand()
      assert.match(await card.evaluate(card => getComputedStyle(card).filter), /grayscale\(0.65\).*drop-shadow/,
        'hover inspection must keep the disabled tint and hand shadow')
      const box = await card.boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4)
      await page.mouse.move(2, 2)
      await settleHand()
      assert.equal(await page.locator('.card-interaction').count(), 0, 'start-turn cards must not be picked up')
      assert.equal(await card.getAttribute('data-hand-focused'), null,
        `${name}: clicking a disabled card must not leave it stuck above the hand`)
      assert.equal(await snapshot(), startBefore, 'a disabled start-turn click changed combat')
    }
    const blockedCard = page.locator('.hand .card[data-card-name="Defend"]')
    await lift('Defend')
    await page.mouse.move(400, 100, { steps: 4 })
    await page.mouse.up()
    assert.equal(await page.locator('.card-interaction').count(), 0, 'dragging during start turn must remain disabled')
    await blockedCard.focus()
    assert.match(await blockedCard.evaluate(card => getComputedStyle(card).filter), /grayscale\(0.65\)/,
      'keyboard inspection must keep the start-turn tint')
    await page.keyboard.press('Enter')
    assert.equal(await snapshot(), startBefore, 'keyboard inspection must not play a start-turn card')
    await blockedCard.evaluate(card => card.blur())
    await blockedCard.hover()
    await settleHand()
    await page.mouse.down()
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.phase = 'player'
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => document.querySelector('.hand .card[data-card-name="Defend"]')?.getAttribute('aria-disabled') === 'false')
    assert(await page.locator('.hand .card').evaluateAll(cards => cards.every(card =>
      !getComputedStyle(card).filter.includes('grayscale'))),
    'the start-turn tint must disappear when normal card play becomes available')
    const afterPhaseChange = await snapshot()
    await page.mouse.up()
    assert.equal(await snapshot(), afterPhaseChange, 'a press that began disabled must not play on release after the phase changes')
    await pickUpCard(page, blockedCard)
    await confirmCardPlay(page)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 1)

    await fixture({ enemyCount: 2 })
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
    await page.locator('.card-interaction__arrow').waitFor()
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

    await fixture()
    const soleBefore = await snapshot()
    const soleOrigin = await lift('Strike')
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await page.locator('.card-interaction[data-target="target"]').waitFor()
    assert.equal(await page.locator('.card-interaction__arrow').count(), 0,
      'automatically targeting the sole enemy must not draw an aiming line')
    assert.equal(await page.locator('.combat__target-instruction').count(), 0)
    const followsPointer = point => page.waitForFunction(point => {
      const box = document.querySelector('.card-interaction__card')?.getBoundingClientRect()
      return box && Math.abs(box.x + box.width / 2 - point.x) < 10 &&
        Math.abs(box.y + box.height / 2 - point.y) < 10
    }, point)
    await followsPointer(empty)
    assert.equal(await snapshot(), soleBefore, 'automatic targeting must not play until release')
    await page.mouse.move(soleOrigin.x, soleOrigin.y, { steps: 5 })
    await page.mouse.up()
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await snapshot(), soleBefore, 'returning a sole-enemy attack to the hand must still cancel')
    await lift('Strike')
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await followsPointer(empty)
    await page.screenshot({ path: `${output}/${screen}-sole-enemy-auto-target.png` })
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies[0].hp === 29)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].energy), 8)

    await fixture()
    await lift('Strike')
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.enemies.push({ ...run.combat.enemies[0], uid: 'new-enemy' })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies.length === 2)
    await page.locator('.card-interaction__arrow').waitFor()
    await page.mouse.up()
    await page.locator('.card-interaction[data-stage="aiming"]').waitFor()
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getState().enemies.map(enemy => enemy.hp)), [30, 30],
      'a newly appeared enemy must restore the need to aim')
    await page.keyboard.press('Escape')
    await page.locator('.card-interaction').waitFor({ state: 'detached' })

    await fixture({ enemyCount: 2 })
    await lift('Strike')
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.enemies[0].dead = true
      run.combat.enemies[0].hp = 0
      window.__STS_DEBUG__.setRun(run)
    })
    await page.locator('.card-interaction[data-target="target-1"]').waitFor()
    assert.equal(await page.locator('.card-interaction__arrow').count(), 0)
    await followsPointer(empty)
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies[1].hp === 29)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().enemies[0].hp), 0,
      'the sole living enemy, not the defeated one, must receive the attack')
    await fixture({ enemyCount: 2 })
    await lift('Strike')
    const pointed = await target().boundingBox()
    const pointedCenter = { x: pointed.x + pointed.width / 2, y: pointed.y + pointed.height / 2 }
    await page.mouse.move(pointedCenter.x, pointedCenter.y, { steps: 5 })
    await page.locator('.card-interaction[data-target="target"] .card-interaction__arrow').waitFor()
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.enemies[1], { hp: 0, dead: true })
      window.__STS_DEBUG__.setRun(run)
    })
    await page.locator('.card-interaction__arrow').waitFor({ state: 'detached' })
    await followsPointer(pointedCenter)
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies[0].hp === 29)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    if (phone) {
      await fixture()
      const strike = page.locator('.hand .card[data-card-name="Strike"]')
      await settleHand()
      const box = await strike.boundingBox()
      const cardHeight = await strike.evaluate(card => parseFloat(getComputedStyle(card).height))
      const touch = await context.newCDPSession(page)
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart',
        touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 4, id: 1 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: box.x + box.width / 2, y: empty.y, id: 1 }] })
      await page.locator('.card-interaction[data-target="target"]').waitFor()
      assert.equal(await page.locator('.card-interaction__arrow').count(), 0)
      await followsPointer({ x: box.x + box.width / 2, y: empty.y - cardHeight * 0.4 })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction(() => window.__STS_DEBUG__.getState().enemies[0].hp === 29)
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      await touch.detach()
    }

    await fixture({ enemyCount: 2 })
    await pickUpCard(page, 'Strike')
    await confirmCardPlay(page, target())
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    await lift('Defend')
    await page.mouse.move(empty.x, empty.y, { steps: 5 })
    await page.mouse.up()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 1)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].energy), 7)
    await pickUpCard(page, 'Bash')
    await confirmCardPlay(page, target())
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.enemies[0].vulnerable === 1)

    for (const [skill, name, doubled, block, cost = 1] of [
      ['defend_ironclad', 'Defend', 0, 1],
      ['defend_ironclad', 'Defend', 1, 2],
      ['shrug_it_off', 'Shrug It Off', 0, 2],
      ['survivor', 'Survivor', 0, 2],
      ['inflame', 'Inflame', 0, 0, 2],
    ]) {
      await fixture({ skill, doubled })
      const untouched = await snapshot()
      const source = page.locator(`.hand .card[data-card-name="${name}"]`)
      await pickUpCard(page, source)
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
      await pickUpCard(page, source)
      await confirmCardPlay(page)
      if (skill === 'survivor') {
        const dialog = page.getByRole('dialog', { name: 'Discard 1 card', exact: true })
        await dialog.waitFor()
        assert.equal(await snapshot(), untouched, 'confirming pickup prematurely committed a choice-bearing skill')
        await dialog.getByRole('group', { name: 'Cards available to discard' }).locator('.card[data-card-name="Strike"]').click()
        await dialog.getByRole('button', { name: 'Confirm discard', exact: true }).click()
      }
      await page.waitForFunction(() => !window.__STS_DEBUG__.getRun().combat.players[0].hand.some((card) => card.uid === 'defend'))
      const actor = await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0])
      assert.equal(actor.energy, 9 - cost, `${name}: confirmation did not spend energy exactly once`)
      assert.equal(actor.block, block, `${name}: confirmation did not preserve the card's effects`)
      if (skill === 'shrug_it_off') {
        assert.equal(actor.draw.length, JSON.parse(untouched).combat.players[0].draw.length - 1)
        assert.equal(actor.hand.length, 3, 'Shrug It Off should draw exactly one card after confirmation')
      }
      if (skill === 'inflame') assert(actor.powers.some((card) => card.uid === 'defend'),
        'confirming a Power must put it in play rather than discard it')
      await page.waitForFunction(() => !document.querySelector('.card-interaction'))
    }

    await fixture({ skill: 'shrug_it_off' })
    await dragCardTo(page, 'Shrug It Off')
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 2)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].energy), 8,
      'drag-to-play must still confirm a complex skill exactly once')

    await fixture({ party: true })
    await pickUpCard(page, 'Defend+')
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].energy), 9)
    await confirmCardPlay(page, page.locator('.seat[data-player-id="p2"]'))
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[1].block === 2)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].block), 0,
      'support targeting must not redirect the selected ally to self')

    await fixture({ chamber: true })
    await page.getByRole('button', { name: /^Chamber,/ }).click()
    const chamberCard = page.locator('.hand .card--chamber-drawn[data-card-name="Defend"]')
    await pickUpCard(page, chamberCard)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].chamber.length), 1)
    await confirmCardPlay(page)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].chamber.length === 0)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].block), 1)

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
        const rect = await page.locator('.hand .card[data-card-name="Defend"]').boundingBox()
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.25, id: 1 }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        return point
      }
      const swipe = await startTouch()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...swipe, x: swipe.x - 100 }] })
      assert.equal(await page.locator('.card-interaction__card').count(), 0,
        'horizontal touch scrolling must not pick up a card')
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
    for (const [skill, name, block, energy] of [
      ['third_eye', 'Third Eye', 2, 8],
      ['just_lucky', 'Just Lucky', 0, 9],
      ['cut_through_fate', 'Cut Through Fate', 0, 8],
    ]) {
      await fixture({ skill, scryCards: 0 })
      await pickUpCard(page, name)
      await confirmCardPlay(page, skill === 'third_eye' ? undefined : target())
      await page.waitForFunction(() => !window.__STS_DEBUG__.getRun().combat.players[0].hand.some(card => card.uid === 'defend'))
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('dialog', { name: /^Scry / }).count(), 0,
        `${screen}/${name}: an empty Scry must not open a confirmation`)
      const after = await page.evaluate(() => window.__STS_DEBUG__.getRun().combat)
      assert.equal(after.players[0].energy, energy)
      assert.equal(after.players[0].block, block, 'an empty Scry must not trigger Nirvana')
      assert(after.players[0].discard.some(card => card.uid === 'defend'), 'the card must finish resolving')
      if (skill !== 'third_eye') assert.equal(after.enemies[0].hp, 29, 'skipping Scry must preserve the attack')
      if (skill === 'cut_through_fate') {
        assert(after.players[0].hand.some(card => card.uid === 'scry-discard'),
          'the draw after empty Scry must still reshuffle and draw')
      } else {
        assert(after.players[0].discard.some(card => card.uid === 'scry-discard'),
          'Scry alone must not reshuffle an empty draw pile')
      }
    }
    await fixture({ skill: 'warcry', scryCards: 2 })
    await pickUpCard(page, 'Warcry')
    await confirmCardPlay(page)
    const topdeck = page.getByRole('dialog', { name: 'Choose 1 for the top of your draw pile', exact: true })
    await topdeck.waitFor()
    assert(await topdeck.evaluate(dialog => {
      const backdrop = getComputedStyle(dialog, '::backdrop')
      const alpha = Number(backdrop.backgroundColor.match(/[\d.]+/g)?.at(3) ?? 1)
      const energy = document.querySelector('.pip--energy').getBoundingClientRect()
      const panel = dialog.getBoundingClientRect()
      return alpha <= 0.4 && backdrop.backdropFilter === 'none' && dialog.matches(':modal') &&
        energy.left >= 0 && energy.top >= 0 && energy.right <= innerWidth && energy.bottom <= innerHeight &&
        (energy.right <= panel.left || energy.left >= panel.right || energy.bottom <= panel.top || energy.top >= panel.bottom)
    }), `${screen}: choosing a card must leave the Energy HUD readable without making the board interactive`)
    assert.match(await page.locator('.pip--energy').innerText(), /9/)
    await page.screenshot({ path: `${output}/${screen}-choice-visible-hud.png` })
    await topdeck.locator('.card').first().click()
    await topdeck.getByRole('button', { name: 'Put selected card on top', exact: true }).click()
    await topdeck.waitFor({ state: 'detached' })

    await fixture({ skill: 'third_eye', scryCards: 1 })
    await pickUpCard(page, 'Third Eye')
    await confirmCardPlay(page)
    const scry = page.getByRole('dialog', { name: 'Scry 3', exact: true })
    await scry.waitFor()
    assert.equal(await scry.locator('.choice-modal__cards .card').count(), 1,
      'one revealed card must still allow a choice')
    await scry.getByRole('button', { name: 'Keep all', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].block === 3)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    const bruiser = bruiserSlime('command-bruiser')
    const taunting = { ...bruiserSlime('command-taunting'),
      card: { uid: 'command-taunting', defId: 'slime_boss_taunting_slime', upgraded: false } }
    for (const [slimes, enemyCount] of [[[bruiser], 1], [[taunting], 1], [[bruiser, taunting], 1], [[bruiser], 2]]) {
      await fixture({ skill: 'slime_boss_lick', slimes, enemyCount })
      await pickUpCard(page, 'Lick')
      await confirmCardPlay(page)
      const chooseBruiser = page.locator('.prompt').getByRole('button', { name: 'Bruiser Slime · level 1', exact: true })
      if (slimes.length > 1) {
        await chooseBruiser.waitFor()
        await chooseBruiser.click()
      } else {
        assert.equal(await page.locator('.prompt').getByRole('button', { name: /Slime · level 1/ }).count(), 0,
          'a sole required Slime must not need a redundant selection')
      }
      if (slimes[0].card.defId === 'slime_boss_bruiser_slime') {
        if (enemyCount > 1) {
          assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getState().enemies.map(enemy => enemy.hp)), [30, 30],
            'multiple enemies must still wait for an explicit target')
          await page.locator('[data-enemy-id="target-1"] .enemy__hit-area').click()
        }
        await page.waitForFunction(index => window.__STS_DEBUG__.getState().enemies[index].hp === 29, enemyCount - 1)
        if (enemyCount > 1) assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().enemies[0].hp), 30)
      } else {
        await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].block === 1)
      }
      await page.locator('.card-interaction').waitFor({ state: 'detached' })
      const actor = await page.evaluate(() => window.__STS_DEBUG__.getState().players[0])
      assert.equal(actor.energy, 8)
      assert.equal(actor.slimes[0].commandsThisTurn, 1)
      if (slimes.length > 1) assert.equal(actor.slimes[1].commandsThisTurn, 0)
    }
    if (!phone) {
      await fixture()
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
      await page.locator('.hand .card[data-card-name="Defend"]:visible').waitFor()
      const networkLift = async () => {
        const card = page.locator('.hand .card[data-card-name="Defend"]:visible')
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
        await pickUpCard(page, 'Shrug It Off')
        assert.equal(await page.evaluate(() => window.networkFixture.actions.length), actions,
          'picking up a modified skill submitted a network action')
        await confirmCardPlay(page)
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
