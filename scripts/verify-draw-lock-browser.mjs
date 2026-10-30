import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'
import { pickUpCard, confirmCardPlay } from './lib/card-interactions.mjs'

const output = 'artifacts/draw-lock'
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
    const run = postNeowRun(83, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const next = enterRoom(run, room)
    next.campaign.runId = `draw-lock-${screen}`
    Object.assign(next.combat, { phase: 'player', turn: 1, pendingTriggers: [], startTurnProgress: undefined })
    const card = (defId, uid, upgraded = false) => ({ defId, uid, upgraded })
    const hand = [card('pray', 'pray', true), card('vault', 'vault'), card('tranquility', 'retain'), card('strike_watcher', 'strike')]
    const draw = [card('pray', 'second-pray', true), ...Array.from({ length: 7 }, (_, index) => card('pray', `draw-${index}`))]
    Object.assign(next.combat.players[0], {
      hp: 9, maxHp: 9, energy: 6, relics: [], potions: [],
      powers: [card('rushdown', 'rushdown')], drawLocked: false,
      hand, draw, discard: [], exhaust: [], deck: [...hand, ...draw],
    })
    next.players[0].deck = structuredClone(next.combat.players[0].deck)
    next.combat.enemies = [{ ...next.combat.enemies[0], uid: 'slime', defId: 'small_slime', hp: 50, maxHp: 50, dead: false }]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), next)
    const held = name => page.locator(`.hand .card[title="${name}"]`)
    await held('Pray+').waitFor()
    await page.locator('.card-morph').waitFor({ state: 'detached' })
    assert.equal(await page.locator('.hand .card__draw-locked-rules').count(), 0)
    await pickUpCard(page, held('Pray+'))
    await confirmCardPlay(page)
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].drawLocked)
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    await held('Pray+').waitFor()
    const vault = held('Vault')
    const rules = vault.locator('.card__draw-locked-rules')
    assert.equal(await rules.locator('line').count(), 2, 'Vault wraps its printed drawing instruction over two lines')
    assert.equal(await rules.textContent(), '', 'the overlay must not replace any printed words')
    assert.equal(await held('Pray+').locator('.card__draw-locked-rules line').count(), 1)
    assert.match(await vault.evaluate(card => document.getElementById(card.getAttribute('aria-describedby')).textContent),
      /Drawing disabled: You cannot draw more cards this turn/)
    assert.equal(await held('Strike').locator('.card__draw-locked-rules').count(), 0)
    await page.locator('.power[aria-label^="Rushdown"]').focus()
    const powerRules = page.locator('.power__zoom .card__draw-locked-rules')
    await powerRules.waitFor()
    assert.equal(await powerRules.locator('line').count(), 1)
    assert.equal(await powerRules.getAttribute('preserveAspectRatio'), 'xMidYMid meet')
    await page.keyboard.press('Escape')
    await page.locator('.power[aria-label^="Rushdown"]').evaluate(power => power.blur())
    await page.mouse.move(2, 2)
    await page.locator('.power__zoom').waitFor({ state: 'hidden' })
    if (phone) { await page.keyboard.press('Tab'); await vault.focus() }
    else await vault.hover()
    await page.waitForFunction(() => !document.querySelector('.hand[data-hand-moving]'))
    assert(await rules.evaluate(panel => {
      const box = panel.getBoundingClientRect()
      const art = panel.parentElement.querySelector('.card__art')
      return box.width > 0 && box.height > 0 && panel.tagName.toLowerCase() === 'svg' &&
        getComputedStyle(panel).backgroundColor === 'rgba(0, 0, 0, 0)' &&
        Number(getComputedStyle(panel).zIndex) > Number(getComputedStyle(art).zIndex) &&
        getComputedStyle(panel).pointerEvents === 'none'
    }), `${screen}: transparent strikes must sit above the untouched scan`)
    await page.screenshot({ path: `${output}/${screen}-vault.png` })
    const beforeInspection = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    await page.keyboard.press('d')
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    await deck.waitFor()
    assert.equal(await deck.locator('.card[title="Vault"] .card__draw-locked-rules line').count(), 2)
    await page.keyboard.press('d')
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), beforeInspection)
    await pickUpCard(page, vault)
    assert.equal(await page.locator('.card-interaction__card .card__draw-locked-rules line').count(), 2)
    const beforeVault = await page.evaluate(() => window.__STS_DEBUG__.getState().players[0])
    await confirmCardPlay(page)
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].exhaust.some(card => card.uid === 'vault'))
    const afterVault = await page.evaluate(() => window.__STS_DEBUG__.getState().players[0])
    assert.equal(afterVault.energy, beforeVault.energy, 'Vault must still gain its 3 Energy after paying 3')
    assert.equal(afterVault.draw.length, beforeVault.draw.length, 'blocked drawing must remain blocked')
    assert.deepEqual(afterVault.hand.map(card => card.uid), ['retain'], 'Retain and discard effects must still work')
    await page.locator('.card-interaction').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /^End Turn 1/ }).click()
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getState()
      return state.turn === 2 && state.phase === 'player' && !state.players[0].drawLocked
    })
    assert.equal(await page.locator('.hand .card__draw-locked-rules').count(), 0, 'next turn must restore normal scans')
    assert(await page.locator('.hand .card[title="Pray"]').count() > 0)
    const cases = await page.evaluate(async () => {
      const { cardDef } = await import('/src/game/cards.ts')
      const { blockedCardDrawRules } = await import('/src/ui/Card.tsx')
      return {
        sharedAvailable: blockedCardDrawRules(cardDef('predator'), true, false),
        sharedBlocked: blockedCardDrawRules(cardDef('predator'), true, true),
        nextTurn: blockedCardDrawRules(cardDef('machine_learning'), true),
        search: blockedCardDrawRules(cardDef('secret_technique'), true),
      }
    })
    assert.equal(cases.sharedAvailable, null, 'an unlocked teammate can still draw')
    assert.match(cases.sharedBlocked, /draw 2 cards/)
    assert.equal(cases.nextTurn, null, 'next-turn drawing must not be marked as blocked now')
    assert.equal(cases.search, null, 'searching a draw pile is not drawing')
    await page.route('**/cards-sm/defect__normal__skim.webp', route => route.abort())
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].drawLocked = true
      run.combat.players[0].hand = [{ uid: 'fallback', defId: 'skim', upgraded: false }]
      window.__STS_DEBUG__.setRun(run)
    })
    const fallback = held('Skim')
    await page.waitForFunction(() => document.querySelector('.hand .card__art')?.style.visibility === 'hidden')
    assert.equal(await fallback.locator('.card-face__rules s').innerText(), 'draw 3 cards')
    await page.unroute('**/cards-sm/defect__normal__skim.webp')
    const expectedPanels = await page.evaluate(async () => {
      const [R, D, { CARDS, faceOf }, { Card, blockedCardDrawRules }] = await Promise.all([
        import('/@id/react'), import('/@id/react-dom/client'), import('/src/game/cards.ts'), import('/src/ui/Card.tsx'),
      ])
      const cards = Object.values(CARDS).flatMap(def => [false, ...def.upgrade ? [true] : []]
        .filter(upgraded => blockedCardDrawRules(faceOf(def, upgraded), true))
        .map(upgraded => ({ uid: `${def.id}-${upgraded}`, defId: def.id, upgraded })))
      document.querySelector('#root').style.display = 'none'
      const host = document.createElement('div')
      host.className = 'draw-lock-fit'
      host.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px'
      document.body.append(host)
      const h = R.createElement ?? R.default.createElement
      ;(D.createRoot ?? D.default.createRoot)(host).render(h(R.Fragment ?? R.default.Fragment, null,
        cards.map(card => h(Card, { key: card.uid, card, drawLocked: true, playable: true, style: { '--card-width': '220px' } }))))
      return cards.length
    })
    await page.waitForFunction(count => document.querySelectorAll('.draw-lock-fit .card').length === count, expectedPanels)
    assert(expectedPanels > 50, 'exercise short and long rules across the card catalogue')
    const unmarked = await page.locator('.draw-lock-fit .card').evaluateAll(cards => cards
      .filter(card => {
        const scan = card.querySelector('.card__art')
        // Fire Breathing describes a draw trigger, not a drawing instruction.
        return scan && !scan.getAttribute('src').includes('fire-breathing') &&
          !card.querySelector('.card__draw-locked-rules line')
      }).map(card => card.getAttribute('title')))
    assert.deepEqual(unmarked, [], 'every scanned drawing instruction needs reviewed strike coordinates')
    const printedVault = page.locator('.draw-lock-fit .card[title="Vault"]')
    await printedVault.scrollIntoViewIfNeeded()
    await printedVault.locator('.card__art').evaluate(image => image.decode())
    await page.mouse.move(0, 0)
    const strikes = printedVault.locator('.card__draw-locked-rules')
    const regions = await printedVault.evaluate(card => {
      const box = card.getBoundingClientRect()
      return { width: box.width, height: box.height,
        lines: [...card.querySelectorAll('line')].map(line => {
          const r = line.getBoundingClientRect()
          return { left: r.left - box.left, right: r.right - box.left, y: r.top - box.top }
        }) }
    })
    await strikes.evaluate(svg => { svg.style.visibility = 'hidden' })
    const original = await printedVault.screenshot({ path: `${output}/${screen}-original-vault.png` })
    await strikes.evaluate(svg => { svg.style.visibility = 'visible' })
    const marked = await printedVault.screenshot({ path: `${output}/${screen}-original-vault-strikes.png` })
    const difference = await page.evaluate(async ({ original, marked, regions }) => {
      const pixels = async source => {
        const image = new Image()
        image.src = `data:image/png;base64,${source}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const before = await pixels(original), after = await pixels(marked)
      let changed = 0, outside = 0
      const outsidePoints = []
      for (let i = 0; i < before.data.length; i += 4) {
        // Repainting a fractional-sized image can slightly change interpolation
        // at the dirty rectangle's edge; this cannot hide changed lettering.
        if (before.data.slice(i, i + 4).every((value, channel) => Math.abs(value - after.data[i + channel]) <= 6)) continue
        changed++
        const x = (i / 4 % before.width) * regions.width / before.width
        const y = Math.floor(i / 4 / before.width) * regions.height / before.height
        if (!regions.lines.some(line => x >= line.left - 5 && x <= line.right + 5 && Math.abs(y - line.y) <= 5)) {
          outside++
          if (outsidePoints.length < 20) outsidePoints.push({ x, y })
        }
      }
      return { changed, outside, outsidePoints, regions }
    }, { original: original.toString('base64'), marked: marked.toString('base64'), regions })
    assert(difference.changed > 10, 'the printed instruction must visibly be crossed out')
    assert.equal(difference.outside, 0, `all pixels outside the strikethrough must remain identical: ${JSON.stringify(difference)}`)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: blocked draw text, carried cards, deck viewer, restored turn and fallback`)
  }
} finally {
  await browser.close()
  await server.close()
}
