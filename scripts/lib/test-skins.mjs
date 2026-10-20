// Browser verifiers that need more skins than the repo registers run the REAL app with extra synthetic skins, without touching production source:
//
//   import { testSkinsPlugin, installTestSkins, TEST_SKINS } from './lib/test-skins.mjs'
//   await installTestSkins(TEST_SKINS)            // the verifier's own Node process (room server, wallet rules)
//   const vite = await createServer({ root, plugins: [testSkinsPlugin(TEST_SKINS, { assetsDir })] })
//
// The browser side appends a registration to the module text of the files that hold per-skin
// tables, so every production component sees the skins through `SKINS`, `SKIN_IDS`, `skinsOf`,
// `SKIN_PRICES`, ... The Node side applies the same registration to the modules this process
// imports, which is what the in-process room server and account wallets read; without it the
// server would drop a purchased synthetic skin as unknown. A skin the repo already registers
// is skipped, and a missing anchor throws, so a rename never silently turns the plugin off.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')
const SKINS_FILE = 'src/game/skins.ts'
const COINS_FILE = 'src/game/coins.ts'
const DEFAULT_TRAITS = { energyOrb: false, stagedAttack: false }
const DEFAULT_PRICE = 2500

/**
 * The default synthetic set: skins no hero ships, for layouts with more skins than the catalogue has
 * (a hero with two skins, a hero that has none in the catalogue).
 */
export const TEST_SKINS = [
  { id: 'extra_silent', character: 'silent', label: 'Extra' },
  { id: 'extra_defect', character: 'defect', label: 'Extra', price: 1234, traits: { energyOrb: true } },
  // A Downfall hero (a formation of Slimes, no ordinary deck): everything hero-keyed answers for a skin of it too.
  { id: 'extra_slime_boss', character: 'slime_boss', label: 'Extra', price: 4321 },
]

/** A skin with every field filled in; throws on a malformed one. */
function normalizeSkin(skin) {
  const { id, character, label, price = DEFAULT_PRICE, traits = DEFAULT_TRAITS } = skin
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`test skin id is invalid: ${JSON.stringify(id)}`)
  if (typeof character !== 'string' || typeof label !== 'string') throw new Error(`test skin ${id} needs a character and a label`)
  if (!Number.isInteger(price) || price <= 0) throw new Error(`test skin ${id} needs a positive integer price`)
  return { id, character, label, price, traits: { ...DEFAULT_TRAITS, ...traits } }
}

const normalizeAll = (skins) => {
  const list = skins.map(normalizeSkin)
  if (new Set(list.map((skin) => skin.id)).size !== list.length) throw new Error('test skin ids must be unique')
  return list
}

/**
 * Registers skins into the tables of `skins.ts`. Runs in the browser (appended to the module)
 * and in Node (`installTestSkins`), so it has no imports and touches only the given tables.
 */
function registerSkins(list, t) {
  const registered = new Set(Object.values(t.SKINS).flat())
  const added = list.filter((skin) => !registered.has(skin.id))
  for (const skin of added) {
    if (!t.CHARACTER_IDS.includes(skin.character)) throw new Error(`test skin ${skin.id}: unknown character ${skin.character}`)
    t.SKINS[skin.character] = [...(t.SKINS[skin.character] ?? []), skin.id]
    t.SKIN_LABELS[skin.id] = skin.label
    t.SKIN_TRAITS[skin.id] = skin.traits
  }
  // Catalogue order: real skins first, then the synthetic ones in list order.
  const ids = [...new Set(Object.values(t.SKINS).flat())]
  t.SKIN_IDS.splice(0, t.SKIN_IDS.length, ...ids)
  t.VISUAL_IDS.splice(0, t.VISUAL_IDS.length, ...t.CHARACTER_IDS, ...ids)
}

/** Prices every skin the table lacks (a skin the repo prices itself keeps that price). */
function registerPrices(list, prices) {
  for (const skin of list) if (!(skin.id in prices)) prices[skin.id] = skin.price
}

const load = (file) => import(pathToFileURL(join(ROOT, file)).href)

/** Node side: the registry modules this process imports (the room server, wallet rules and the verifier itself). */
export async function installTestSkins(skins = TEST_SKINS) {
  const list = normalizeAll(skins)
  const [skinModule, coinModule] = await Promise.all([
    load(SKINS_FILE), load(COINS_FILE),
  ])
  registerSkins(list, {
    CHARACTER_IDS: (await load('src/game/types.ts')).CHARACTER_IDS,
    SKINS: skinModule.SKINS, SKIN_IDS: skinModule.SKIN_IDS, VISUAL_IDS: skinModule.VISUAL_IDS,
    SKIN_LABELS: skinModule.SKIN_LABELS, SKIN_TRAITS: skinModule.SKIN_TRAITS,
  })
  registerPrices(list, coinModule.SKIN_PRICES)
}

const declared = (code, name, file) => {
  if (!new RegExp(`\\b(?:const|let) ${name}\\b`).test(code)) {
    throw new Error(`test-skins: ${file} has no "${name}" declaration; update scripts/lib/test-skins.mjs`)
  }
}

/** The text appended to a module: `body` runs after every declaration of the file. */
const appendix = (code, body) => `${code}\n;{\n${body}\n}\n`

const registryAppendix = (code, list) => {
  for (const name of ['SKINS', 'SKIN_IDS', 'VISUAL_IDS', 'SKIN_LABELS', 'SKIN_TRAITS']) declared(code, name, SKINS_FILE)
  if (!/\bCHARACTER_IDS\b/.test(code)) throw new Error(`test-skins: ${SKINS_FILE} does not use CHARACTER_IDS`)
  return appendix(code, `const registerSkins = ${registerSkins}
registerSkins(${JSON.stringify(list)}, { CHARACTER_IDS, SKINS, SKIN_IDS, VISUAL_IDS, SKIN_LABELS, SKIN_TRAITS })`)
}

const pricesAppendix = (code, list) => {
  declared(code, 'SKIN_PRICES', COINS_FILE)
  return appendix(code, `const registerPrices = ${registerPrices}
registerPrices(${JSON.stringify(list)}, SKIN_PRICES)`)
}

/** A scratch directory under ~/.cache/task-tmp (never the RAM-backed /tmp); `remove()` deletes it. */
export function scratchDir(prefix) {
  const base = process.env.TMPDIR || join(homedir(), '.cache/task-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, `${prefix}-`))
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * A scratch `assetsDir` holding a character-select portrait and wallpaper for every skin (copies of its
 * hero's), so the Shop, Profile and character select of a synthetic skin load real images. Call `remove()`
 * when the run ends.
 */
export function syntheticPortraits(skins = TEST_SKINS) {
  const scratch = scratchDir('test-skin-portraits')
  const folder = join(scratch.dir, 'menu/character-select')
  mkdirSync(folder, { recursive: true })
  for (const { id, character } of normalizeAll(skins)) {
    const source = join(ROOT, 'public/assets/menu/character-select')
    copyFileSync(join(source, `portrait-${character}.png`), join(folder, `portrait-${id}.png`))
    copyFileSync(join(source, `character-${character}-wallpaper.webp`), join(folder, `character-${id}-wallpaper.webp`))
  }
  return scratch
}

const MIME = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css',
}

/**
 * A Vite plugin (dev server only). `assetsDir` serves `/assets/<path>` from that directory first
 * when the file exists there, for synthetic poses and art; everything else falls through.
 */
export function testSkinsPlugin(skins = TEST_SKINS, { assetsDir } = {}) {
  const list = normalizeAll(skins)
  const edits = new Map([
    [join(ROOT, SKINS_FILE), (code) => registryAppendix(code, list)],
    [join(ROOT, COINS_FILE), (code) => pricesAppendix(code, list)],
  ])
  const base = assetsDir === undefined ? undefined : resolve(assetsDir)
  return {
    name: 'test-skins',
    enforce: 'pre',
    apply: 'serve',
    transform(code, id) {
      const path = normalize(id.split('?')[0])
      const edit = edits.get(path)
      if (!edit) return null
      return { code: edit(code), map: null }
    },
    configureServer(server) {
      if (base === undefined) return
      if (!existsSync(base) || !statSync(base).isDirectory()) throw new Error(`test-skins: assetsDir ${base} is not a directory`)
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]
        if (!path.startsWith('/assets/') || (request.method !== 'GET' && request.method !== 'HEAD')) return next()
        let file
        try { file = resolve(base, decodeURIComponent(path.slice('/assets/'.length))) } catch { return next() }
        if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) return next()
        response.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
        response.setHeader('Cache-Control', 'no-store')
        response.end(request.method === 'HEAD' ? undefined : readFileSync(file))
      })
    },
  }
}
