import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { enterRoom } from '../src/game/run.ts'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/unload-shivs')
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch()
    try {
      for (const [screen, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }]]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1,
          ...(screen === 'horizontal-phone' ? { isMobile: true, hasTouch: true } : {}) })
        const errors = []
        page.on('pageerror', error => errors.push(String(error)))
        await page.addInitScript(() => localStorage.setItem('sts-game-settings', JSON.stringify({
          reducedMotion: true, bgmVolume: 0, sfxVolume: 0, voiceVolume: 0,
        })))
        await page.goto(`http://localhost:${server.httpServer.address().port}/?combat-webp=1`, { waitUntil: 'domcontentloaded' })
        const run = postNeowRun(47, [{ id: 'p1', name: 'UnloadTest', character: 'silent' }], 7)
        const id = run.map.rows[0][0]
        run.map.rooms[id].kind = 'encounter'
        const combat = enterRoom(run, id)
        combat.act = 2
        Object.assign(combat.combat, { phase: 'player', turn: 4, die: 5, presentationEvents: [] })
        Object.assign(combat.combat.players[0], {
          hp: 5, maxHp: 8, block: 6, strength: 1, energy: 5, shivs: 2, relics: [],
          hand: [
            { uid: 'storm', defId: 'storm_of_steel', upgraded: false },
            { uid: 'unload', defId: 'unload', upgraded: false },
            ...Array.from({ length: 4 }, (_, i) => ({ uid: `fodder-${i}`, defId: 'defend_silent', upgraded: false })),
          ],
          draw: [], discard: [], exhaust: [], powers: [], attacksPlayedThisTurn: 0,
        })
        combat.combat.enemies = ['taskmaster', 'red_slaver'].map((defId, i) => ({
          ...combat.combat.enemies[0], uid: defId, defId, row: 0, ascension: 7,
          hp: i ? 3 : 15, maxHp: i ? 10 : 15, block: 0, strength: 0,
          weak: 0, vulnerable: 0, poison: 0, abilityUsed: true, dead: false, isBoss: false,
        }))
        await page.evaluate(async run => {
          document.querySelector('#root').style.display = 'none'
          document.documentElement.dataset.reducedMotion = 'true'
          const node = document.createElement('div')
          node.className = 'app-shell app-shell--combat sts-scope'
          node.style.gridTemplateRows = 'minmax(0, 1fr)'
          document.body.append(node)
          const [R, D, { CombatScreen }] = await Promise.all([
            import('/@id/react'), import('/@id/react-dom/client'), import('/src/ui/CombatScreen.tsx'),
            import('/src/ui/styles.css'), import('/src/ui/chrome.css'),
          ])
          const view = (D.createRoot ?? D.default.createRoot)(node)
          const fixture = window.fixture = {
            state: run.combat,
            getState() { return this.state },
            setRun(run) { this.state = run.combat; this.render() },
            render() {
              view.render((R.createElement ?? R.default.createElement)(CombatScreen, {
                state: this.state, act: 2, viewerId: 'p1', autoAdvance: false,
                onChange: next => { this.state = next; this.render() },
              }))
            },
          }
          fixture.render()
        }, combat)
        await page.getByRole('button', { name: /^Storm of Steel,/ }).click()
        for (const card of await page.getByRole('button', { name: /^Defend,/ }).all()) await card.click()
        await page.getByRole('button', { name: 'Discard 4', exact: true }).click()
        await page.getByText('Choose overflow Shiv target 1/1, or skip the rest', { exact: true }).waitFor()
        await page.locator('[data-enemy-id="red_slaver"] .enemy__hit-area').click()
        await page.waitForFunction(() => window.fixture.getState().players[0].hand.length === 1)
        assert.deepEqual(await page.evaluate(() => {
          const s = window.fixture.getState()
          return [s.players[0].energy, s.players[0].shivs, ...s.enemies.map(e => e.hp)]
        }), [4, 5, 15, 1])
        await page.getByRole('button', { name: /^Unload,/ }).click()
        const target = page.locator('[data-enemy-id="taskmaster"] .enemy__hit-area')
        await target.click()
        for (let i = 1; i <= 4; i++) {
          await page.getByText(`Choose Shiv attack ${i}/5`, { exact: true }).waitFor()
          await target.click()
        }
        await page.getByText(/^Choose Shiv attack 5\/5/).waitFor()
        assert.equal(await page.locator('[data-enemy-id="taskmaster"]').isDisabled(), true,
          'Taskmaster will die before the last Shiv and must no longer accept that target')
        assert.equal(await page.locator('[data-enemy-id="red_slaver"]').isDisabled(), false)
        const prompt = page.getByText('Choose Shiv attack 5/5 — choose a surviving enemy', { exact: true })
        await prompt.waitFor()
        const promptBox = await page.locator('.prompt').boundingBox()
        const screenSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        assert(promptBox.width > 200 && promptBox.height > 15,
          'Shiv progress must be visibly readable, not clipped to an assistive-only pixel')
        assert(promptBox.x >= 0 && promptBox.y >= 0 &&
          promptBox.x + promptBox.width <= screenSize.width && promptBox.y + promptBox.height <= screenSize.height,
          'the entire Shiv progress prompt must fit inside the visible screen')
        await page.screenshot({ path: resolve(output, `${engineName}-${screen}-remaining-shiv.png`) })
        await page.locator('[data-enemy-id="red_slaver"] .enemy__hit-area').click()
        await page.waitForFunction(() => window.fixture.getState().phase === 'won',
          null, { timeout: 5000 })
        assert.deepEqual(await page.evaluate(() => {
          const s = window.fixture.getState(), p = s.players[0]
          return { phase: s.phase, energy: p.energy, shivs: p.shivs, hp: s.enemies.map(e => e.hp) }
        }), { phase: 'won', energy: 3, shivs: 0, hp: [0, 0] })
        assert.deepEqual(errors, [])
        await page.screenshot({ path: resolve(output, `${engineName}-${screen}-resolved.png`) })
        if (engineName === 'chromium' && screen === 'desktop') {
          const lastEnemy = structuredClone(combat)
          Object.assign(lastEnemy.combat.players[0], {
            hand: [{ uid: 'last-unload', defId: 'unload', upgraded: false }], energy: 4, shivs: 5,
          })
          lastEnemy.combat.enemies = [{ ...lastEnemy.combat.enemies[0], hp: 1 }]
          await page.evaluate(run => window.fixture.setRun(run), lastEnemy)
          await page.getByRole('button', { name: /^Unload,/ }).click()
          await page.locator('[data-enemy-id="taskmaster"] .enemy__hit-area').click()
          await page.waitForFunction(() => window.fixture.getState().phase === 'won',
            null, { timeout: 5000 })
          assert.deepEqual(await page.evaluate(() => {
            const s = window.fixture.getState(), p = s.players[0]
            return [s.phase, p.energy, p.shivs, p.hand.length]
          }), ['won', 3, 5, 0], 'the lethal card hit ends combat without asking for unused Shiv targets')
          const refreshed = structuredClone(combat)
          Object.assign(refreshed.combat.players[0], {
            hand: [{ uid: 'refresh-unload', defId: 'unload', upgraded: false }], energy: 4, shivs: 5,
          })
          refreshed.combat.enemies[1].hp = refreshed.combat.enemies[1].maxHp = 20
          await page.evaluate(run => window.fixture.setRun(run), refreshed)
          await page.getByRole('button', { name: /^Unload,/ }).click()
          for (let i = 0; i < 3; i++) await target.click()
          await page.getByText('Choose Shiv attack 3/5', { exact: true }).waitFor()
          await page.evaluate(() => {
            const state = structuredClone(window.fixture.getState())
            state.enemies[0].hp = 6
            window.fixture.setRun({ combat: state })
          })
          await page.getByText('Choose Shiv attack 2/5 — choose a surviving enemy', { exact: true }).waitFor()
          assert.equal(await page.locator('[data-enemy-id="taskmaster"]').isDisabled(), true)
          for (let i = 0; i < 4; i++) await page.locator('[data-enemy-id="red_slaver"] .enemy__hit-area').click()
          await page.waitForFunction(() => window.fixture.getState().players[0].hand.length === 0)
          assert.deepEqual(await page.evaluate(() => {
            const s = window.fixture.getState(), p = s.players[0]
            return [p.energy, p.shivs, p.attacksPlayedThisTurn, ...s.enemies.map(e => e.hp)]
          }), [3, 0, 6, 0, 8], 'a shared-board refresh drops only invalid staged picks and preserves legal earlier attacks')
          const completed = structuredClone(lastEnemy)
          completed.combat.enemies[0].hp = 15
          completed.combat.players[0].hand[0].uid = 'complete-refresh-unload'
          await page.evaluate(run => window.fixture.setRun(run), completed)
          await page.getByRole('button', { name: /^Unload,/ }).click()
          await target.click()
          await target.click()
          await page.getByText('Choose Shiv attack 2/5', { exact: true }).waitFor()
          await page.evaluate(() => {
            const state = structuredClone(window.fixture.getState())
            state.enemies[0].hp = 6
            window.fixture.setRun({ combat: state })
          })
          await page.waitForFunction(() => window.fixture.getState().phase === 'won',
            null, { timeout: 5000 })
          assert.deepEqual(await page.evaluate(() => {
            const s = window.fixture.getState(), p = s.players[0]
            return [p.energy, p.shivs, p.hand.length, s.enemies[0].hp]
          }), [3, 0, 0, 0], 'a refresh that makes the staged prefix lethal finishes without requiring nonexistent targets')
        }
        assert.deepEqual(errors, [])
        await page.close()
        console.log(`${engineName}/${screen}: Storm of Steel overflow followed by lethal Unload resolves`)
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
