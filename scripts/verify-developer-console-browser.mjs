import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const output = 'artifacts/developer-console'
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
    let submissions = 0
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/leaderboard', route => {
      if (route.request().method() === 'POST') submissions++
      return route.fulfill({ json: { totalRuns: 0, rows: [] } })
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const fixture = postNeowRun(61, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
    const room = fixture.map.rows[0][0]
    fixture.map.rooms[room].kind = 'encounter'
    const fight = enterRoom(fixture, room)
    Object.assign(fight.combat, { phase: 'player', pendingTriggers: [], startTurnProgress: undefined })
    Object.assign(fight.combat.players[0], { relics: [], potions: [], energy: 3 })
    fight.combat.enemies = [{ ...fight.combat.enemies[0], defId: 'small_slime', uid: 'rewind-target',
      hp: 50, maxHp: 50, block: 0, dead: false }]
    fight.campaign.bossCoins = [{ act: 1, coins: 77 }]
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), fight)
    await page.locator('.combat__end-turn').focus()
    const initial = await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun()))
    await page.keyboard.press('Backquote')
    const consoleDialog = page.getByRole('dialog', { name: 'Developer console', exact: true })
    const input = consoleDialog.getByRole('textbox', { name: 'Console command', exact: true })
    await consoleDialog.waitFor()
    assert(await input.evaluate(node => node === document.activeElement))
    const execute = async command => {
      await input.fill(command)
      await input.press('Enter')
      await page.waitForFunction(() => document.querySelector('#developer-console-input')?.value === '')
    }
    await execute('help')
    assert.match(await consoleDialog.getByRole('log').innerText(), /remove_card/)
    await execute('status')
    await execute('gold nope')
    assert.match(await consoleDialog.locator('[data-error]').last().innerText(), /whole number/)
    await input.fill('__proto__ ')
    await input.fill('d m 123 ')
    await input.press('Space')
    assert.equal(await page.locator('dialog.card-collection[open]').count(), 0)
    assert.equal(await page.evaluate(() => JSON.stringify(window.__STS_DEBUG__.getRun())), initial,
      'inspection, invalid input and typing must not alter gameplay')
    await execute('clear')
    assert.equal(await consoleDialog.locator('[data-error]').count(), 0)
    await execute('gold 10')
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().consoleModified === true)
    const gold = fight.combat.players[0].gold + 10
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].gold), gold)
    await input.fill('relic VAJ')
    await input.press('Tab')
    assert.equal(await input.inputValue(), 'relic vajra')
    await input.press('Enter')
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().players[0].relics.some(relic => relic.defId === 'vajra'))
    await input.press('ArrowUp')
    assert.equal(await input.inputValue(), 'relic vajra')
    await input.press('ArrowDown')
    assert.equal(await input.inputValue(), '')
    await execute('energy 2')
    await execute('card BASH')
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].hand[0].defId), 'bash')
    await execute('help')
    assert(await consoleDialog.evaluate(dialog => {
      const box = dialog.getBoundingClientRect()
      const input = dialog.querySelector('input').getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
        input.top >= box.top && input.bottom <= box.bottom
    }), `${screen}: the console and command field must fit the viewport`)
    await page.screenshot({ path: `${output}/${screen}.png` })
    await input.press('Escape')
    await consoleDialog.waitFor({ state: 'hidden' })
    assert(await page.locator('.combat__end-turn').evaluate(node => node === document.activeElement),
      'closing the console must restore focus')
    await page.keyboard.press('Backquote')
    await consoleDialog.waitFor()
    await page.keyboard.press('Backquote')
    await consoleDialog.waitFor({ state: 'hidden' })
    await page.keyboard.press('d')
    const deck = page.locator('dialog.card-collection[open]')
    await deck.waitFor()
    await page.keyboard.press('Backquote')
    await consoleDialog.waitFor()
    await execute('help')
    await input.press('Escape')
    await consoleDialog.waitFor({ state: 'hidden' })
    assert(await deck.isVisible(), 'closing the console must preserve the underlying modal')
    await page.keyboard.press('d')
    await deck.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('sts-solo-run'))
      return saved.run.consoleModified && saved.combatStart.consoleModified
    })
    await page.reload()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.locator('.combat').waitFor()
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().consoleModified), true)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getState().players[0].gold), gold,
      'resuming must preserve console edits and the unranked marker')
    const walletBefore = await page.evaluate(async () => (await import('/src/wallet-storage.ts')).savedWallet())
    const progressBefore = await page.evaluate(() => window.__STS_DEBUG__.getRun().campaignProgress)
    await page.locator('.combat__end-turn').click()
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getState()
      return state.turn === 2 && state.phase === 'player'
    })
    const secondTurn = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STS_DEBUG__.getState())))
    await page.locator('.combat__end-turn').click()
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getState()
      return state.turn === 3 && state.phase === 'player'
    })
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.players[0].shivs = 2
      run.combat.players[0].hp = 1
      run.combat.enemies[0].hp = 1
      window.__STS_DEBUG__.setRun(run)
    })
    await page.keyboard.press('Backquote')
    await execute('gold 0')
    await page.keyboard.press('Backquote')
    await page.reload()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getState()?.turn === 3)
    assert.equal(await page.getByRole('button', { name: 'Use Shiv', exact: true }).innerText(), 'x2')
    await page.locator('.hand .card[aria-disabled="false"]').first().click()
    await page.locator('.card-interaction').waitFor()
    await page.keyboard.press('Backquote')
    await execute('rewind')
    await page.waitForFunction(() => {
      const state = window.__STS_DEBUG__.getState()
      return state.turn === 2 && state.phase === 'player'
    })
    assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.__STS_DEBUG__.getState()))), secondTurn,
      'rewind after reload must restore the prior opening, not reroll or merely change the turn number')
    assert.equal(await page.locator('.card-interaction').count(), 0, 'rewind must clear held cards and stale targeting')
    assert.equal(await page.locator('.shiv-actions button').count(), 0,
      'resources first acquired on a discarded future turn must not leave stale counters')
    await execute('rewind')
    await page.waitForFunction(() => window.__STS_DEBUG__.getState().turn === 1)
    const rewound = await page.evaluate(() => window.__STS_DEBUG__.getRun())
    assert.equal(rewound.consoleModified, true)
    assert.equal(rewound.combat.players[0].gold, fight.combat.players[0].gold)
    await execute('rewind')
    assert.match(await consoleDialog.locator('[data-error]').last().innerText(), /no previous turn/)
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun()), rewound)
    await page.keyboard.press('Backquote')
    await page.reload()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getState()?.turn === 1)
    assert.equal(await page.evaluate(() => window.__STS_DEBUG__.getRun().consoleModified), true)
    await page.keyboard.press('Backquote')
    await execute('die')
    await page.keyboard.press('Backquote')
    await page.getByRole('button', { name: 'Record campaign result', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().campaign.finalized)
    assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().campaignProgress), progressBefore)
    assert.deepEqual(await page.evaluate(async () => (await import('/src/wallet-storage.ts')).savedWallet()), walletBefore)
    assert.equal(await page.evaluate(async () => {
      const { queueFinishedSoloRun } = await import('/src/leaderboard.ts')
      return queueFinishedSoloRun(window.__STS_DEBUG__.getRun())
    }), null)
    assert.equal(submissions, 0)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: console commands, keyboard isolation, persistence and unranked results`)
  }
} finally {
  await browser.close()
  await server.close()
}
