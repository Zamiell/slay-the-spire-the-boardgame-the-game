#!/usr/bin/env node
// Real engine events, separate complete drawings, cold decode and lifecycle regression.
// Failure contract was written before this check in combat-failure-modes.md.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, webkit } from './lib/profile-browser.mjs'
import { installKratosFixture, paintedKratosBounds } from './lib/kratos-animation-fixture.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/monogatari-combat/browser')
mkdirSync(output, { recursive: true })
const registry = JSON.parse(readFileSync(resolve(root, 'scripts/animation/sources/monogatari/registration.json')))
const server = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const report = { cases: [], errors: [] }
const idle = '.seat__portrait > img'
const cases = [
  ['ironclad', 'monogatari_ironclad', ['strike_ironclad', 'cleave', 'twin_strike']],
  ['defect', 'monogatari_defect', ['strike_defect', 'sweeping_beam', 'ball_lightning']],
]

async function ready(page) {
  await page.waitForFunction(() => Number(document.querySelector('.board')?.dataset.characterAttackAssetsReady) === 3)
  await page.locator(idle).evaluate(image => image.decode())
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.enemy__portrait img')].map(image => image.decode())))
}

// Sample in the browser, not browser round trips: a short pose cannot disappear between calls.
async function play(page, skin, card) {
  return page.evaluate(({ skin, card }) => new Promise((resolve, reject) => {
    window.kratosFixture.attack(card)
    // Channeling attacks append an Orb event after their offensive Card event.
    const event = window.kratosFixture.state.presentationEvents.findLast(event => event.kind === 'card' && event.sourceId === card)
    const seq = event.seq
    const started = performance.now()
    const sample = { seq, maxBodies: 0, poses: [], targets: event.enemyIds,
      damage: event.enemyHpLoss, projectile: null, firstVisible: null, phaseTimes: {}, travel: 0 }
    const tick = () => {
      const attack = document.querySelector(`.character-attack--${skin}[data-attack-seq="${seq}"]`)
      if (!attack && sample.maxBodies > 0) return resolve(sample)
      if (attack) {
        const visible = [...attack.querySelectorAll('.character-attack__pose img')]
          .filter(image => Number(getComputedStyle(image.parentElement).opacity) > .5 && image.complete && image.naturalWidth)
        const parent = attack.closest('.seat__portrait')
        const resting = parent.querySelector(':scope > img')
        const bodies = visible.length + (Number(getComputedStyle(resting).opacity) > .5 ? 1 : 0)
        sample.maxBodies = Math.max(sample.maxBodies, bodies)
        if (visible.length !== 1 || bodies !== 1) return reject(new Error(`missing/double body ${bodies}/${visible.length}`))
        const path = new URL(visible[0].src).pathname
        if (!sample.poses.includes(path)) {
          sample.poses.push(path)
          sample.phaseTimes[path] = visible[0].parentElement.getAnimations()[0]?.currentTime ?? 0
        }
        sample.travel = Math.max(sample.travel, new DOMMatrix(getComputedStyle(attack).transform).e)
        const bolt = attack.querySelector('.character-attack__bolt')
        if (bolt && !sample.projectile) {
          const p = parent.getBoundingClientRect()
          const style = getComputedStyle(bolt)
          const effect = bolt.getAnimations()[0]?.effect.getTiming()
          sample.projectile = { left: parseFloat(style.left), bottom: parseFloat(style.bottom),
            width: parseFloat(style.width), height: parseFloat(style.height), actorWidth: p.width,
            delay: effect?.delay, duration: effect?.duration }
        }
        sample.firstVisible ??= { path, at: performance.now() - started }
      }
      if (performance.now() - started > 6000) reject(new Error(`${skin}/${card}: attack never returned ${JSON.stringify({ sample, events: window.kratosFixture.state.presentationEvents })}`))
      else setTimeout(tick, 16)
    }
    // Production effects become active on the next animation frame.
    setTimeout(tick, 30)
  }), { skin, card })
}

try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
    if (process.argv.some(arg => arg.startsWith('--engine=')) && !process.argv.includes(`--engine=${engine}`)) continue
    const browser = await type.launch()
    try {
      for (const [screen, viewport] of [['desktop', { width: 1440, height: 900 }], ['horizontal-phone', { width: 844, height: 390 }]]) {
        if (process.argv.some(arg => arg.startsWith('--screen=')) && !process.argv.includes(`--screen=${screen}`)) continue
        for (const [character, skin, cards] of cases) {
          if (process.argv.some(arg => arg.startsWith('--skin=')) && !process.argv.includes(`--skin=${skin}`)) continue
          console.log(`START ${engine}/${screen}/${skin}`)
          const data = registry.skins[skin]
          const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: screen !== 'desktop',
            hasTouch: screen !== 'desktop', recordVideo: { dir: output, size: viewport } })
          let releaseCold
          try {
            const page = await context.newPage()
            page.setDefaultTimeout(15_000)
            page.on('pageerror', error => report.errors.push(`${engine}/${screen}/${skin}: ${error}`))
            page.on('response', response => {
              if (response.status() >= 400 && /\/assets\/combat\//.test(response.url())) report.errors.push(`${response.status()} ${response.url()}`)
            })
            const gate = new Promise(resolve => { releaseCold = resolve })
            const delayed = character === 'ironclad' ? 'impact' : 'release'
            await page.route(`**/${skin}-${delayed}.webp`, async route => { await gate; await route.continue() })
            await page.goto(origin)
            await page.evaluate(installKratosFixture)
            await page.evaluate(([character, skin]) => window.kratosFixture.reset(character, skin), [character, skin])
            await page.locator(idle).evaluate(image => image.decode())
            const cold = await play(page, skin, cards[0])
            assert.equal(cold.maxBodies, 1)
            assert(cold.poses.every(path => path.endsWith(`/animated/${skin}-idle.webp`)), 'cold attack popped a late/unready drawing')
            assert(cold.firstVisible && cold.poses.length === 1, 'cold cutout never decoded')
            if (character === 'defect') {
              const p = cold.projectile
              assert(p && Math.abs((p.left + p.width / 2) / p.actorWidth - data.evokeOrigin[0]) < .005, 'cold bolt floats away from idle chest')
              assert(Math.abs((p.bottom + p.height / 2) / p.actorWidth - (1 - data.evokeOrigin[1])) < .005, 'cold bolt misses idle chest height')
            }
            releaseCold()
            await page.unrouteAll({ behavior: 'wait' })
            await ready(page)
            const rest = await page.evaluate(paintedKratosBounds, idle)
            const warm = []
            for (const card of cards) {
              await page.evaluate(([character, skin]) => window.kratosFixture.reset(character, skin), [character, skin])
              await ready(page)
              const played = await play(page, skin, card)
              assert.equal(played.maxBodies, 1)
              for (const [time, pose] of data.keys) {
                const path = played.poses.find(path => path.endsWith(`/${skin}-${pose === 'idle' ? 'hero' : pose}.webp`))
                assert(path, `${skin}/${card}: ${pose} never painted`)
                // WebKit reads computed opacity one refresh ahead of Animation.currentTime.
                assert(played.phaseTimes[path] >= time - 20, `${skin}/${card}: ${pose} painted before its clock ${JSON.stringify(played.phaseTimes)}`)
              }
              assert.equal(played.targets.length, ['cleave', 'sweeping_beam'].includes(card) ? 2 : 1, 'authoritative target list changed')
              if (character === 'ironclad') assert(played.travel > 10, 'sword fighter never travels to target')
              else {
                const p = played.projectile
                assert(p && p.delay === 550 && p.duration === 560, 'base launch/contact clock changed')
                assert(Math.abs((p.left + p.width / 2) / p.actorWidth - data.projectileOrigin[0]) < .005, 'bolt misses registered palm x')
                assert(Math.abs((p.bottom + p.height / 2) / p.actorWidth - data.projectileOrigin[1]) < .005, 'bolt misses registered palm y')
              }
              warm.push({ card, ...played })
            }
            let evokes = []
            if (character === 'defect') {
              evokes = await page.evaluate(async ({ skin, origin }) => {
                const { playCard } = await import('/src/game/combat.ts')
                const f = window.kratosFixture
                const results = []
                for (const orb of ['lightning', 'dark']) {
                  f.reset('defect', skin)
                  f.state.players[0].orbs = [orb, null, null]
                  const card = { uid: `evoke-${orb}`, defId: 'dual_cast', upgraded: false }
                  f.state.players[0].hand.push(card)
                  f.state = playCard(f.state, 'p1', card.uid, {
                    enemyUid: null, playerId: 'p1', evokeSlots: [0], evokeEnemyUids: ['enemy-0', 'enemy-0'],
                  })
                  f.render()
                  await new Promise(resolve => setTimeout(resolve, 60))
                  const events = f.state.presentationEvents.filter(event => event.kind === 'orb' && event.sourceId === 'orb-evoke')
                  const sources = [...document.querySelectorAll('.defect-evoke')].map(source => {
                    const art = source.closest('.seat__portrait').querySelector(':scope > img')
                    const r = art.getBoundingClientRect()
                    const fit = Math.min(r.width / art.naturalWidth, r.height / art.naturalHeight)
                    const actual = source.getBoundingClientRect()
                    const expected = { x: r.left + (r.width - art.naturalWidth * fit) / 2 + art.naturalWidth * origin[0] * fit,
                      y: r.bottom - (art.naturalHeight - art.naturalHeight * origin[1]) * fit }
                    return { dx: actual.left - expected.x, dy: actual.top - expected.y }
                  })
                  results.push({ orb, events: events.length, sources })
                }
                return results
              }, { skin, origin: data.evokeOrigin })
              for (const evoke of evokes) {
                assert.equal(evoke.events, 2, 'real Dual Cast lost an evoke')
                assert.equal(evoke.sources.length, 2, 'evoke beam layer missing')
                assert(evoke.sources.every(source => Math.abs(source.dx) < 2 && Math.abs(source.dy) < 2), 'beam misses registered chest')
              }
            }
            // Repeated non-staged engine attacks retain only the latest painted actor.
            const latest = await page.evaluate(card => { const f = window.kratosFixture; f.attack(card); return f.attack(card) }, cards[0])
            await page.waitForFunction(({ skin, latest }) => Boolean(document.querySelector(`.character-attack--${skin}[data-attack-seq="${latest}"] .monogatari-pose--idle`)), { skin, latest })
            const queuedBodies = await page.locator('.character-attack__pose img').evaluateAll(images => images.filter(image => Number(getComputedStyle(image.parentElement).opacity) > .5).length)
            assert.equal(queuedBodies, 1, 'queued base attacks duplicate the skin body')
            // Same-authority replacement and reconnect erase stale animations, never gameplay state.
            await page.evaluate(() => { const f = window.kratosFixture; f.restoration++; f.render() })
            await page.waitForFunction(() => !document.querySelector('.character-attack'))
            await page.evaluate(card => { const f = window.kratosFixture; f.attack(card); f.connected = false; f.render() }, cards[0])
            await page.waitForFunction(() => !document.querySelector('.character-attack'))
            await page.evaluate(([character, skin]) => {
              const f = window.kratosFixture; f.reset(character, skin); f.state.players[0].dead = true; f.state.players[0].hp = 0; f.render()
            }, [character, skin])
            await page.locator(idle).evaluate(image => image.decode())
            assert((await page.locator(idle).getAttribute('src')).endsWith(`${skin}-hero.webp`), 'dead hero missing static skin')
            await page.evaluate(([character, skin]) => { document.documentElement.dataset.reducedMotion = 'true'; window.kratosFixture.reset(character, skin) }, [character, skin])
            await page.waitForFunction(skin => document.querySelector('.seat__portrait > img')?.src.endsWith(`${skin}-hero.webp`), skin)
            await page.locator(idle).evaluate(image => image.decode())
            const reduced = await page.evaluate(paintedKratosBounds, idle)
            for (const value of ['height', 'width', 'ground']) assert(Math.abs(reduced[value] - rest[value]) < 2, `reduced motion changed ${value}`)
            await page.evaluate(card => window.kratosFixture.attack(card), cards[0])
            assert.equal(await page.locator('.character-attack').count(), 0, 'reduced motion plays attack')
            await page.locator('.board').screenshot({ path: resolve(output, `${engine}-${screen}-${skin}-reduced.png`) })
            await page.close()
            const video = resolve(output, `${engine}-${screen}-${skin}.webm`)
            await page.video().saveAs(video)
            report.cases.push({ engine, screen, skin, cold, warm, evokes, queuedBodies, rest, reduced, video })
            console.log(`PASS ${engine}/${screen}/${skin}`)
          } finally { releaseCold?.(); await context.close() }
        }
      }
    } finally { await browser.close() }
  }
  assert.deepEqual(report.errors, [])
  writeFileSync(resolve(output, `report-${process.argv.find(arg => arg.startsWith('--engine='))?.split('=')[1] ?? 'all'}.json`), JSON.stringify(report, null, 2))
  console.log(`PASS: ${report.cases.length} Monogatari animation cold/warm/lifecycle cases; videos and report in ${output}`)
} finally { await server.close() }
