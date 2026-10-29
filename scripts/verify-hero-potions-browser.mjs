import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { CHARACTER_IDS } from '../src/game/types.ts'
import { enterRoom } from '../src/game/run.ts'

// Potions live in the header, never above heroes. Defect's Orbs still follow the painted head.
const root = resolve(import.meta.dirname, '..')
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
try {
  // Chromium can measure the alpha bounds of both image and video hero art.
  for (const [engineName, engine] of Object.entries({ chromium })) {
    const browser = await engine.launch()
    try {
      for (const [screen, viewport, reducedMotion] of [['desktop', { width: 1440, height: 900 }, 'no-preference'],
        ['horizontal-phone', { width: 844, height: 390 }, 'no-preference'], ['desktop-reduced-motion', { width: 1440, height: 900 }, 'reduce']]) {
        const phone = screen === 'horizontal-phone'
        const page = await (await browser.newContext({ viewport, reducedMotion, isMobile: phone, hasTouch: phone })).newPage()
        const errors = []
        page.on('pageerror', (error) => errors.push(String(error)))
        await page.goto(`http://localhost:${server.httpServer.address().port}`)
        for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
          await page.getByRole('button', { name, exact: true }).click()
        const assertHead = async (where) => {
          const m = await page.evaluate(() => {
            const seat = document.querySelector('.seat__interactive')
            const image = seat.querySelector('.seat__portrait > :is(img, video):not([style*="display: none"])')
            const canvas = document.createElement('canvas')
            canvas.width = image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth
            canvas.height = image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight
            const context = canvas.getContext('2d')
            context.drawImage(image, 0, 0)
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
            let top = canvas.height
            for (let y = 0; y < canvas.height && top === canvas.height; y++)
              for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 96) { top = y; break }
            const box = image.getBoundingClientRect()
            const fit = Math.min(box.width / canvas.width, box.height / canvas.height)
            const orbs = [...seat.querySelectorAll('.orbs > *')].map((orb) => orb.getBoundingClientRect())
            return { headTop: box.bottom - (canvas.height - top) * fit,
              orbsBottom: orbs.length ? Math.max(...orbs.map((orb) => orb.bottom)) : null,
              orbsTop: orbs.length ? Math.min(...orbs.map((orb) => orb.top)) : null, boardTop: document.querySelector('.board').getBoundingClientRect().top }
          }).catch((error) => { throw new Error(`${where}: ${error.message}`) })
          if (m.orbsBottom !== null) {
            assert(m.orbsBottom <= m.headTop + 8, `${where}: Orbs cover the painted head ${JSON.stringify(m)}`)
            assert(m.orbsTop >= m.boardTop, `${where}: Orbs clipped by the board ${JSON.stringify(m)}`)
          }
        }
        const check = async (label, setup) => {
          const where = `${engineName}/${screen}/${label}`
          const [character, orbCount, heat, guardianMode] = setup
          const run = postNeowRun(47, [{ id: 'p1', name: 'Hero', character }])
          const id = run.map.rows[0][0]
          run.map.rooms[id].kind = 'encounter'
          const combat = enterRoom(run, id)
          const player = combat.combat.players[0]
          player.potions = ['fire_potion', 'block_potion']
          if (orbCount) player.orbs = Array.from({ length: orbCount }, (_, i) => ['lightning', 'frost', 'dark'][i % 3])
          if (heat !== undefined) player.heat = heat
          if (guardianMode) player.guardianMode = guardianMode
          await page.evaluate((state) => window.__STS_DEBUG__.setRun(state), combat)
          await page.locator('.seat__interactive').waitFor()
          assert.equal(await page.locator('.seat__potions').count(), 0, `${where}: potions still float above the hero`)
          assert.equal(await page.locator('.app-shell__header .outside-potions .item-icon-image').count(), 2,
            `${where}: held potions disappeared from the header`)
          const art = page.locator('.seat__interactive .seat__portrait > :is(img, video):not([style*="display: none"])').first()
          await art.waitFor()
          await page.waitForFunction((media) => media instanceof HTMLVideoElement
            ? media.readyState >= 2 : media.complete && media.naturalWidth > 0, await art.elementHandle())
          await page.waitForTimeout(900)
          await assertHead(where)
          if (guardianMode && screen !== 'desktop-reduced-motion') {
            // The mode shift shows taller transition art for a moment.
            const shifted = structuredClone(combat)
            shifted.combat.players[0].guardianMode = guardianMode === 'attack' ? 'defense' : 'attack'
            await page.evaluate((state) => window.__STS_DEBUG__.setRun(state), shifted)
            const transition = page.locator('.seat__portrait > [data-guardian-transition]')
            await transition.waitFor()
            await transition.evaluate((image) => image.decode())
            await assertHead(`${where} mode shift`)
          }
        }
        for (const character of CHARACTER_IDS) {
          if (character === 'defect') for (const orbs of [3, 6, 10]) await check(`defect with ${orbs} Orbs`, [character, orbs])
          else if (character === 'hexaghost') for (const heat of [0, 3, 6]) await check(`hexaghost heat ${heat}`, [character, 0, heat])
          else if (character === 'guardian') for (const mode of ['attack', 'defense']) await check(`guardian ${mode}`, [character, 0, undefined, mode])
          else await check(character, [character])
        }
        assert.deepEqual(errors, [])
        await page.close()
        console.log(`${engineName}/${screen}: potions stay in the header and Orbs stay above every hero's head`)
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
