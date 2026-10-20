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
import { SKINS } from '../src/game/skins.ts'
import { SKIN_PRICES } from '../src/game/coins.ts'

const root = resolve(import.meta.dirname, '..')
const scratch = scratchDir('test-skins-smoke')
const assetsDir = scratch.dir
mkdirSync(join(assetsDir, 'combat/characters'), { recursive: true })
writeFileSync(join(assetsDir, 'combat/characters/synthetic.txt'), 'synthetic pose')
const skins = TEST_SKINS
// What the registry holds without the synthetic skins (this process has not installed them yet), and what it must hold with them:
// an extra skin joins its hero's list, or opens a new hero at the end, exactly as `registerSkins` does.
const real = { skins: Object.fromEntries(Object.entries(SKINS).map(([hero, list]) => [hero, [...list]])), prices: { ...SKIN_PRICES } }
const expected = { skins: { ...real.skins }, prices: { ...real.prices } }
for (const { id, character, price = 2500 } of skins) {
  expected.skins[character] = [...(expected.skins[character] ?? []), id]
  expected.prices[id] = price
}
const expectedIds = Object.values(expected.skins).flat()
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
    const synthetic = ['extra_silent', 'extra_defect', 'extra_slime_boss']
    const bought = wallet.buySkin({ ...wallet.createWallet(), coins: 5000 }, 'extra_defect')
    return {
      ids: [...registry.SKIN_IDS], visual: [...registry.VISUAL_IDS],
      lists: Object.fromEntries(['ironclad', 'silent', 'defect', 'watcher', 'slime_boss'].map((hero) => [hero, [...registry.skinsOf(hero)]])),
      ironcladOnly: registry.isSkinOf('ironclad', 'extra_silent'),
      labels: Object.fromEntries(synthetic.concat('kratos').map((id) => [id, registry.SKIN_LABELS[id]])),
      traits: Object.fromEntries(synthetic.concat('kratos').map((id) => [id, registry.SKIN_TRAITS[id]])),
      staged: synthetic.map((id) => registry.hasStagedAttack(id)), characters: synthetic.map((id) => registry.characterOfSkin(id)),
      prices: Object.fromEntries(Object.keys(coins.SKIN_PRICES).map((id) => [id, coins.SKIN_PRICES[id]])),
      visualOf: [registry.visualId('silent', 'extra_silent'), registry.visualId('watcher', 'extra_silent'), registry.visualId('slime_boss', 'extra_slime_boss')],
      normalized: registry.normalizeSkins(['extra_defect', 'nope', 'kratos', 'monogatari_silent', 'extra_slime_boss']),
      bought: bought.ok ? bought.wallet.skins : bought.reason,
      vfx: [vfx.cardVfxRecipe('extra_silent', 'strike_silent'), vfx.cardVfxRecipe('silent', 'strike_silent'),
        vfx.cardVfxRecipe('extra_slime_boss', 'slime_boss_strike'), vfx.cardVfxRecipe('slime_boss', 'slime_boss_strike')],
      asset: await (await fetch('/assets/combat/characters/synthetic.txt')).text(),
      realAsset: (await fetch('/assets/combat/characters/kratos-hero.webp', { method: 'HEAD' })).headers.get('content-type'),
    }
  })
  assert.deepEqual(seen.ids, expectedIds)
  assert.deepEqual(seen.visual.slice(-seen.ids.length), seen.ids)
  assert.deepEqual(seen.lists, Object.fromEntries(Object.keys(seen.lists).map((hero) => [hero, expected.skins[hero] ?? []])))
  assert.equal(seen.ironcladOnly, false)
  assert.deepEqual(seen.labels, { extra_silent: 'Extra', extra_defect: 'Extra', extra_slime_boss: 'Extra', kratos: 'Kratos' })
  assert.deepEqual(seen.traits.kratos, { energyOrb: true, stagedAttack: true })
  assert.deepEqual(seen.traits.extra_silent, { energyOrb: false, stagedAttack: false })
  assert.deepEqual(seen.traits.extra_defect, { energyOrb: true, stagedAttack: false })
  assert.deepEqual(seen.staged, [false, false, false])
  assert.deepEqual(seen.characters, ['silent', 'defect', 'slime_boss'])
  assert.deepEqual(seen.prices, expected.prices)
  assert.deepEqual(seen.visualOf, ['extra_silent', 'watcher', 'extra_slime_boss'])
  assert.deepEqual(seen.normalized, expectedIds.filter((id) => ['extra_defect', 'kratos', 'monogatari_silent', 'extra_slime_boss'].includes(id)))
  assert.deepEqual(seen.bought, ['extra_defect'])
  assert.deepEqual(seen.vfx[0], seen.vfx[1], 'a skin shows its hero\'s combat VFX')
  assert.deepEqual(seen.vfx[2], seen.vfx[3], 'a skin of a Downfall hero shows its hero\'s combat VFX')
  assert.equal(seen.asset, 'synthetic pose')
  assert.match(seen.realAsset ?? '', /image\/webp/)
  assert.deepEqual(errors, [])

  // The Node side (room server, wallet rules) sees the same registry.
  await installTestSkins(skins)
  const registry = await import('../src/game/skins.ts')
  const coins = await import('../src/game/coins.ts')
  assert.deepEqual([...registry.SKIN_IDS], seen.ids)
  assert.equal(coins.SKIN_PRICES.extra_defect, 1234)
  assert.equal(coins.SKIN_PRICES.extra_slime_boss, 4321)
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
