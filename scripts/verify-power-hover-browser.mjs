#!/usr/bin/env node
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { assert, assertDeepEqual, check, report, suite } from './lib/harness.mjs'

const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { port: 0 } })
await server.listen()
const address = server.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('Vite did not report a port')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(String(error)))

try {
  suite('Power hover browser')
  await page.goto(`http://localhost:${address.port}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Single Player', exact: true }).click()
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('button', { name: 'Embark', exact: true }).click()
  await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__?.getRun()?.phase === 'neow')
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.phase = 'map'
    run.neow = null
    debug.setRun(run)
  })
  await page.locator('.room--reachable').first().click()
  await page.locator('.combat').waitFor()
  await page.waitForFunction(() => !document.querySelector('.hand .card--drawn'))
  await page.evaluate(() => {
    const debug = window.__STS_DEBUG__
    const run = structuredClone(debug.getRun())
    run.combat.players[0].powers = [
      'demon_form', 'metallicize', 'inflame', 'barricade',
      'combust', 'corruption', 'evolve', 'feel_no_pain',
    ].map((defId, index) => ({ uid: `power-hover-${index}`, defId, upgraded: false }))
    debug.setRun(run)
  })
  await page.waitForFunction(() => document.querySelectorAll('.row__seat .power').length === 8)

  const probes = []
  let compactStatus = null
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 620 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.mouse.move(0, 0)
    if (viewport.height === 390) compactStatus = await page.locator('.row--viewer .seat__status-strip')
      .evaluate((strip) => ({ status: strip.getBoundingClientRect().toJSON(),
        hp: strip.closest('.row__seat').querySelector('.bar').getBoundingClientRect().toJSON() }))
    for (const power of await page.locator('.row__seat .power').all()) {
      await power.scrollIntoViewIfNeeded()
      const hit = await power.evaluate((tile) => {
        const box = tile.getBoundingClientRect()
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return { matches: top?.closest('.power') === tile, top: top?.className ?? top?.tagName ?? 'nothing' }
      })
      await power.hover()
      await page.waitForFunction((tile) => {
        const zoom = document.querySelector('.power__zoom:not(.slime-party__zoom)')
        return tile.getAttribute('aria-expanded') === 'true' &&
          zoom?.firstElementChild?.textContent === tile.getAttribute('aria-label')
      }, await power.elementHandle())
      probes.push(await page.locator('.power__zoom:not(.slime-party__zoom)').evaluate((zoom) => {
        const box = zoom.getBoundingClientRect()
        return {
          width: Math.round(box.width), height: Math.round(box.height),
          left: Math.round(box.left), top: Math.round(box.top),
          right: Math.round(box.right), bottom: Math.round(box.bottom),
          viewport: { width: innerWidth, height: innerHeight },
          parentIsBody: zoom.parentElement === document.body,
        }
      }).then((probe) => ({ ...probe, hit })))
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    const run = structuredClone(window.__STS_DEBUG__.getRun())
    run.combat.players[0].powers = [
      { uid: 'compact-fury', defId: 'simmering_fury', upgraded: false },
      { uid: 'compact-buffer', defId: 'buffer', upgraded: true, counter: 1 },
    ]
    window.__STS_DEBUG__.setRun(run)
  })
  await page.waitForFunction(() => document.querySelectorAll('.row__seat .power').length === 2)
  const compactRun = await page.evaluate(() => window.__STS_DEBUG__.getRun())
  const spacing = page => page.locator('.row--viewer .powers').evaluate(powers => {
    const cells = [...powers.querySelectorAll('.power')].map(power => power.getBoundingClientRect())
    const glyphs = [...powers.querySelectorAll('.power > .icon')].map(icon => icon.getBoundingClientRect())
    const counter = powers.querySelector('.power__counter').getBoundingClientRect()
    return {
      gap: glyphs[1].left - glyphs[0].right,
      minWidth: Math.min(...cells.map(cell => cell.width)),
      minHeight: Math.min(...cells.map(cell => cell.height)),
      overlap: cells[0].right > cells[1].left + 0.5,
      counterFits: counter.left >= cells[1].left && counter.right <= cells[1].right &&
        counter.top >= cells[1].top && counter.bottom <= cells[1].bottom,
    }
  })
  const desktopSpacing = await spacing(page)
  await page.screenshot({ path: 'artifacts/power-hover-desktop-spacing.png' })
  check('desktop Power glyphs sit close together without overlapping controls or counters', () => {
    assert(desktopSpacing.gap >= 0 && desktopSpacing.gap <= 5, JSON.stringify(desktopSpacing))
    assert(desktopSpacing.minWidth >= 24 && !desktopSpacing.overlap && desktopSpacing.counterFits, JSON.stringify(desktopSpacing))
  })

  const phone = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })
  phone.on('pageerror', error => errors.push(String(error)))
  await phone.goto(`http://localhost:${address.port}`)
  for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
    await phone.getByRole('button', { name, exact: true }).click()
  }
  await phone.waitForFunction(() => window.__STS_DEBUG__?.getRun()?.phase === 'neow')
  await phone.evaluate(run => window.__STS_DEBUG__.setRun(run), compactRun)
  await phone.waitForFunction(() => document.querySelectorAll('.row__seat .power').length === 2)
  const phoneSpacing = await spacing(phone)
  check('touch Power glyphs fill their targets instead of leaving a misleading gap', () => {
    assert(phoneSpacing.gap >= 0 && phoneSpacing.gap <= 5, JSON.stringify(phoneSpacing))
    assert(phoneSpacing.minWidth >= 44 && phoneSpacing.minHeight >= 44 &&
      !phoneSpacing.overlap && phoneSpacing.counterFits, JSON.stringify(phoneSpacing))
  })
  for (const power of await phone.locator('.row__seat .power').all()) {
    await power.tap()
    await phone.locator('.power__zoom').waitFor()
    assert(await power.getAttribute('aria-expanded') === 'true', 'touch inspection must still open the chosen Power')
    await phone.keyboard.press('Escape')
    await phone.locator('.power__zoom').waitFor({ state: 'hidden' })
  }
  await phone.screenshot({ path: 'artifacts/power-hover-phone-spacing.png' })
  await phone.close()

  check('every Power stays clickable and opens a full card outside the board at supported sizes', () => {
    assert(probes.length === 24, `expected 24 probes, got ${probes.length}`)
    for (const probe of probes) {
      assert(probe.hit.matches, `a hand card or overlay intercepted a Power: ${JSON.stringify(probe)}`)
      assert(probe.parentIsBody, 'Power zoom is trapped inside the board')
      assert(probe.width >= 150 && probe.height >= 190, `Power zoom collapsed: ${JSON.stringify(probe)}`)
      assert(probe.left >= 0 && probe.top >= 0 && probe.right <= probe.viewport.width && probe.bottom <= probe.viewport.height,
        `Power zoom left the viewport: ${JSON.stringify(probe)}`)
    }
  })
  check('the horizontal-phone status strip clears HP and stays inside the viewport', () => {
    assert(compactStatus.status.top >= compactStatus.hp.bottom + 1, `statuses overlap HP: ${JSON.stringify(compactStatus)}`)
    assert(compactStatus.status.bottom <= 390, `statuses leave the viewport: ${JSON.stringify(compactStatus)}`)
  })
  check('Power hover flow has no browser errors', () => assertDeepEqual(errors, []))
  report('Power hover browser')
} finally {
  await browser.close()
  await server.close()
}
