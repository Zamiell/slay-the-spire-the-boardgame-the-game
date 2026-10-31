import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'

const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
const output = new URL('../artifacts/button-borders/', import.meta.url)
mkdirSync(output, { recursive: true })
try {
  for (const [screen, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['horizontal-phone', { width: 844, height: 390 }],
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
    await page.route('**/button-border-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/src/ui/styles.css"><link rel="stylesheet" href="/src/ui/chrome.css">
        <style>
          body { padding: 32px; background: #101015; }
          main { display: flex; gap: 24px; align-items: start; }
          .combat { display: contents; }
          #plain, #stone { position: relative; width: 180px; height: 64px; }
        </style></head><body><main class="sts-scope">
        <button id="plain">Plain key</button>
        <div class="combat"><button id="stone">Stone key</button></div>
        <button class="ribbon-back" aria-label="Back"><span></span></button>
        </main></body></html>`,
    }))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/button-border-fixture`)
    await page.evaluate(() => document.fonts.ready)
    const ribbon = page.locator('.ribbon-back')
    const ribbonBefore = await ribbon.screenshot()
    for (const id of ['plain', 'stone']) {
      const button = page.locator(`#${id}`)
      for (const state of ['normal', 'hover', 'active', 'selected', 'disabled', 'focus']) {
        await page.mouse.move(0, 0)
        await button.evaluate((element, state) => {
          element.blur()
          element.disabled = state === 'disabled'
          element.setAttribute('aria-pressed', String(state === 'selected'))
        }, state)
        if (state === 'hover' || state === 'active') await button.hover()
        if (state === 'active') await page.mouse.down()
        if (state === 'focus') {
          await page.keyboard.press('Tab')
          await button.focus()
          assert(await button.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'))
        }
        const geometry = await button.evaluate(element => {
          const style = getComputedStyle(element)
          return { cut: Number(style.clipPath.match(/^polygon\(([\d.]+)px/)[1]),
            border: parseFloat(style.borderTopWidth) }
        })
        const png = await button.screenshot({ path: new URL(`${screen}-${id}-${state}.png`, output).pathname })
        if (state === 'focus') continue
        const colors = await page.evaluate(async ({ png, cut, border }) => {
          const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)
          const x = Math.floor(cut / 2)
          const y = Math.floor(cut + border / Math.SQRT2 - x)
          const inset = Math.floor(border / 2)
          return {
            corners: [[x, y], [image.width - 1 - x, y],
              [x, image.height - 1 - y], [image.width - 1 - x, image.height - 1 - y]]
              .map(([x, y]) => pixel(x, y)),
            edges: [pixel(image.width / 2, inset), pixel(image.width - 1 - inset, image.height / 2),
              pixel(image.width / 2, image.height - 1 - inset), pixel(inset, image.height / 2)],
          }
        }, { png: png.toString('base64'), ...geometry })
        for (const [index, corner] of colors.corners.entries()) {
          const edge = colors.edges[index < 2 ? 0 : 2]
          assert(corner.every((value, channel) => Math.abs(value - edge[channel]) < 26),
            `${screen}/${id}/${state}: corner ${index} has a broken border: ${JSON.stringify(colors)}`)
        }
        if (state === 'active') await page.mouse.up()
      }
    }
    await page.mouse.move(0, 0)
    assert.deepEqual(await ribbon.screenshot(), ribbonBefore, 'key states must not change the ribbon')
    await page.emulateMedia({ forcedColors: 'active' })
    for (const id of ['plain', 'stone']) {
      assert.equal(await page.locator(`#${id}`).evaluate(element => getComputedStyle(element).clipPath), 'none',
        'forced colours need a complete native border when gradients are removed')
    }
    await page.close()
    console.log(`PASS ${screen}: continuous key borders in every state; ribbon and keyboard focus preserved`)
  }
} finally {
  await browser.close()
  await server.close()
}
