import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { chooseRelicReward } from '../src/game/run.ts'
import { SKIN_IDS, SKIN_LABELS, skinsOf } from '../src/game/skins.ts'
import { CHARACTER_IDS } from '../src/game/types.ts'
import { CHARACTER_LABEL } from '../src/ui/run-summary-data.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = `${root}artifacts/treasure-animation`
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'silent', server: { port: 0 } })
await server.listen()
const errors = []
// Round N seats every base hero in its Nth skin (a hero with fewer skins keeps its last look), so the party shows every skin's
// hand model in some round; a skinned hero of another ruleset (Slime Boss) joins three plain base heroes, once per skin.
// The animation checks below run for round 1; later rounds check each seat's hand and grip files.
const BASE_HEROES = ['ironclad', 'silent', 'defect', 'watcher']
const seat = (character, index, skin) => ({ id: `p${index + 1}`, name: `${'ABCD'[index]} · ${skin ? SKIN_LABELS[skin] : CHARACTER_LABEL[character]}`, character, ...(skin ? { skin } : {}) })
const guests = CHARACTER_IDS.filter((character) => !BASE_HEROES.includes(character) && skinsOf(character).length > 0)
const rounds = [
  ...Array.from({ length: Math.max(...BASE_HEROES.map((character) => skinsOf(character).length)) }, (_, round) =>
    BASE_HEROES.map((character, index) => {
      const skins = skinsOf(character)
      return seat(character, index, skins[Math.min(round, skins.length - 1)])
    })),
  ...guests.flatMap((guest) => skinsOf(guest).map((skin) => [seat(guest, 0, skin), ...BASE_HEROES.slice(0, 3).map((character, index) => seat(character, index + 1))])),
]
const [seats] = rounds
const visualOf = (seat) => seat.skin ?? seat.character
assert.deepEqual(SKIN_IDS.filter((skin) => !rounds.flat().some((seat) => seat.skin === skin)), [],
  'every registered skin needs a seat in some round')
function fixture(shared = true, roster = seats) {
  const run = postNeowRun('treasure-animation', roster)
  run.campaignProgress.actIV = 5
  run.phase = 'room'
  run.roomState = { kind: 'treasure', playerIds: seats.map((p) => p.id), decisions: {},
    offers: shared ? {} : { p1: 'anchor', p2: 'bag_of_preparation', p3: 'lantern', p4: 'vajra' },
    ...(shared ? { sharedOffers: ['anchor', 'bag_of_preparation', 'lantern', 'vajra'] } : {}),
  }
  return run
}
try {
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    if (process.argv.includes('--webkit-only') && engineName !== 'webkit') continue
    if (process.argv.includes('--chromium-only') && engineName !== 'chromium') continue
    const browser = await engine.launch()
    try {
      for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }]]) {
        if (process.argv.includes('--touch-only') && name !== 'horizontal-phone') continue
        const context = await browser.newContext({ viewport, hasTouch: name === 'horizontal-phone', isMobile: name === 'horizontal-phone',
          ...(engineName === 'chromium' && name === 'desktop' ? { recordVideo: { dir: output, size: viewport } } : {}) })
        const page = await context.newPage()
        const tap = async (locator) => {
          if (engineName !== 'webkit') return locator.tap()
          await locator.scrollIntoViewIfNeeded()
          const box = await locator.boundingBox()
          const visual = await page.evaluate(() => ({ x: visualViewport.offsetLeft, y: visualViewport.offsetTop, scale: visualViewport.scale }))
          await page.touchscreen.tap((box.x + box.width / 2 - visual.x) * visual.scale,
            (box.y + box.height / 2 - visual.y) * visual.scale)
        }
        page.on('pageerror', (error) => errors.push(String(error)))
        await page.goto(`http://localhost:${server.httpServer.address().port}`, { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: 'Single Player', exact: true }).click()
        await page.getByRole('button', { name: 'Standard', exact: true }).click()
        await page.getByRole('button', { name: 'Embark', exact: true }).click()
        await page.getByRole('button', { name: 'Start standard campaign', exact: true }).click()
        await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
        for (const roundSeats of rounds.slice(1)) {
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), fixture(true, roundSeats))
          for (const seat of roundSeats) {
            for (const pose of ['hand', 'grip']) {
              const href = `/assets/noncombat/treasure/${pose}-${visualOf(seat)}.webp`
              await page.locator(`link[rel="preload"][href$="${pose}-${visualOf(seat)}.webp"]`).first().waitFor({ state: 'attached' })
              assert.equal(await page.evaluate(async (url) => (await fetch(url)).status, href), 200, `${name}: ${href} is served`)
            }
          }
        }
        await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), fixture())
        // Mobile browser bars reduce the visible app height without changing vh.
        const browserBars = name === 'horizontal-phone'
          ? await page.addStyleTag({ content: '#root { height: calc(100dvh - 160px); }' }) : null
        await page.locator('.treasure-chest').waitFor()
        await page.getByRole('button', { name: 'Open treasure chest', exact: true }).click()
        await page.waitForTimeout(3100)
        await page.mouse.move(5,5)
        await page.screenshot({ path: `${output}/${engineName}-${name}-before-pick.png` })
        for (const label of ['Skip', '◆ Skip for Sapphire Key']) {
          const button = page.getByRole('button', { name: label, exact: true })
          assert(await button.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth &&
              [box.top + 2, box.bottom - 2].every((y) => element.contains(document.elementFromPoint(box.x + box.width / 2, y)))
          }), `${engineName} ${name}: ${label} must be fully visible and unobstructed without scrolling`)
        }
        await browserBars?.evaluate((element) => element.remove())
        if (name === 'horizontal-phone') await tap(page.locator('[data-treasure-slot="0"]'))
        else await page.locator('[data-treasure-slot="0"]').hover()
        await page.locator('.potion-tip:visible').waitFor()
        assert.match(await page.locator('.potion-tip:visible').innerText(), /Anchor/)
        if (name === 'horizontal-phone') {
          assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().roomState.decisions), {}, 'First tap must only show details')
          assert.match(await page.locator('.potion-tip:visible').innerText(), /Tap again to take this relic/i)
          assert.equal(await page.locator('.treasure-claim:not(.treasure-preview)').count(), 0)
        }
        assert.equal(await page.locator('.treasure-claim').count(), 0, 'No hover hand')
        await page.screenshot({ path: `${output}/${engineName}-${name}-hover.png` })
        await page.clock.install()
        await page.clock.pauseAt(new Date())
        const offeredSize = await page.locator('[data-treasure-slot="0"] .item-icon-image').evaluate(image => image.clientWidth)
        if (name === 'horizontal-phone') await tap(page.locator('[data-treasure-slot="0"]'))
        else await page.locator('[data-treasure-slot="0"]').click()
        await page.locator('.treasure-claim--0').waitFor({ state: 'attached' })
        assert.equal(await page.locator('[data-treasure-slot="0"]').getAttribute('data-taken'), 'true')
        assert.equal(await page.locator('[data-treasure-slot="0"]').evaluate((element) => element.tagName), 'SPAN')
        await page.locator('.potion-tip:visible').waitFor({ state: 'detached' })
        const pickup = page.locator('.treasure-claim--0')
        assert(Math.abs(await pickup.locator('.treasure-claim__relic .item-icon-image')
          .evaluate(image => image.getBoundingClientRect().width) - offeredSize) < 1,
        'claim animation must retain the displayed relic size')
        assert.match(await pickup.locator('img.treasure-claim__hand--reach').getAttribute('src'), new RegExp(`hand-${visualOf(seats[0])}\\.webp`), 'the skin reaches with its own hand')
        await pickup.locator('img.treasure-claim__hand').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
        const pose = (time) => pickup.evaluate((element, time) => {
          for (const node of [element, ...element.querySelectorAll('*')]) {
            for (const animation of node.getAnimations()) { animation.pause(); animation.currentTime = time }
          }
        }, time)
        await pose(450)
        await page.screenshot({ path: `${output}/${engineName}-${name}-hand.png` })
        await pose(700)
        await page.screenshot({ path: `${output}/${engineName}-${name}-grip.png` })
        await pickup.evaluate((element) => {
          for (const node of [element, ...element.querySelectorAll('*')]) {
            node.getAnimations().forEach((animation) => animation.play())
          }
        })
        await page.clock.runFor(1600)
        await page.clock.resume()
        await page.locator('.treasure-claim:not(.treasure-preview)').waitFor({ state: 'detached' })
        // Remote decisions use authoritative snapshots while the viewer stays on A.
        for (let seat = 1; seat < 4; seat++) {
          const current = await page.evaluate(() => window.__STS_DEBUG__.getRun())
          const next = chooseRelicReward(current, `p${seat + 1}`, seat)
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), next)
          const receipt = await page.waitForFunction((seat) => {
            const hand = document.querySelector(`.treasure-claim--${seat} img.treasure-claim__hand--reach`)
            return hand && { src: hand.getAttribute('src'), phase: window.__STS_DEBUG__.getRun().phase }
          }, seat)
          const observed = await receipt.jsonValue()
          await receipt.dispose()
          assert.match(observed.src, new RegExp(`hand-${visualOf(seats[seat])}\\.webp`))
          if (seat === 3) assert.equal(observed.phase, 'map')
          await page.locator('.treasure-claim:not(.treasure-preview)').waitFor({ state: 'detached' })
        }
        assert.equal(await page.locator('.treasure-claim:not(.treasure-preview)').count(), 0)
        // Another player taking the hovered relic must dismiss the local preview.
        if (name === 'desktop') {
          const fresh = fixture()
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), fresh)
          await page.getByRole('button', { name: 'Open treasure chest', exact: true }).click()
          await page.waitForFunction(() => document.querySelector('.treasure-stage')?.dataset.revealReady === 'true')
          await page.locator('[data-treasure-slot="0"]').hover()
          assert.equal(await page.locator('.treasure-claim').count(), 0, 'Hover must only show details, never play a reach')
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), chooseRelicReward(fresh, 'p2', 0))
          await page.locator('.treasure-preview').waitFor({ state: 'detached' })
          await page.locator('.potion-tip:visible').waitFor({ state: 'detached' })
          await page.locator('.treasure-claim:not(.treasure-preview)').waitFor({ state: 'detached' })
          await page.evaluate(() => { const run = window.__STS_DEBUG__.getRun(); window.__STS_DEBUG__.setRun({ ...run, phase: 'map', roomState: null }) })
          await page.locator('.treasure-chest').waitFor({ state: 'detached' })
        }
        // Assigned rewards expose the party but never let A claim B's relic.
        await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), fixture(false))
        await page.getByRole('button', { name: 'Open treasure chest', exact: true }).click()
        await page.waitForTimeout(1500)
        assert.equal(await page.locator('[data-treasure-slot="p2"]').getAttribute('aria-disabled'), 'true')
        await page.locator('[data-treasure-slot="p2"]').dispatchEvent('click')
        assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().roomState.decisions), {})
        await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true' })
        await page.locator('[data-treasure-slot="p1"]').focus()
        await page.keyboard.press('Enter')
        assert.equal(await page.locator('.treasure-claim:not(.treasure-preview)').count(), 0)
        const run = await page.evaluate(() => window.__STS_DEBUG__.getRun())
        assert.equal(run.roomState.decisions.p1, 'take')
        // Reapplying a snapshot must not repeat the pickup.
        await page.evaluate((run) => { delete document.documentElement.dataset.reducedMotion; window.__STS_DEBUG__.setRun(run) }, run)
        assert.equal(await page.locator('.treasure-claim:not(.treasure-preview)').count(), 0)
        assert(await page.locator('.treasure-actions').isVisible())
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
        assert.equal(overflow, false, 'Treasure must not widen the viewport')
        if (engineName === 'chromium' && name === 'desktop') {
          // One coalesced server snapshot can finish all four decisions at once.
          const roster = ['slime_boss', 'guardian', 'hexaghost', 'hermit'].map((character, index) => ({ id: `p${index + 1}`, name: character, character }))
          let downfall = fixture(true, roster)
          downfall.roomState.sharedOffers[3] = 'old_coin'
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), downfall)
          // Same mounted room: it is already open after the duplicate-snapshot check.
          await page.locator('[data-treasure-slot="0"]').waitFor()
          for (let index = 0; index < 4; index++) downfall = chooseRelicReward(downfall, `p${index + 1}`, index)
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), downfall)
          await page.waitForFunction(() => document.querySelectorAll('.treasure-claim:not(.treasure-preview)').length === 4)
          for (const character of roster.map((seat) => seat.character)) {
            const art = page.locator(`.treasure-claim__hand--grip[src*="${character}"]`)
            await art.evaluate((image) => image.decode())
          }
          await page.waitForFunction(() => !document.querySelector('.treasure-claim:not(.treasure-preview)'))
        }
        // Elite relics use the loot sheet, including shared-choice variants.
        for (const shared of [false, true]) {
          const elite = fixture(shared)
          elite.roomState.kind = 'elite'
          await page.evaluate((run) => window.__STS_DEBUG__.setRun({ ...run, phase: 'map', roomState: null }), elite)
          await page.locator('.treasure-stage, .reward-screen[aria-label="Elite loot"]').waitFor({ state: 'detached' })
          await page.evaluate((run) => window.__STS_DEBUG__.setRun(run), elite)
          await page.getByRole('heading', { name: 'Loot!', exact: true }).waitFor()
          await page.locator('.reward-screen[aria-label="Elite loot"]').evaluate(async screen => {
            await Promise.all([...screen.querySelectorAll('img')].map(image => image.decode()))
            await Promise.all(screen.getAnimations({ subtree: true })
              .filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished))
          })
          assert.equal(await page.locator('.treasure-chest').count(), 0)
          assert.equal(await page.locator('.loot-choice').count(), shared ? 4 : 1)
          const item = page.locator('.loot-choice').first()
          if (name === 'horizontal-phone') {
            await tap(item)
            assert.deepEqual(await page.evaluate(() => window.__STS_DEBUG__.getRun().roomState.decisions), {})
            if (shared) {
              // Touch browsers can synthesize hover at a stale mouse position.
              await page.locator('.loot-choice').nth(2).dispatchEvent('mouseover')
              assert.match(await page.locator('.potion-tip:visible').innerText(), /Anchor.*Tap again/is)
            }
            await tap(item)
          } else await item.click()
          await page.waitForFunction(() => window.__STS_DEBUG__.getRun().roomState.decisions.p1 !== undefined)
          assert.equal(await page.locator('.treasure-claim').count(), 0)
          await page.screenshot({ path: `${output}/${engineName}-${name}-elite-${shared}.png` })
        }
        if (page.video()) console.log(`Video: ${await page.video().path()}`)
        await context.close()
        console.log(`✓ ${engineName} ${name}: chest, hover, four confirmed claims, final transition, assigned ownership, reduced motion, duplicate snapshot`)
      }
    } finally { await browser.close() }
  }
  assert.deepEqual(errors, [])
} finally { await server.close() }
