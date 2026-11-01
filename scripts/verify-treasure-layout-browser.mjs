import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { relicDef } from '../src/game/relics.ts'

const output = 'artifacts/treasure-layout'
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
const fixture = (relic = 'war_paint', sapphire = false) => {
  const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
  run.campaignProgress.actIV = sapphire ? 5 : 0
  run.phase = 'room'
  run.roomState = { kind: 'treasure', playerIds: ['p1'], offers: { p1: relic }, decisions: {} }
  return run
}
try {
  for (const [screen, viewport, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['horizontal-phone', { width: 844, height: 390 }, true],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone,
      recordVideo: { dir: output, size: viewport } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
      await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
    const stage = async run => {
      await page.locator('.treasure-claim').waitFor({ state: 'detached' })
      await page.evaluate(run => window.__STS_DEBUG__.setRun({ ...run, phase: 'map', roomState: null }), run)
      await page.locator('.treasure-stage').waitFor({ state: 'detached' })
      await page.evaluate(run => window.__STS_DEBUG__.setRun(run), run)
      await page.getByRole('button', { name: 'Open treasure chest', exact: true }).waitFor()
    }
    const activate = async control => phone ? control.tap() : control.click()
    const readRun = () => page.evaluate(() => window.__STS_DEBUG__.getRun())
    await page.mouse.move(0, 0)
    await stage(fixture())
    assert.equal(await page.locator('.treasure-stage h2').count(), 0, 'the closed scene must not show a reward banner')
    assert.equal(await page.locator('.treasure-offers, .treasure-actions').count(), 0)
    await page.locator('.treasure-chest').evaluate(image => image.decode())
    await page.screenshot({ path: `${output}/${screen}-closed.png` })
    const chest = page.getByRole('button', { name: 'Open treasure chest', exact: true })
    assert.equal(await chest.evaluate(button => button === document.activeElement), false,
      'arrival must not pre-highlight the chest before the pointer or keyboard reaches it')
    assert.equal(await page.locator('.treasure-chest').evaluate(image => getComputedStyle(image).filter), 'none')
    const closedScene = await page.locator('.treasure-scene').boundingBox()
    const checkChestHighlight = async state => {
      const style = await chest.evaluate(button => {
        const css = getComputedStyle(button)
        const image = getComputedStyle(document.querySelector('.treasure-chest'))
        return { outline: css.outlineStyle, border: css.borderTopWidth, shadow: css.boxShadow,
          background: css.backgroundColor, highlight: image.filter, focused: button.matches(':focus-visible') }
      })
      assert.equal(style.outline, 'none', `${screen}/${state}: the chest hit target must not draw a rectangular focus ring`)
      assert.equal(style.border, '0px')
      assert.equal(style.shadow, 'none')
      assert.equal(style.background, 'rgba(0, 0, 0, 0)')
      assert.match(style.highlight, /drop-shadow/, `${screen}/${state}: highlight the chest silhouette instead`)
      return style
    }
    await page.keyboard.press('Tab')
    await chest.focus()
    assert((await checkChestHighlight('keyboard')).focused, 'keyboard navigation must retain visible focus')
    await page.waitForTimeout(300)
    if (!phone) {
      await chest.hover()
      await page.screenshot({ path: `${output}/${screen}-hover.png` })
      await checkChestHighlight('hover')
      await page.mouse.down()
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${output}/${screen}-pressed.png` })
      await checkChestHighlight('press')
      await page.mouse.move(0, 0)
      await page.mouse.up()
      assert.equal(await page.locator('.treasure-stage').getAttribute('data-opened'), 'false',
        'canceling a chest press must not open it')
      assert.equal(await page.locator('.treasure-chest').evaluate(image => getComputedStyle(image).filter), 'none',
        'pointer departure must remove the silhouette highlight')
      await page.screenshot({ path: `${output}/${screen}-idle.png` })
    }
    const beforeOpen = await readRun()
    await activate(page.getByRole('button', { name: 'Open treasure chest', exact: true }))
    await page.getByRole('heading', { name: "What's Inside?", exact: true }).waitFor()
    assert.deepEqual(await page.locator('.treasure-scene').boundingBox(), closedScene,
      'opening must not resize the chest or move its base')
    assert.equal(await page.locator('.treasure-stage').getAttribute('data-skip-ready'), 'false')
    assert.equal(await page.locator('.treasure-skip').isEnabled(), false, 'Skip must not interrupt the reveal')
    assert.equal(await page.locator('.treasure-opening-flash').count(), 1)
    const bannerMotion = await page.locator('.room-banner').evaluate(banner => {
      const animation = banner.getAnimations().find(animation => animation.animationName === 'treasure-banner-in')
      const previousTime = animation.currentTime
      animation.pause()
      const positions = [0, 300, 400].map(time => {
        animation.currentTime = time
        return { y: banner.getBoundingClientRect().y, opacity: Number(getComputedStyle(banner).opacity) }
      })
      animation.currentTime = previousTime
      animation.play()
      return positions
    })
    assert(bannerMotion[0].y > bannerMotion[2].y && bannerMotion[1].y < bannerMotion[2].y,
      'the banner must rise with a settling overshoot, not just appear')
    assert.equal(bannerMotion[0].opacity, 0)
    await page.waitForTimeout(1100)
    await page.screenshot({ path: `${output}/${screen}-opening.png` })
    assert.equal(await page.locator('.treasure-stage').getAttribute('data-reveal-ready'), 'true')
    assert.equal(await page.locator('.treasure-stage').getAttribute('data-skip-ready'), 'false')
    await page.waitForFunction(() => document.querySelector('.treasure-stage')?.dataset.skipReady === 'true')
    await page.waitForTimeout(550)
    assert.deepEqual(await readRun(), beforeOpen, 'opening the chest is presentation, not an item claim')
    assert.equal(await page.locator('.potion-tip:visible').count(), 0, 'pointer opening must not automatically show relic help')
    assert.equal(await page.getByRole('button', { name: 'Take relic', exact: true }).count(), 0)
    assert.equal(await page.evaluate(async () => {
      const { queryRunLogControl } = await import('/src/ui/run-log.ts')
      return queryRunLogControl(document, { selector: '.treasure-actions > button:first-of-type', name: 'Take relic' })
        ?.dataset.treasureSlot
    }), 'p1', 'old Take relic recordings must resolve to the owned relic, not the new Skip button')
    assert.equal(await page.locator('.treasure-offer small').count(), 0, 'solo offers do not need an owner caption')
    const relic = page.locator('[data-treasure-slot="p1"]')
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    const layout = await page.locator('.treasure-stage').evaluate(stage => {
      const box = stage.getBoundingClientRect()
      const relic = stage.querySelector('[data-treasure-slot]').getBoundingClientRect()
      const banner = stage.querySelector('.room-banner').getBoundingClientRect()
      const skip = stage.querySelector('.treasure-skip').getBoundingClientRect()
      return {
        centered: Math.abs(relic.x + relic.width / 2 - box.x - box.width / 2) <= 2,
        bannerAbove: banner.bottom < relic.top,
        skipRight: skip.left > relic.right && skip.top > relic.bottom,
        fits: skip.right <= innerWidth && skip.bottom <= innerHeight && skip.top >= box.top,
        arrow: getComputedStyle(stage.querySelector('.treasure-skip'), '::before').backgroundImage,
      }
    })
    assert(layout.centered && layout.bannerAbove && layout.skipRight && layout.fits, JSON.stringify(layout))
    assert.match(layout.arrow, /treasure-skip\.svg/)
    assert.equal(await skip.evaluate(button => getComputedStyle(button, '::after').animationDuration), '0.5s',
      'the Skip outline must breathe through a one-second down/up cycle')
    await page.evaluate(() => document.fonts.ready)
    const titleAlignment = await page.locator('#treasure-title').evaluate(title => {
      const banner = title.parentElement.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(title)
      const text = range.getBoundingClientRect()
      const style = getComputedStyle(title)
      const context = document.createElement('canvas').getContext('2d')
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const metrics = context.measureText(title.textContent)
      const scaleY = text.height / (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)
      const baseline = text.top + metrics.fontBoundingBoxAscent * scaleY
      const inkTop = baseline - metrics.actualBoundingBoxAscent * scaleY
      const inkBottom = baseline + metrics.actualBoundingBoxDescent * scaleY
      const inkCenterX = text.left + (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2 *
        text.width / metrics.width
      // The 1509x260 artwork's central writing face spans y=0..160; the tails extend below it.
      const faceCenterY = banner.top + banner.height * 80 / 260
      return {
        dx: inkCenterX - (banner.left + banner.width / 2),
        dy: (inkTop + inkBottom) / 2 - faceCenterY,
        fits: inkTop >= banner.top && inkBottom <= banner.top + banner.height * 160 / 260 &&
          text.left >= banner.left + banner.width * 0.11 && text.right <= banner.right - banner.width * 0.11,
      }
    })
    assert(Math.abs(titleAlignment.dx) <= 2 && Math.abs(titleAlignment.dy) <= 2 && titleAlignment.fits,
      `${screen}: title ink must be centered on the parchment writing face, not its tails: ${JSON.stringify(titleAlignment)}`)
    await page.screenshot({ path: `${output}/${screen}-opened.png` })
    const relicBounds = await relic.boundingBox()
    if (phone) await relic.tap()
    else {
      await relic.locator('.item-icon-image').evaluate(image => {
        image.addEventListener('transitionrun', event => {
          if (event.propertyName !== 'scale') return
          const animation = image.getAnimations().find(animation => animation.transitionProperty === 'scale')
          animation.pause()
          image.hoverTween = animation
        }, { once: true })
      })
      await relic.hover()
      await page.waitForFunction(() => document.querySelector('[data-treasure-slot] .item-icon-image')?.hoverTween)
      const hover = await relic.locator('.item-icon-image').evaluate(image => {
        const animation = image.hoverTween
        const duration = animation.effect.getTiming().duration
        const widths = [0, duration / 2, duration].map(time => {
          animation.currentTime = time
          return image.getBoundingClientRect().width
        })
        animation.finish()
        return { duration, widths }
      })
      assert.equal(hover.duration, 50)
      assert(hover.widths[0] < hover.widths[1] && hover.widths[1] < hover.widths[2])
      assert(Math.abs(hover.widths[2] / hover.widths[0] - 1.05) < .001)
      assert.equal(await relic.locator('.item-icon-image').evaluate(image => getComputedStyle(image).transform), 'none',
        'the generic potion-belt scale/lift must not stack with the treasure tween')
      assert.deepEqual(await relic.boundingBox(), relicBounds, 'relic hover must not move its hit target')
      await page.mouse.down()
      await page.waitForTimeout(450)
      assert.equal(await relic.locator('.item-icon-image').evaluate(image => getComputedStyle(image).scale), '0.95')
      await page.mouse.move(0, 0)
      await page.mouse.up()
      await page.waitForTimeout(450)
      assert.equal(await relic.locator('.item-icon-image').evaluate(image => getComputedStyle(image).scale), '1')
      await relic.hover()
    }
    const tip = page.locator('.potion-tip:visible')
    await tip.waitFor()
    assert((await tip.innerText()).includes(relicDef('war_paint').name))
    assert.deepEqual(await readRun(), beforeOpen, 'reading the tooltip must not acquire the relic')
    await page.screenshot({ path: `${output}/${screen}-tooltip.png` })
    if (phone) await page.keyboard.press('Escape')
    else await page.mouse.move(0, 0)
    await tip.waitFor({ state: 'detached' })
    if (!phone) {
      const bounds = await skip.boundingBox()
      await skip.hover()
      await page.waitForTimeout(80)
      assert.equal(await skip.evaluate(button => getComputedStyle(button, '::before').scale), '1.05')
      assert.equal(await skip.evaluate(button => getComputedStyle(button, '::before').filter), 'brightness(1.4)')
      assert.equal(await skip.evaluate(button => getComputedStyle(button).filter), 'none',
        'generic Proceed brightness must not stack with the arrow image feedback')
      assert.deepEqual(await skip.boundingBox(), bounds, 'Skip feedback must not move the hit target')
      await page.screenshot({ path: `${output}/${screen}-skip-hover.png` })
      await page.mouse.down()
      await page.waitForTimeout(550)
      assert.equal(await skip.evaluate(button => getComputedStyle(button, '::before').scale), '0.95')
      await page.mouse.move(0, 0)
      await page.mouse.up()
      assert.deepEqual(await readRun(), beforeOpen, 'canceling a Skip press must not leave the room')
    }
    await activate(skip)
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')

    await stage(fixture('vajra'))
    await activate(page.getByRole('button', { name: 'Open treasure chest', exact: true }))
    await page.waitForTimeout(1700)
    const beforeTake = await readRun()
    const offer = page.locator('[data-treasure-slot="p1"]')
    const offeredBounds = await offer.boundingBox()
    if (phone) {
      await offer.tap()
      assert.deepEqual(await readRun(), beforeTake, 'the first touch must still only inspect')
      await offer.tap()
    } else await offer.click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    assert((await readRun()).players[0].relics.some(relic => relic.defId === 'vajra'))
    const claimBounds = await page.locator('.treasure-claim-source').boundingBox()
    assert(Math.abs(claimBounds.x + claimBounds.width / 2 - offeredBounds.x - offeredBounds.width / 2) <= 2 &&
      Math.abs(claimBounds.y + claimBounds.height / 2 - offeredBounds.y - offeredBounds.height / 2) <= 2,
    `pickup must start at the settled relic: ${JSON.stringify({ offeredBounds, claimBounds })}`)
    await page.locator('.treasure-departure').waitFor()
    await page.locator('.treasure-claim').waitFor({ state: 'detached' })
    assert.equal(await page.locator('.treasure-departure').count(), 0, 'pickup must finish before the next room')

    await stage(fixture('anchor', true))
    await page.getByRole('button', { name: 'Open treasure chest', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: "What's Inside?", exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('[data-treasure-slot="p1"]') === document.activeElement)
    assert(await page.locator('[data-treasure-slot="p1"]').evaluate(element => element === document.activeElement),
      'keyboard opening must focus the available relic')
    await page.locator('.potion-tip:visible').waitFor()
    await page.waitForFunction(() => document.querySelector('.treasure-stage')?.dataset.skipReady === 'true')
    await page.waitForTimeout(550)
    await page.keyboard.press('Escape')
    await activate(page.getByRole('button', { name: '◆ Skip for Sapphire Key', exact: true }))
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    assert.equal((await readRun()).campaign.keys.sapphire, true)
    if (phone) {
      await stage(fixture())
      await chest.dispatchEvent('pointerdown', { pointerType: 'touch' })
      await chest.dispatchEvent('click', { detail: 0 })
      await page.waitForFunction(() => document.querySelector('.treasure-stage')?.dataset.revealReady === 'true')
      assert.equal(await page.locator('.potion-tip:visible').count(), 0,
        'a touch-generated zero-detail click must not become keyboard focus after the reveal')
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    // The in-game setting also applies on phones, where OS animation preferences can be overridden.
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true' })
    await stage(fixture())
    await activate(chest)
    await page.waitForFunction(() => document.querySelector('.treasure-stage')?.dataset.skipReady === 'true')
    assert.equal(await page.locator('.treasure-opening-flash, .treasure-coins').count(), 0)
    assert.equal(await page.locator('.room-banner').evaluate(element => element.getAnimations().length), 0)
    assert.equal(await page.locator('.treasure-skip').evaluate(element =>
      getComputedStyle(element, '::after').animationName), 'none')
    if (!phone) {
      await relic.hover()
      assert.equal(await relic.locator('.item-icon-image').evaluate(image => getComputedStyle(image).scale), '1')
      await skip.hover()
      assert.equal(await skip.evaluate(button => getComputedStyle(button, '::before').scale), '1')
      assert(await skip.evaluate(button => parseFloat(getComputedStyle(button, '::before').transitionDuration) <= 0.001),
        'reduced-motion feedback must be effectively instantaneous')
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${screen}: closed/open layout, pointer help, relic claim, Skip, keyboard and Sapphire choice`)
    const video = page.video()
    await page.close()
    await video.saveAs(`${output}/${screen}.webm`)
    await video.delete()
  }
} finally {
  await browser.close()
  await server.close()
}
