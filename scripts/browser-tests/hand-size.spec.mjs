import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url, hasTouch: false, isMobile: false })

test('hand-size', async ({ page, screen, appURL }) => {
  await startStandardCampaign(page, appURL)
  const run = postNeowRun(47, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const fixture = enterRoom(run, room)
  await page.evaluate(fixture => window.__STS_DEBUG__.setRun(fixture), fixture)
  const hand = page.locator('.hand-area .hand > .card').first()
  await hand.waitFor()
  const measure = () => hand.evaluate(card => ({
    actual: parseFloat(getComputedStyle(card).width),
    expected: Math.min(18.75 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      innerHeight * 0.278, innerWidth * 0.15625),
  }))
  const initial = await measure()
  assert(Math.abs(initial.actual - initial.expected) < 1, `${screen}: normal hand shrank: ${JSON.stringify(initial)}`)
  const stage = await page.evaluate(async () =>
    (await fetch('/src/ui/styles/painterly-combat-stage.css?direct')).text())
  await page.addStyleTag({ content: stage })
  const reordered = await measure()
  assert(Math.abs(reordered.actual - initial.actual) < 1,
    `${screen}: loading stage styles after hand styles changed card size: ${JSON.stringify(reordered)}`)
  console.log(`PASS ${screen}: normal hand stays ${initial.actual}px wide regardless of stage stylesheet order`)
})
