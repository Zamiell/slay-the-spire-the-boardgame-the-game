#!/usr/bin/env node
// lib/test-skins.mjs registers synthetic skins into the real app. This proves the helper
// itself, in a real page and in this Node process: the registry, prices, labels, traits and the
// hero-keyed combat tables answer for the extra skins; a skin the repo already registers is left
// alone; a moved anchor fails loudly; and `assetsDir` serves synthetic art ahead of the real assets.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { installTestSkins, scratchDir, syntheticPortraits, testSkinsPlugin, TEST_SKINS } from './lib/test-skins.mjs'

const root = resolve(import.meta.dirname, '..')
const scratch = scratchDir('test-skins-smoke')
const assetsDir = scratch.dir
mkdirSync(join(assetsDir, 'combat/characters'), { recursive: true })
writeFileSync(join(assetsDir, 'combat/characters/synthetic.txt'), 'synthetic pose')
const skins = TEST_SKINS
const vite = await createServer({ root, logLevel: 'silent', plugins: [testSkinsPlugin(skins, { assetsDir })], server: { host: '127.0.0.1', port: 0 } })
await vite.listen()
const address = vite.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('vite did not report a port')
const url = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch()
const errors = []
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.locator('.start-menu__nav').waitFor({ timeout: 90_000 })
  const seen = await page.evaluate(async () => {
    const registry = await import('/src/game/skins.ts')
    const coins = await import('/src/game/coins.ts')
    const vfx = await import('/src/ui/combat-vfx.ts')
    const wallet = await import('/src/wallet.ts')
    const synthetic = ['extra_silent', 'extra_defect']
    const bought = wallet.buySkin({ ...wallet.createWallet(), coins: 5000 }, 'extra_defect')
    return {
      ids: [...registry.SKIN_IDS], visual: [...registry.VISUAL_IDS],
      silent: [...registry.skinsOf('silent')], watcher: [...registry.skinsOf('watcher')], ironclad: [...registry.skinsOf('ironclad')],
      defect: [...registry.skinsOf('defect')], ironcladOnly: registry.isSkinOf('ironclad', 'extra_silent'),
      labels: Object.fromEntries(synthetic.concat('kratos').map((id) => [id, registry.SKIN_LABELS[id]])),
      traits: Object.fromEntries(synthetic.concat('kratos').map((id) => [id, registry.SKIN_TRAITS[id]])),
      staged: synthetic.map((id) => registry.hasStagedAttack(id)), character: registry.characterOfSkin('extra_silent'),
      prices: Object.fromEntries(Object.keys(coins.SKIN_PRICES).map((id) => [id, coins.SKIN_PRICES[id]])),
      visualOf: [registry.visualId('silent', 'extra_silent'), registry.visualId('watcher', 'extra_silent')],
      normalized: registry.normalizeSkins(['extra_defect', 'nope', 'kratos', 'monogatari_silent']),
      bought: bought.ok ? bought.wallet.skins : bought.reason,
      vfx: [vfx.cardVfxRecipe('extra_silent', 'strike_silent'), vfx.cardVfxRecipe('silent', 'strike_silent')],
      asset: await (await fetch('/assets/combat/characters/synthetic.txt')).text(),
      realAsset: (await fetch('/assets/combat/characters/kratos-hero.webp', { method: 'HEAD' })).headers.get('content-type'),
    }
  })
  assert.deepEqual(seen.ids, ['kratos', 'monogatari_ironclad', 'monogatari_silent', 'extra_silent', 'monogatari_defect', 'extra_defect', 'monogatari_watcher'])
  assert.deepEqual(seen.visual.slice(-seen.ids.length), seen.ids)
  assert.deepEqual([seen.silent, seen.watcher, seen.ironclad, seen.defect],
    [['monogatari_silent', 'extra_silent'], ['monogatari_watcher'], ['kratos', 'monogatari_ironclad'], ['monogatari_defect', 'extra_defect']])
  assert.equal(seen.ironcladOnly, false)
  assert.deepEqual(seen.labels, { extra_silent: 'Extra', extra_defect: 'Extra', kratos: 'Kratos' })
  assert.deepEqual(seen.traits.kratos, { energyOrb: true, stagedAttack: true })
  assert.deepEqual(seen.traits.extra_silent, { energyOrb: false, stagedAttack: false })
  assert.deepEqual(seen.traits.extra_defect, { energyOrb: true, stagedAttack: false })
  assert.deepEqual(seen.staged, [false, false])
  assert.equal(seen.character, 'silent')
  assert.deepEqual(seen.prices, { kratos: 2500, monogatari_ironclad: 2500, monogatari_silent: 2500, monogatari_defect: 2500, monogatari_watcher: 2500,
    extra_silent: 2500, extra_defect: 1234 })
  assert.deepEqual(seen.visualOf, ['extra_silent', 'watcher'])
  assert.deepEqual(seen.normalized, ['kratos', 'monogatari_silent', 'extra_defect'])
  assert.deepEqual(seen.bought, ['extra_defect'])
  assert.deepEqual(seen.vfx[0], seen.vfx[1], 'a skin shows its hero\'s combat VFX')
  assert.equal(seen.asset, 'synthetic pose')
  assert.match(seen.realAsset ?? '', /image\/webp/)
  assert.deepEqual(errors, [])

  // The Node side (room server, wallet rules) sees the same registry.
  await installTestSkins(skins)
  const registry = await import('../src/game/skins.ts')
  const coins = await import('../src/game/coins.ts')
  assert.deepEqual([...registry.SKIN_IDS], seen.ids)
  assert.equal(coins.SKIN_PRICES.extra_defect, 1234)
  await installTestSkins(skins)
  assert.deepEqual([...registry.SKIN_IDS], seen.ids, 'installing twice must not duplicate skins')
  await installTestSkins([{ id: 'kratos', character: 'ironclad', label: 'Other', price: 1 }])
  assert.equal(registry.SKIN_LABELS.kratos, 'Kratos', 'a skin the repo registers keeps its own entries')
  assert.equal(coins.SKIN_PRICES.kratos, 2500)

  // A skin the repo already registers is skipped, and a moved anchor throws.
  const plugin = testSkinsPlugin([{ id: 'kratos', character: 'ironclad', label: 'Other' }])
  const skinsFile = join(root, 'src/game/skins.ts')
  const body = readFileSync(skinsFile, 'utf8')
  assert.match(plugin.transform(body, skinsFile).code, /registerSkins\(\[\{"id":"kratos"/)
  assert.throws(() => plugin.transform('export const OTHER = 1', skinsFile), /no "SKINS" declaration/)
  assert.throws(() => plugin.transform('export const OTHER = 1', join(root, 'src/game/coins.ts')), /SKIN_PRICES/)
  assert.throws(() => testSkinsPlugin([{ id: 'x', character: 'silent', label: 'X' }, { id: 'x', character: 'watcher', label: 'X' }]), /unique/)
  const portraits = syntheticPortraits()
  try {
    assert.equal(readFileSync(join(portraits.dir, 'menu/character-select/portrait-extra_silent.png')).equals(
      readFileSync(join(root, 'public/assets/menu/character-select/portrait-silent.png'))), true)
  } finally { portraits.remove() }
  assert.equal(plugin.transform('const x = 1', join(root, 'src/game/rng.ts')), null)
  console.log('verify-test-skins-browser: ok')
} finally {
  await browser.close()
  await vite.close()
  scratch.remove()
}
