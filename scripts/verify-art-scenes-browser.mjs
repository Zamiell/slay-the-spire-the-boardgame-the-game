// Focused campfire coverage: the one camp painting covers the screen and every party sits on its logs (CampfireScene),
// each hero's seated sprite on its side of the fire, facing it, at desktop and horizontal-phone sizes.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { characterOfSkin, isSkinId } from '../src/game/skins.ts'
import { SEATING } from '../src/ui/campfire-seats.ts'
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/art-scenes')
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }],
    ['horizontal-phone-compact', { width: 667, height: 375 }]]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`http://localhost:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
      await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('heading', { name: 'Neow’s Blessing' }).waitFor()
    await page.waitForFunction(() => window.__STS_DEBUG__)
    // A party seats its visual ids in party order: a worn skin replaces its hero's sprite.
    for (const characters of [['ironclad'], ['guardian'], ['slime_boss'], ['slime_boss', 'guardian', 'hexaghost', 'hermit'], ['ironclad', 'silent', 'defect', 'watcher'], ['guardian', 'hexaghost', 'hermit'],
      ['kratos'], ['monogatari_silent'], ['monogatari_watcher'], ['silent', 'defect', 'kratos'], ['ironclad', 'monogatari_silent'],
      ['kratos', 'monogatari_silent', 'monogatari_watcher'], ['defect', 'kratos', 'monogatari_silent', 'monogatari_watcher'],
      ['monogatari_silent', 'guardian', 'hermit'], ['ironclad', 'defect', 'monogatari_silent', 'monogatari_watcher'],
      ['monogatari_ironclad', 'monogatari_silent', 'monogatari_defect', 'monogatari_watcher'],
      ['monogatari_silent', 'monogatari_defect'], ['monogatari_ironclad', 'monogatari_watcher'],
      ['guardian', 'hermit', 'monogatari_ironclad', 'monogatari_watcher'],
      ['guardian', 'monogatari_defect'], ['guardian', 'hexaghost', 'monogatari_ironclad']]) {
      const run = postNeowRun(47, characters.map((visual, i) => ({ id: `p${i+1}`, name: visual,
        character: isSkinId(visual) ? characterOfSkin(visual) : visual, ...(isSkinId(visual) ? { skin: visual } : {}) })))
      if (name.startsWith('horizontal-phone')) {
        run.players[0].name = 'ABCDEFGHIJKLMNOPQRSTUVWX'
        if (characters.length === 4) run.campaignProgress.actIV = 5
      }
      const roomId = run.map.rows[0][0]
      run.phase = 'room'; run.map.position = roomId; run.map.rooms[roomId].kind = 'campfire'
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
      await page.getByRole('heading', { name: /Campfire/ }).waitFor().catch(async error => { await page.screenshot({ path: resolve(output, 'failure.png') }); throw error })
      // Wait for this party's sprites, not the previous party's of the same size.
      await page.waitForFunction((party) => {
        const sitters = [...document.querySelectorAll('.campfire__sitter')]
        return sitters.map((sitter) => sitter.dataset.visual).join() === party.join()
          && sitters.every((sitter) => sitter.complete && sitter.naturalWidth > 0)
      }, characters)
      const { campfire, painting, sitters } = await page.locator('.campfire').evaluate((node) => {
        const box = (element) => {
          const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
          return { left, top, right, bottom, width, height }
        }
        const camp = node.querySelector('.campfire__camp')
        return {
          campfire: box(node),
          painting: { ...box(camp), size: [camp.naturalWidth, camp.naturalHeight] },
          sitters: [...node.querySelectorAll('.campfire__sitter')].map((sitter) => ({
            visual: sitter.dataset.visual, scale: getComputedStyle(sitter).scale,
            size: [sitter.naturalWidth, sitter.naturalHeight], local: new URL(sitter.currentSrc).origin === location.origin, path: new URL(sitter.currentSrc).pathname, ...box(sitter),
          })),
        }
      })
      const tag = `${name} ${characters.join('+')}`
      assert.deepEqual(painting.size, [3840, 2161], `${tag}: camp painting`)
      // background-size: cover: the painting fills the scene, keeps its aspect ratio and is cropped on one axis only.
      assert(painting.left <= campfire.left + 0.5 && painting.right >= campfire.right - 0.5 &&
        painting.top <= campfire.top + 0.5 && painting.bottom >= campfire.bottom - 0.5, `${tag}: painting covers the scene`)
      assert(Math.abs(painting.width / painting.height - 3840 / 2161) < 0.01, `${tag}: painting aspect ratio`)
      assert(Math.abs(painting.width - campfire.width) < 1 || Math.abs(painting.height - campfire.height) < 1, `${tag}: cover crops one axis`)
      assert.deepEqual(sitters.map((sitter) => sitter.visual), characters, `${tag}: party order`)
      SEATING[characters.length].forEach((seat, index) => {
        const sitter = sitters[index]
        const left = seat.facing === 'right'
        assert(sitter.local, `${tag}: ${sitter.visual} sprite is a local asset`)
        assert(sitter.path.endsWith(`/noncombat/campfire/sitters/${characters[index]}.webp`), `${tag}: ${characters[index]} loads ${sitter.path}`)
        assert.deepEqual(sitter.size, [1408, 1808], `${tag}: ${sitter.visual} sprite canvas`)
        assert.equal(sitter.scale, left ? 'none' : '-1 1', `${tag}: ${sitter.visual} mirroring to face the fire`)
        // The sprite's hips (704, 848 of its 1408x1808 canvas) land on the seat's spot on the log, within 0.5%.
        const hipX = (sitter.left + sitter.width / 2 - painting.left) / painting.width * 100
        const hipY = (sitter.top + sitter.height * 848 / 1808 - painting.top) / painting.height * 100
        assert(Math.abs(hipX - seat.x) < 0.5 && Math.abs(hipY - seat.y) < 0.5,
          `${tag}: ${sitter.visual} hips at (${hipX.toFixed(2)}%, ${hipY.toFixed(2)}%), seat at (${seat.x.toFixed(2)}%, ${seat.y.toFixed(2)}%)`)
        const centre = sitter.left + sitter.width / 2
        assert(sitter.top + sitter.height * 848 / 1808 < campfire.bottom && centre > campfire.left && centre < campfire.right,
          `${tag}: ${sitter.visual} is on screen`)
      })
      if (name.startsWith('horizontal-phone')) {
        const controls = await page.locator('.campfire').evaluate(node => {
          const scene = node.getBoundingClientRect()
          const prompt = node.querySelector('.campfire__prompt').getBoundingClientRect()
          return { limit: scene.top + scene.height / 4, bottom: prompt.bottom,
            buttons: [...node.querySelectorAll('.campfire__prompt button')].map(button => {
              const box = button.getBoundingClientRect()
              return { width: box.width, height: box.height, left: box.left, right: box.right }
            }) }
        })
        assert(controls.bottom <= controls.limit, 'campfire controls cover the party faces')
        assert(controls.buttons.every(button => button.width >= 44 && button.height >= 44
          && button.left >= 0 && button.right <= viewport.width), 'campfire controls must remain visible touch targets')
      }
      // A fresh run plays its deck's card-acquire animation over the scene; let it finish before the screenshot.
      await page.waitForFunction(() => !document.querySelector('.card-morph'))
      await page.screenshot({ path: resolve(output, `${name}-${characters.join('-')}.png`) })
    }
    await page.close()
    console.log(`PASS ${name}: base, Downfall, skin and four-hero parties sit on the camp painting`)
  }
} finally { await browser.close(); await server.close() }
