// Focused coverage for restored scene decoding and campfire WebP routing.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { characterOfSkin, isSkinId, VISUAL_IDS } from '../src/game/skins.ts'
/** Party scene name: the visual ids joined in registry order, characters first and then skins. */
const campfireName = (party) => VISUAL_IDS.filter((id) => party.includes(id)).join('_')
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
    // A party is named by its visual ids (a worn skin replaces its hero) and lit by exactly that scene. Every party of up to
    // four heroes is painted, so no reachable party falls back; the pure fallback rule is covered by verify-skins.mjs.
    for (const characters of [['ironclad'], ['guardian'], ['ironclad', 'silent', 'defect', 'watcher'], ['guardian', 'hexaghost', 'hermit'],
      ['kratos'], ['monogatari_silent'], ['monogatari_watcher'], ['silent', 'defect', 'kratos'], ['ironclad', 'monogatari_silent'],
      ['kratos', 'monogatari_silent', 'monogatari_watcher'], ['defect', 'kratos', 'monogatari_silent', 'monogatari_watcher'],
      ['monogatari_silent', 'guardian', 'hermit'], ['ironclad', 'defect', 'monogatari_silent', 'monogatari_watcher'],
      ['monogatari_ironclad', 'monogatari_silent', 'monogatari_defect', 'monogatari_watcher'],
      ['monogatari_silent', 'monogatari_defect'], ['monogatari_ironclad', 'monogatari_watcher'],
      ['guardian', 'hermit', 'monogatari_ironclad', 'monogatari_watcher'],
      ['guardian', 'monogatari_defect'], ['guardian', 'hexaghost', 'monogatari_ironclad']]) {
      // A skin party is lit by the skin's scene: the hero under it wears the skin.
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
      const expected = `/${campfireName(characters)}_firecamp.webp`
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('.campfire')).backgroundImage.includes(expected), expected)
      const size = await page.locator('.campfire').evaluate(async node => {
        const url = getComputedStyle(node).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)[1]
        const image = new Image(); image.src = url; await image.decode()
        return [image.naturalWidth, image.naturalHeight]
      })
      assert.deepEqual(size, [3840, 2161])
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
      await page.screenshot({ path: resolve(output, `${name}-${characters.join('-')}.png`) })
    }
    await page.close()
    console.log(`PASS ${name}: base, Downfall and multiplayer party campfire scenes decode at 4K`)
  }
} finally { await browser.close(); await server.close() }
