import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from './lib/profile-browser.mjs'
import { createServer } from 'vite'
import { createRun } from '../src/game/run.ts'
import { createCombat } from '../src/game/combat.ts'
import { pickUpCard, confirmCardPlay } from './lib/card-interactions.mjs'

const out = 'artifacts/die-relic'
mkdirSync(out, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { port: 0 } })
const browser = await chromium.launch({ headless: true })
const errors = []
try {
  await server.listen()
  for (const [name, width, height] of [['desktop', 1440, 900], ['phone-landscape', 844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://localhost:${server.httpServer.address().port}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByRole('button', { name: 'Single Player', exact: true }).click({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Standard', exact: true }).click()
    await page.getByRole('button', { name: 'Embark' }).click()
    await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun()?.phase === 'neow')
    const viewerId = await page.evaluate(() => window.__STS_DEBUG__.getRun().players[0].id)
    const run = createRun(931, [{ id: viewerId, name: 'Ironclad', character: 'ironclad' }])
    const enemy = { uid: 'e0', defId: 'jaw_worm', row: 0, isBoss: false, hp: 30, maxHp: 30,
      block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0, goldReward: 0, cardReward: null,
      actionIndex: 0, abilityUsed: true, dead: false }
    const second = { ...enemy, uid: 'e1' }
    run.combat = createCombat({ seed: 931, calls: 0 }, run.players, [enemy, second], `die-relic-${name}`)
    Object.assign(run.combat.players[0], { hand: [], powers: [], potions: [], relics: [
      { defId: 'dollys_mirror', spent: false }, { defId: 'red_mask', spent: false },
      { defId: 'necronomicon', spent: false }, { defId: 'gremlin_horn', spent: false },
      { defId: 'pen_nib', spent: false }, { defId: 'incense_burner', spent: false },
      { defId: 'charons_ashes', spent: false },
    ] })
    Object.assign(run.combat, { phase: 'start', die: 1, startTurnStage: 'effects',
      startTurnProgress: undefined, pendingTriggers: [], presentationEvents: [] })
    run.phase = 'combat'
    run.neow = null
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    const mirror = page.locator('.relic-actions details').filter({ hasText: "Dolly's Mirror" })
    await mirror.locator('summary').click()
    const redMaskGroup = mirror.getByRole('group', { name: /Red Mask · die 5\/6/ })
    await redMaskGroup.waitFor({ state: 'visible' })
    const redMask = redMaskGroup.getByRole('button', { name: /Jaw Worm #1$/ })
    assert.deepEqual(await redMaskGroup.getByRole('button').allTextContents(), ['Jaw Worm #2', 'Jaw Worm #1'])
    assert.equal(await redMaskGroup.getByRole('button').count(), 2, `${name}: Red Mask should offer one chip per enemy`)
    assert.equal(await mirror.locator('.die-relic').count(), 7, `${name}: expected one tile per die Relic ability`)
    await redMask.scrollIntoViewIfNeeded()
    const bounds = await redMask.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width &&
      bounds.y >= 0 && bounds.y + bounds.height <= height, `${name}: the Red Mask choice is clipped`)
    const panelBox = await page.locator('.relic-actions > section').boundingBox()
    assert(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= width &&
      panelBox.y + panelBox.height <= height, `${name}: the die Relic panel runs off screen`)
    await page.screenshot({ path: `${out}/${name}-mirror-red-mask.png` })
    await redMask.click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].relics[0].spent)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.enemies[0].weak), 1,
      `${name}: selecting Red Mask did not apply Weak`)
    assert.equal(await mirror.count(), 0, `${name}: the spent Mirror still offers choices`)
    const ashesRun = structuredClone(run)
    ashesRun.combat.combatId = `ashes-order-${name}`
    ashesRun.combat.players[0].relics = [{ defId: 'charons_ashes', spent: false }]
    ashesRun.combat.players[0].hand = [{ uid: 'ashes-fuel', defId: 'defend_ironclad', upgraded: false }]
    ashesRun.combat.enemies = [
      { ...enemy, uid: 'centurion', defId: 'centurion_b3', hp: 15, maxHp: 15 },
      { ...enemy, uid: 'mystic', defId: 'mystic', hp: 10, maxHp: 10 },
      { ...enemy, uid: 'defeated', dead: true, hp: 0 },
    ]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), ashesRun)
    const ashes = page.locator('.relic-actions details').filter({ hasText: "Charon's Ashes" })
    await ashes.locator('summary').click()
    const hitButtons = ashes.getByRole('button', { name: /^Hit / })
    assert.deepEqual((await hitButtons.allTextContents()).map(text => text.trim()), ['Hit Mystic', 'Hit Centurion'])
    const stageOrder = await page.locator('.enemy:not(.enemy--dead)').evaluateAll(enemies =>
      enemies.map(enemy => ({ uid: enemy.dataset.enemyId, x: enemy.getBoundingClientRect().x }))
        .sort((left, right) => left.x - right.x).map(enemy => enemy.uid))
    assert.deepEqual(stageOrder, ['mystic', 'centurion'], `${name}: the fixture must match the visible board order`)
    await ashes.locator('.card').click()
    await page.screenshot({ path: `${out}/${name}-ashes-target-order.png` })
    await hitButtons.first().click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.enemies.find(enemy => enemy.uid === 'mystic').hp === 8)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.enemies.find(enemy => enemy.uid === 'centurion').hp), 15,
      'the left button must damage Mystic, not the first enemy in engine order')
    const loadedRun = structuredClone(run)
    loadedRun.combat.die = 6
    loadedRun.combat.players[0].relics[0] = { defId: 'loaded_die', spent: false }
    loadedRun.combat.players[0].relics.push(
      { defId: 'vajra', spent: false }, { defId: 'toolbox', spent: false },
      { defId: 'the_courier', spent: false }, { defId: 'holy_water', spent: false, cubes: 2 },
    )
    loadedRun.players[0].relics = structuredClone(loadedRun.combat.players[0].relics)
    loadedRun.players[0].gold = 1
    loadedRun.combat.players[0].gold = 1
    for (const [die, result] of [[1, 6], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5]]) {
      await page.mouse.move(2, 2)
      await page.locator('.potion-tip').filter({ hasText: 'Toolbox' }).waitFor({ state: 'hidden' })
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), {
        ...loadedRun, combat: { ...loadedRun.combat, die },
      })
      const expected = `-1 to the die result (${die} --> ${result})`
      const toolbox = page.locator('.relic-bar [data-relic="toolbox"]')
      await toolbox.hover()
      const help = toolbox.locator('.relic-tip')
      await help.waitFor()
      assert((await help.innerText()).includes(expected), `${name}: header must preview ${die} to ${result}`)
      assert((await toolbox.getAttribute('aria-label')).includes(expected))
      await page.keyboard.press('Escape')
      await page.mouse.move(2, 2)
      const action = page.getByRole('button', { name: /^Use Toolbox:/ })
      await action.hover()
      const actionHelp = page.locator('.potion-tip').filter({ hasText: 'Toolbox' })
      await actionHelp.waitFor()
      assert((await actionHelp.innerText()).includes(expected), `${name}: action tooltip must match the header`)
      assert((await action.getAttribute('aria-label')).includes(expected))
      if (die === 5) await page.screenshot({ path: `${out}/${name}-toolbox-preview.png` })
      if (die === 1 || die === 6) {
        await action.click()
        await page.waitForFunction(result => window.__STS_DEBUG__.getRun().combat.die === result, result)
        await toolbox.hover()
        await help.waitFor()
        assert((await help.innerText()).includes(`(${result} --> ${result === 1 ? 6 : result - 1})`),
          'a changed roll must immediately update the held-relic tooltip')
        assert((await help.innerText()).includes('Face down'))
      }
    }
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), { ...loadedRun, phase: 'map', combat: null })
    const outsideToolbox = page.locator('.relic-bar [data-relic="toolbox"]')
    await outsideToolbox.hover()
    await outsideToolbox.locator('.relic-tip').waitFor()
    assert((await outsideToolbox.locator('.relic-tip').innerText()).includes('(1 becomes 6)'),
      'outside combat, Toolbox must show its general rule rather than a stale roll')
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), loadedRun)
    const relicsClearOfBar = () => page.waitForFunction(() => {
      const bar = document.querySelector('.combat__bar').getBoundingClientRect()
      const actions = document.querySelector('.relic-actions > section')?.getBoundingClientRect()
      return actions && actions.height > 0 && actions.top >= bar.bottom + 4 &&
        actions.left >= 0 && actions.right <= innerWidth && actions.bottom <= innerHeight
    })
    await page.getByRole('button', { name: /^Use Loaded Die:/ }).waitFor()
    await page.locator('.courier--bar:visible, .courier--header:visible').first().waitFor()
    await relicsClearOfBar()
    const barHeight = (await page.locator('.combat__bar').boundingBox()).height
    const stackedRun = structuredClone(loadedRun)
    Object.assign(stackedRun.combat, { phase: 'player' })
    Object.assign(stackedRun.combat.players[0], { shivs: 2, miracles: 2 })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), stackedRun)
    await page.getByRole('button', { name: 'Use all Shivs', exact: true }).waitFor()
    await relicsClearOfBar()
    assert((await page.locator('.combat__bar').boundingBox()).height > barHeight,
      'the fixture must exercise a turn bar taller than its minimum height')
    await page.screenshot({ path: `${out}/${name}-relic-toolbar-clearance.png` })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), loadedRun)
    await page.getByRole('button', { name: 'Use all Shivs', exact: true }).waitFor({ state: 'detached' })
    await relicsClearOfBar()
    const barVajra = page.locator('.relic-bar [data-relic="vajra"]')
    await barVajra.hover()
    await barVajra.locator('.relic-tip').waitFor()
    const vajraRules = await barVajra.locator('.relic-tip').innerText()
    const loadedDie = page.getByRole('button', { name: /^Use Loaded Die:/ })
    const loadedIcon = loadedDie.locator('img.item-icon-image')
    await loadedIcon.evaluate(image => image.decode())
    assert.match(await loadedIcon.getAttribute('src'), /\/relic-icons\/loaded_die\.png$/)
    await loadedDie.hover()
    const loadedTip = page.locator('.potion-tip').filter({ hasText: 'Loaded Die' })
    await loadedTip.waitFor({ state: 'visible' })
    assert.match(await loadedTip.innerText(), /trigger a die relic ability on another relic/)
    await page.keyboard.press('Escape')
    await loadedDie.click()
    const loadedChoices = page.locator('.relic-actions details[open]')
    await loadedChoices.getByRole('group', { name: /Red Mask · die 5\/6/ }).waitFor()
    await relicsClearOfBar()
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].relics[0].spent), false,
      `${name}: opening Loaded Die spent it before choosing an ability`)
    const beforeInspection = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat))
    const vajra = loadedChoices.locator('.die-relic--single').filter({ hasText: 'Vajra' })
    await vajra.hover()
    const vajraTip = page.locator('.potion-tip').filter({ hasText: 'Vajra' })
    await vajraTip.waitFor()
    assert.equal(await vajraTip.innerText(), vajraRules,
      `${name}: a die-relic choice must show exactly the relic bar's tooltip`)
    assert(await vajraTip.evaluate(tip => {
      const box = tip.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }), `${name}: Vajra's tooltip is clipped by the choice panel`)
    await vajra.focus()
    await vajraTip.waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat)), beforeInspection,
      'hovering or focusing Vajra must not trigger its ability')
    await page.mouse.move(2, 2)
    await loadedChoices.getByRole('group', { name: /Red Mask · die 5\/6/ }).getByRole('img').focus()
    await page.locator('.potion-tip').filter({ hasText: 'Red Mask' }).waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun().combat)), beforeInspection,
      'reading a targeted relic must not choose an enemy')
    await vajra.hover()
    await vajraTip.waitFor()
    await page.screenshot({ path: `${out}/${name}-loaded-die-icon.png` })
    await vajra.click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.players[0].relics[0].spent)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].strength), 1,
      `${name}: the Loaded Die icon did not preserve its selected relic ability`)
    run.combat.players[0].relics[0].spent = false
    Object.assign(run.combat, { phase: 'player', die: 3 })
    run.combat.players[0].potions = ['destiny_draught']
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    await page.getByRole('button', { name: 'Use Destiny Draught' }).click()
    const destiny = page.getByRole('group', { name: /Red Mask · die 5\/6/ })
    await destiny.waitFor({ state: 'visible' })
    assert.equal(await destiny.getByRole('button').count(), 2, `${name}: Destiny Draught should offer one chip per enemy`)
    await page.screenshot({ path: `${out}/${name}-destiny-draught.png` })
    const duo = createRun(933, [{ id: viewerId, name: 'Ironclad', character: 'ironclad' },
      { id: 'p2', name: 'Hieu Le the Great', character: 'silent' }])
    duo.combat = createCombat({ seed: 933, calls: 0 }, duo.players, [enemy], `duo-${name}`)
    Object.assign(duo.combat.players[0], { hand: [], powers: [], potions: [], relics: [
      { defId: 'dollys_mirror', spent: false }, { defId: 'necronomicon', spent: false },
      { defId: 'incense_burner', spent: false },
    ] })
    Object.assign(duo.combat.players[1], { hand: [], powers: [], potions: [], relics: [
      { defId: 'necronomicon', spent: false },
    ] })
    Object.assign(duo.combat, { phase: 'start', die: 1, startTurnStage: 'effects',
      startTurnProgress: undefined, pendingTriggers: [], presentationEvents: [] })
    duo.phase = 'combat'
    duo.neow = null
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), duo)
    const duoMirror = page.locator('.relic-actions details').filter({ hasText: "Dolly's Mirror" })
    await duoMirror.locator('summary').click()
    await duoMirror.locator('.die-relic-list--shared').waitFor()
    const owners = await duoMirror.locator('.die-relic__owner').allTextContents()
    assert.deepEqual(owners.sort(), ['Hieu Le the Great', 'Ironclad', 'Ironclad'].sort(), `${name}: owner labels`)
    const nameBoxes = await duoMirror.locator('.die-relic__name').evaluateAll(nodes =>
      nodes.map(node => node.getBoundingClientRect().height))
    assert(nameBoxes.every(box => box < 40), `${name}: a Relic name collapsed beside the owner label`)
    await page.screenshot({ path: `${out}/${name}-mirror-multiplayer.png` })

    const hermit = createRun(932, [{ id: viewerId, name: 'Hermit', character: 'hermit' }])
    hermit.combat = createCombat({ seed: 932, calls: 0 }, hermit.players, [enemy, second], `cheat-${name}`)
    hermit.combat.pendingHermitSetupLoads = []
    hermit.combat.die = 3
    Object.assign(hermit.combat.players[0], { hand: [], powers: [], potions: [], energy: 3,
      chamber: [{ uid: 'cheat', defId: 'hermit_cheat', upgraded: false }],
      relics: run.combat.players[0].relics.slice(1) })
    hermit.phase = 'combat'
    hermit.neow = null
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), hermit)
    const chamber = page.getByRole('button', { name: /^Chamber,/ })
    if (await chamber.getAttribute('aria-expanded') !== 'true') await chamber.click()
    const cheat = page.locator('.hand .card--chamber-drawn')
    await pickUpCard(page, cheat)
    await confirmCardPlay(page, page.locator('.enemy:not(.enemy--dead) .enemy__hit-area').first())
    const cheatPick = page.getByRole('group', { name: /Red Mask · die 5\/6/ })
    await cheatPick.waitFor({ state: 'visible' })
    await page.screenshot({ path: `${out}/${name}-cheat.png` })
    assert.equal(await cheatPick.getByRole('button').count(), 2, `${name}: Cheat should offer one chip per enemy`)
    await cheatPick.getByRole('button', { name: /Jaw Worm #1$/ }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat.enemies[0].weak === 1)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.enemies[0].hp), 28)
    await page.screenshot({ path: `${out}/${name}-cheat-picked.png` })

    for (const [source, die] of [['loaded_die', 6], ['dollys_mirror', 1]]) {
      for (const [face, cost] of [[5, 2], [6, 0]]) {
        const next = structuredClone(run)
        next.campaign.runId = `snecko-choice-${name}-${source}-${face}`
        next.combat.combatId = `snecko-choice-${name}-${source}-${face}`
        Object.assign(next.combat, { phase: 'start', die, turn: 2, startTurnStage: 'effects',
          startTurnProgress: undefined, pendingTriggers: [], powerTriggersUsedThisTurn: [] })
        next.combat.players[0].nextCardCost = null
        next.combat.players[0].potions = ['gamblers_brew']
        next.combat.players[0].relics = [
          { defId: source, spent: false }, { defId: 'snecko_eye', spent: false },
        ]
        next.players[0].relics = structuredClone(next.combat.players[0].relics)
        await page.evaluate(run => window.__STS_DEBUG__.setRun(run), next)
        await page.locator('.card-morph').waitFor({ state: 'detached' })
        const open = source === 'loaded_die' ? page.getByRole('button', { name: /^Use Loaded Die:/ })
          : page.locator('.relic-actions details').filter({ hasText: "Dolly's Mirror" }).locator('summary')
        await open.click()
        const choices = page.locator('.relic-actions .die-relic-list').getByRole('button')
        const five = choices.filter({ hasText: 'Snecko Eye' }).filter({ hasText: 'die 5' })
        const six = choices.filter({ hasText: 'Snecko Eye' }).filter({ hasText: 'die 6' })
        await five.waitFor()
        await six.waitFor()
        assert(await five.isEnabled() && await six.isEnabled(), 'both cost faces must be selectable')
        await page.screenshot({ path: `${out}/${name}-${source}-snecko-${face}.png` })
        await (face === 5 ? five : six).click()
        await page.waitForFunction(cost => window.__STS_DEBUG__.getRun().combat.players[0].nextCardCost === cost, cost)
        assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().combat.players[0].relics[0].spent), true)
      }
    }
    run.players[0].relics = [{ defId: 'snecko_eye', spent: false }]
    run.combat.players[0].relics = run.players[0].relics
    run.combat.players[0].potions = []
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
    const snecko = page.locator('.relic-chip[data-relic="snecko_eye"]')
    await snecko.hover()
    const sneckoTip = snecko.locator('.relic-tip')
    await sneckoTip.waitFor({ state: 'visible' })
    const sneckoText = await sneckoTip.innerText()
    assert(sneckoText.includes('On a 5: your next card this turn costs 2 Energy.'),
      `${name}: Snecko Eye does not explain roll 5`)
    assert(sneckoText.includes('On a 6: your next card this turn costs 0 Energy.'),
      `${name}: Snecko Eye does not explain roll 6`)
    const sneckoBox = await sneckoTip.boundingBox()
    assert(sneckoBox && sneckoBox.x >= 0 && sneckoBox.y >= 0 &&
      sneckoBox.x + sneckoBox.width <= width && sneckoBox.y + sneckoBox.height <= height,
    `${name}: Snecko Eye's complete rules are clipped`)
    await page.screenshot({ path: `${out}/${name}-snecko-tooltip.png` })
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('✓ die relic choices resolve and Snecko Eye explains rolls 5 and 6 on desktop and horizontal phone')
} finally {
  await browser.close()
  await server.close()
}
