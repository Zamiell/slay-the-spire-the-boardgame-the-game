import { test } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

test.use({ appKey: import.meta.url })

test('hand-readability', async ({ page, screen, phone, appURL }) => {
  const out = resolve('artifacts/hand-readability')
  mkdirSync(out, { recursive: true })
  await page.goto(appURL)
  await page.evaluate(async () => {
    const [R, D, { Card }, { CARDS }] = await Promise.all([
      import('/@id/react'), import('/@id/react-dom/client'), import('/src/ui/Card.tsx'), import('/src/game/cards.ts'),
      import('/src/ui/styles.css'), import('/src/ui/chrome.css'),
    ])
    document.querySelector('#root').remove()
    const host = document.createElement('div')
    host.className = 'app-shell app-shell--combat sts-scope'
    document.body.append(host)
    const h = R.createElement ?? R.default.createElement
    const defs = ['Defend', 'Defend', 'Floatwork', 'Nightmare Guise', 'Strike'].map(name =>
      Object.values(CARDS).find(card => card.owner === 'hexaghost' && card.name === name))
    if (defs.some(def => !def)) throw Error('Missing Hexaghost hand fixture')
    ;(D.createRoot ?? D.default.createRoot)(host).render(h('div', { className: 'combat', style: { height: '100dvh' } },
      h('div', { className: 'hand-area', style: { position: 'absolute', bottom: 0, width: '100%' } },
        h('div', { className: 'hand-scroll' }, h('div', { className: 'hand', 'data-count': 5 },
          ...defs.map((def, index) => h(Card, { key: index, card: { uid: `read-${index}`, defId: def.id, upgraded: false }, fan: (index - 2) / 2, immediateArt: true })))))))
  })
  await page.locator('.hand .card').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.hand .card__art').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  assert.equal(await page.locator('.card__readable').count(), 0, 'keep original card faces without text overlays')
  const cards = page.locator('.hand .card')
  const dimensions = await cards.evaluateAll(cards => cards.map(card => {
    const { width, height } = getComputedStyle(card)
    const art = card.querySelector('.card__art')
    return { width: parseFloat(width), height: parseFloat(height), ratio: art.naturalHeight / art.naturalWidth }
  }))
  const bounds = await cards.evaluateAll(cards => cards.map(card => {
    const rect = card.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  }))
  const visible = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(bounds.every(rect => rect.left >= 0 && rect.right <= visible.width && rect.top >= 0 && rect.bottom <= visible.height), `${screen}: card faces clipped ${JSON.stringify(bounds)}`)
  await page.screenshot({ path: resolve(out, `${screen}.png`) })
  dimensions.forEach(size => {
    assert(size.width >= (phone ? 100 : 200), `${screen}: card faces must stay large enough to read`)
    assert(Math.abs(size.height / size.width - size.ratio) < .01, 'hand cards must preserve their scanned aspect ratio')
  })
  console.log(`PASS ${screen}: readable original faces, preserved aspect ratios, no clipping`)
})
