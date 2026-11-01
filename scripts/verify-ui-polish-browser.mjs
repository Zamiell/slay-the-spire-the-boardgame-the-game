import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import ts from 'typescript'
import { chromium } from './lib/profile-browser.mjs'
import { createRoomServer } from './room-server.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const capture = process.argv.find(argument => argument.startsWith('--capture='))?.split('=')[1]
const onlyScreen = process.argv.find(argument => argument.startsWith('--screen='))?.split('=')[1]
assert(!capture || ['before', 'after'].includes(capture), 'Capture must be before or after')
assert(!onlyScreen || ['desktop', 'horizontal-phone'].includes(onlyScreen), 'Unknown screen class')
const output = capture ? `working-report/ui-polish/${capture}` : 'artifacts/ui-polish'
const baseline = capture === 'after'
  ? JSON.parse(readFileSync('working-report/ui-polish/before/captures.json', 'utf8')) : null
const retained = entry => !baseline || baseline.some(before => before.screen === entry.screen && before.name === entry.name)
mkdirSync(output, { recursive: true })
process.env.VITE_LEADERBOARD = 'true'
const rooms = createRoomServer({ classifierEnabled: true, deckClassifier: async () => 'Ironclad Strength and Block' })
const address = await rooms.listen(0)
const api = `http://127.0.0.1:${address.port}`
const profile = { username: 'UI Review', token: '00000000-0000-4000-8000-000000000009', secured: true }
const registration = await fetch(`${api}/api/profile`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...profile, password: 'ui-review-local-fixture' }) })
assert.equal(registration.status, 200)
for (let index = 1; index <= 3; index++) {
  const response = await fetch(`${api}/api/leaderboard`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: `polish-fixture:run-${index}`, character: 'ironclad', ascension: 3, mode: 'standard',
      damageStatsComplete: true, startedAtAct: 1, highestBossActDefeated: 0, combatsFinished: 10,
      damageDealt: 140 + index * 10, damageTaken: 30, damageBlocked: 70, floorsCleared: 20 + index,
      finalDeck: [{ defId: 'inflame', upgraded: false }, { defId: 'defend_ironclad', upgraded: false }] }) })
  assert.equal(response.status, 201)
}
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: api }, '/ws': { target: api, ws: true } } } })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch()
const captures = []
const seats = [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }]
const makeRoom = kind => {
  const run = postNeowRun(47, seats)
  run.players[0].gold = 35
  run.players[0].hp = 6
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = kind
  return enterRoom(run, room)
}
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    if (onlyScreen && screen !== onlyScreen) continue
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone,
      recordVideo: { dir: output, size: viewport } })
    page.setDefaultTimeout(15_000)
    await page.addInitScript(profile => localStorage.setItem('sts-profile', JSON.stringify(profile)), profile)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const shot = async (name, control) => {
      if (!capture) {
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: join(output, `${screen}-${name}-arrival.jpg`), type: 'jpeg', quality: 82 })
      }
      await page.mouse.move(1, 1)
      await page.evaluate(() => document.activeElement?.blur())
      if (control) {
        await control.waitFor()
        if (phone) { await page.keyboard.press('Tab'); await control.focus() }
        else await control.hover()
      }
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(capture ? 600 : 100)
      const file = `${screen}-${name}.jpg`
      if (retained({ screen, name }))
        await page.screenshot({ path: join(output, file), type: 'jpeg', quality: 82 })
      captures.push({ screen, name, file, interaction: phone ? 'keyboard focus' : 'mouse hover',
        ...(!capture ? { arrivalFile: `${screen}-${name}-arrival.jpg` } : {}) })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${screen}/${name}: page overflows`)
    }
    const home = () => page.goto(origin)
    await home()
    if (capture !== 'before') {
      const start = page.getByRole('button', { name: 'Single Player', exact: true })
      const label = start.locator('.start-menu__label')
      await start.waitFor()
      const resting = await start.boundingBox()
      if (!phone) {
        await start.hover()
        await page.waitForTimeout(80)
        assert.equal(await label.evaluate(element => getComputedStyle(element).scale), '1.05')
        assert.deepEqual(await start.boundingBox(), resting, 'hover must not move the click target')
        await page.mouse.down()
        await page.waitForTimeout(220)
        assert.equal(await label.evaluate(element => getComputedStyle(element).scale), '0.95')
        await page.mouse.move(1, 1)
        await page.mouse.up()
      } else {
        const client = await page.context().newCDPSession(page)
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart',
          touchPoints: [{ x: resting.x + resting.width / 2, y: resting.y + resting.height / 2 }] })
        await page.waitForTimeout(220)
        assert.equal(await label.evaluate(element => getComputedStyle(element).scale), '0.95')
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        assert.equal(await start.getAttribute('data-ui-pressed'), null)
        const x = resting.x + resting.width / 2
        const y = resting.y + resting.height / 2
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y }] })
        assert.equal(await start.getAttribute('data-ui-pressed'), null, 'scrolling must cancel press feedback')
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        await client.detach()
      }
      assert.equal(await page.locator('.start-menu__mode-select').count(), 0, 'canceling a press must not activate it')
      await page.waitForTimeout(550)
    }
    await shot('main-menu', page.getByRole('button', { name: 'Single Player', exact: true }))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await shot('settings-video', settings.getByRole('checkbox', { name: 'High-contrast UI', exact: true }))
    if (capture !== 'before') {
      const contrast = settings.getByRole('checkbox', { name: 'High-contrast UI', exact: true })
      await contrast.focus()
      await page.keyboard.press('Space')
      assert(await contrast.isChecked(), 'Space must toggle the styled checkbox')
      assert.equal(await page.locator('html').getAttribute('data-high-contrast'), 'true')
      await page.keyboard.press('Space')
      assert(!await contrast.isChecked())
    }
    await settings.getByRole('button', { name: 'audio', exact: true }).click()
    await shot('settings-audio', settings.getByRole('slider', { name: 'Music volume', exact: true }))
    if (capture !== 'before') {
      const music = settings.getByRole('slider', { name: 'Music volume', exact: true })
      await music.focus()
      await page.keyboard.press('ArrowRight')
      assert.equal(await music.inputValue(), '25', 'native range keyboard interaction must remain intact')
      assert.equal(await music.evaluate(element => getComputedStyle(element).getPropertyValue('--volume-fill').trim()), '25%')
    }
    await settings.getByRole('button', { name: 'Back', exact: true }).click()

    for (const [name, button, root, target] of [
      ['stats', 'Stats', '.stats', '.stats__heroes button:nth-of-type(2)'],
      ['leaderboard', 'Leaderboard', '.leaderboard', '.leaderboard__heroes button:nth-of-type(2)'],
      ['profile', 'Profile', '.profile', '.profile__tabs button'],
      ['compendium', 'Compendium', '.compendium', '.compendium__pools button'],
      ['shop', 'Shop', '.shop', '.shop__tab'],
    ]) {
      await home()
      await page.getByRole('button', { name: button, exact: typeof button === 'string' }).click()
      await page.locator(root).waitFor()
      await shot(name, page.locator(target).first())
    }
    await home()
    await page.getByRole('button', { name: 'Single Player', exact: true }).click()
    await shot('run-mode', page.getByRole('button', { name: 'Standard', exact: true }))
    await page.getByRole('button', { name: 'Standard', exact: true }).click()
    await shot('character', page.getByRole('button', { name: 'Ironclad', exact: true }))
    await page.getByRole('button', { name: 'Embark', exact: true }).click()
    await shot('campaign', page.getByRole('button', { name: 'Start standard campaign', exact: true }))
    await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    await shot('neow', page.getByRole('button', { name: 'Skip', exact: true }))
    const stage = async run => {
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
      await page.waitForFunction(phase => window.__STS_DEBUG__.getRun().phase === phase, run.phase)
      await page.waitForTimeout(500)
    }
    await stage(postNeowRun(47, seats))
    await shot('map', page.locator('.game-settings__summary').first())
    const combat = makeRoom('encounter')
    Object.assign(combat.combat, { phase: 'player', startTurnProgress: undefined, pendingTriggers: [] })
    Object.assign(combat.combat.players[0], { shivs: 2, potions: ['block_potion'],
      relics: [{ defId: 'calipers', spent: false }], energy: 3,
      hand: [{ uid: 'polish-strike', defId: 'strike_ironclad', upgraded: false },
        { uid: 'polish-defend', defId: 'defend_ironclad', upgraded: false }] })
    await stage(combat)
    if (phone && capture !== 'before') {
      const before = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
      await page.getByRole('button', { name: 'Use Block Potion', exact: true }).tap()
      assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), before,
        'press feedback must not bypass potion touch confirmation')
      await page.keyboard.press('Escape')
    }
    await shot('combat', page.locator('.combat__end-turn'))
    await page.getByRole('button', { name: /^Current deck,/ }).click()
    const deck = page.getByRole('dialog', { name: 'Current deck', exact: true })
    await shot('deck', deck.getByRole('checkbox'))
    await page.keyboard.press('Escape')
    await deck.waitFor({ state: 'hidden' })
    await stage(makeRoom('merchant'))
    await page.getByRole('button', { name: 'Enter merchant shop', exact: true }).click()
    await shot('merchant', page.locator('.merchant-item:has(.merchant-tooltip)').first())
    await stage(makeRoom('campfire'))
    await shot('campfire', page.locator('.campfire__choices button').first())
    await stage(makeRoom('event'))
    await shot('event', page.locator('.event-options button:not(:disabled)').first())
    await stage(makeRoom('treasure'))
    await shot('treasure-closed', page.getByRole('button', { name: 'Open treasure chest', exact: true }))
    await page.getByRole('button', { name: 'Open treasure chest', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.treasure-stage')?.dataset.skipReady === 'true')
    await page.waitForTimeout(550)
    await shot('treasure-opened', page.locator('[data-treasure-slot]').first())
    const reward = postNeowRun(47, seats)
    Object.assign(reward, { phase: 'reward', rewardDestination: 'map',
      rewards: [{ playerId: 'p1', cardReward: true, choices: null, upgraded: false,
        gold: 8, potion: 'weak_potion', relic: 'anchor', bossRelics: false }] })
    await stage(reward)
    await shot('rewards', page.locator('.loot-choice').first())
    await page.keyboard.press('Escape')
    const pause = page.locator('.pause-menu[open]')
    await pause.waitFor()
    await shot('pause', pause.getByRole('button').first())
    if (capture !== 'before') {
      await home()
      const start = page.getByRole('button', { name: 'Single Player', exact: true })
      const checkStill = async () => {
        await page.keyboard.press('Tab')
        await start.focus()
        assert.equal(await start.locator('.start-menu__label').evaluate(element => getComputedStyle(element).scale), 'none')
        const icon = page.getByRole('button', { name: 'Settings', exact: true })
        await icon.focus()
        assert.equal(await icon.locator('img').evaluate(element => getComputedStyle(element).rotate), 'none')
        assert.notEqual(await icon.evaluate(element => getComputedStyle(element).outlineStyle), 'none',
          'reduced motion must retain visible focus')
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await checkStill()
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).check()
      await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Back', exact: true }).click()
      await checkStill()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.emulateMedia({ forcedColors: 'active' })
      const checkbox = page.getByRole('checkbox', { name: 'Reduce motion', exact: true })
      assert.equal(await checkbox.evaluate(element => getComputedStyle(element).appearance), 'auto')
      await checkbox.uncheck()
      assert(!await checkbox.isChecked(), 'forced-colors checkbox must remain operable')
    }
    assert.deepEqual(errors, [], `${screen}: uncaught browser errors`)
    console.log(`PASS ${screen}: ${captures.filter(capture => capture.screen === screen).length} UI surfaces`)
    const video = page.video()
    await page.close()
    await video.saveAs(join(output, `${screen}.webm`))
    await video.delete()
  }
  let published = captures.filter(retained)
  if (capture === 'after' && !onlyScreen) {
    assert.deepEqual(published.map(({ screen, name }) => `${screen}/${name}`),
      baseline.map(({ screen, name }) => `${screen}/${name}`), 'Before/after views must match')
    published = published.filter(entry => {
      const before = join('working-report/ui-polish/before', entry.file)
      const after = join(output, entry.file)
      if (!readFileSync(before).equals(readFileSync(after))) return true
      rmSync(before)
      rmSync(after)
      return false
    })
    writeFileSync('working-report/ui-polish/before/captures.json',
      `${JSON.stringify(baseline.filter(entry => published.some(after => after.file === entry.file)), null, 2)}\n`)
    const names = [...new Set(published.map(capture => capture.name))]
    const gallery = ['# Before / after gallery', '',
      'Desktop: 1440 x 900. Horizontal phone: 844 x 390. Click an image for full size.',
      'Desktop captures show mouse hover; phone captures show keyboard focus. Timing and actual touch presses are checked separately.',
      'Identical before/after pairs are omitted.',
      'Ambient combat animation frames can differ. These are review images, not pixel-equality goldens.', '']
    for (const name of names) {
      gallery.push(`## ${name.replaceAll('-', ' ')}`, '', '| Screen | Before | After |', '|---|---|---|')
      for (const { screen } of published.filter(entry => entry.name === name))
        gallery.push(`| ${screen} | ![Before ${name}](before/${screen}-${name}.jpg) | ![After ${name}](after/${screen}-${name}.jpg) |`)
      gallery.push('')
    }
    writeFileSync('working-report/ui-polish/gallery.md', `${gallery.join('\n').trimEnd()}\n`)
  }
  assert.equal(new Set(published.map(entry => `${entry.screen}/${entry.name}`)).size, published.length,
    'capture names must not overwrite another surface')
  writeFileSync(join(output, 'captures.json'), `${JSON.stringify(published, null, 2)}\n`)
  if (capture) {
    const files = []
    function audit(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { audit(path); continue }
        if (!path.endsWith('.tsx')) continue
        const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const controls = {}
        function visit(node) {
          if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tag = node.tagName.getText(file)
            if (['button', 'input', 'select', 'summary', 'dialog', 'textarea'].includes(tag))
              controls[tag] = (controls[tag] ?? 0) + 1
          }
          ts.forEachChild(node, visit)
        }
        visit(file)
        files.push({ path, controls })
      }
    }
    audit('src/ui')
    writeFileSync('working-report/ui-polish/inventory.json', `${JSON.stringify(files, null, 2)}\n`)
  }
} finally {
  await browser.close()
  await server.close()
  await rooms.close()
}
