import { test } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

test.use({ appKey: import.meta.url, hasTouch: false, isMobile: false, reducedMotion: "reduce" })

test('button-borders', async ({ page, screen, appURL }) => {
  const output = new URL("../../artifacts/button-borders/", import.meta.url)
  mkdirSync(output, { recursive: true })
  async function checkBorder(page, element, label) {
    const geometry = await element.evaluate(element => {
  const style = getComputedStyle(element)
  const cut = style.clipPath.match(/^polygon\(([\d.]+)(px|%)/)
  if (!cut) throw new Error(`Missing beveled silhouette: ${style.clipPath}`)
  return { cut: Number(cut[1]), percent: cut[2] === '%', border: parseFloat(style.borderTopWidth) || 2 }
    })
    const png = await element.screenshot({ path: new URL(`${label}.png`, output).pathname })
    const colors = await page.evaluate(async ({ png, cut, percent, border }) => {
  const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)
  const cutX = percent ? image.width * cut / 100 : cut
  const cutY = percent ? image.height / 2 : cut
  const x = Math.floor(cutX / 2)
  const y = Math.floor(cutY * (1 - (x + .5) / cutX) + border / 2 * Math.hypot(cutX, cutY) / cutX)
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
    `${label}: corner ${index} has a broken border: ${JSON.stringify(colors)}`)
    }
  }
  await page.route('**/button-border-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="/src/ui/styles.css"><link rel="stylesheet" href="/src/ui/chrome.css">
      <style>
        body { padding: 32px; background: #101015; }
        main { display: flex; gap: 24px; align-items: start; height: 80px; }
        .combat { display: contents; }
        #plain, #stone { position: relative; width: 180px; height: 64px; }
        #panels { display: grid; grid-template-columns: repeat(auto-fit, 280px); gap: 24px; margin-top: 24px; }
        #panels > details { position: static; margin: 0; }
        #panels .relic-actions { gap: 8px; }
        #panels .border-fixture { width: 260px; min-width: 0; max-width: none; height: 110px; max-height: none; margin: 0; }
        #hex-skip { width: 180px; height: 64px; }
      </style></head><body><main class="sts-scope">
      <button id="plain">Plain key</button>
      <div class="combat"><button id="stone">Stone key</button></div>
      <button class="ribbon-back" aria-label="Back"><span></span></button>
      </main><section class="sts-scope" id="panels">
        <div class="relic-actions" style="position:static;overflow:visible;max-height:none">
          <section id="start-closed" class="border-fixture relic-actions__start-turn">
            <h3 class="relic-actions__heading">Start of Turn only</h3>
            ${Array.from({ length: 8 }, () => '<button>Relic</button>').join('')}
          </section>
          <section id="start-open" class="border-fixture relic-actions__start-turn">
            <h3 class="relic-actions__heading">Start of Turn only</h3><details open><summary>Loaded Die</summary></details>
          </section>
          <section id="general-open" class="border-fixture"><details open><summary>Blue Candle</summary></details></section>
        </div>
        <details class="online-lobby__settings"><summary id="disclosure" class="border-fixture">Settings</summary></details>
        <details class="start-menu__meta"><summary id="menu-disclosure" class="border-fixture">Menu</summary></details>
        <div id="map-panel" class="border-fixture map-peek__panel">Map</div>
        <div id="portal-panel" class="border-fixture portal-map">Portal</div>
        <div id="mail-panel" class="border-fixture mailbox__panel">Mailbox</div>
        <div id="loot-panel" class="border-fixture event-loot">Event reward</div>
        <div class="reward-screen--card-choice" style="position:static;min-height:0;padding:0">
          <button id="hex-skip" class="reward-screen__skip">Skip</button>
        </div>
      </section></body></html>`,
  }))
  await page.goto(`${appURL}/button-border-fixture`)
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
      if (state === 'focus') continue
      await checkBorder(page, button, `${screen}-${id}-${state}`)
      if (state === 'active') await page.mouse.up()
    }
  }
  await page.mouse.move(0, 0)
  assert.deepEqual(await ribbon.screenshot(), ribbonBefore, 'key states must not change the ribbon')
  const panels = ['start-closed', 'start-open', 'general-open', 'disclosure', 'menu-disclosure',
    'map-panel', 'portal-panel', 'mail-panel', 'loot-panel', 'hex-skip']
  for (const id of panels) await checkBorder(page, page.locator(`#${id}`), `${screen}-${id}`)
  await page.locator('#start-closed').evaluate(element => { element.scrollLeft = element.scrollWidth })
  await checkBorder(page, page.locator('#start-closed'), `${screen}-start-scrolled`)
  for (const choice of ['take', 'skip']) {
    await page.locator('#loot-panel').evaluate((element, choice) => { element.dataset.choice = choice }, choice)
    await checkBorder(page, page.locator('#loot-panel'), `${screen}-loot-${choice}`)
  }
  for (const state of ['hover', 'active', 'disabled']) {
    const skip = page.locator('#hex-skip')
    await skip.hover()
    if (state === 'active') await page.mouse.down()
    if (state === 'disabled') await skip.evaluate(button => { button.disabled = true })
    await checkBorder(page, skip, `${screen}-hex-skip-${state}`)
    if (state === 'active') await page.mouse.up()
  }
  await page.emulateMedia({ forcedColors: 'active' })
  for (const id of ['plain', 'stone', ...panels]) {
    assert.equal(await page.locator(`#${id}`).evaluate(element => getComputedStyle(element).clipPath), 'none',
      `${id}: forced colours need a complete native border when gradients are removed`)
  }
  console.log(`PASS ${screen}: continuous key borders in every state; ribbon and keyboard focus preserved`)
})
