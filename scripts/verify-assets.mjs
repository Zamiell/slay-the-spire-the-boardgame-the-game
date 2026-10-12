// Every card the engine knows must resolve to an image that exists on disk, and
// every image path must be a safe, normalised browser path. A missing asset is
// otherwise invisible until it renders as a broken box in a real game.
//
// Publisher card scans and reference crops remain optional local syncs.
// Runtime icons, illustrations, and combat cutouts are committed and required
// by the unconditional inventories below.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { CARDS, faceOf } from '../src/game/cards.ts'
import '../src/game/downfall/slime-boss.ts'
import {
  cardArtPath,
  cardImagePath,
  cardThumbPath,
  enemyAnimationImagePath,
  campfireScenePath,
  enemyImagePath,
  relicIconPath,
  CARD_ART_ROOT,
  CARD_ASSET_ROOT,
  CARD_THUMB_ROOT,
  SKIN_CARD_ART_ROOT,
  SKIN_CARD_ROOT,
  SKIN_CARD_THUMB_ROOT,
  SOCKETED_CARD_THUMB_ROOT,
} from '../src/game/assets.ts'
import { ENEMIES } from '../src/game/enemies.ts'
import { CHARACTER_IDS } from '../src/game/types.ts'
import { SKINS, SKIN_IDS, VISUAL_IDS, SKIN_TRAITS } from '../src/game/skins.ts'
import { POTIONS, RELICS } from '../src/game/relics.ts'
import {
  bossProjectileImagePath,
} from '../src/ui/combat-vfx.ts'
import { DOWNFALL_COLORLESS_CARD_DEFS } from '../src/game/downfall/items.ts'
// From the data module, NOT from sync-enemy-art.mjs: importing that script runs
// the extraction pipeline, which regenerated the very portraits this file
// checks for — so the check asserted its own side effect and could never fail.
import { ENEMY_ART } from './lib/enemy-art.mjs'
import { webpSize } from './lib/webp-size.mjs'
import { skinCardFaces } from './sync-skin-card-faces.mjs'
import { scratchDir } from './lib/test-skins.mjs'
import { campfireScenes } from './sync-campfire-scenes.mjs'
import { CAMPFIRE_SCENES } from '../src/game/campfire-scenes.ts'
import { SKIN_CARD_FACES } from '../src/game/skin-card-faces.ts'
import { STAGED_ATTACKS, STAGED_SOUND_VOLUMES } from '../src/ui/combat-screen/staged-attacks.ts'
import { suite, check, assert, assertDeepEqual, assertEqual, report } from './lib/harness.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(repoRoot, 'public')

const listing = (dir, extension) =>
  existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(extension)) : []

const cardRoot = join(publicRoot, 'assets/cards')
const cardThumbRoot = join(publicRoot, 'assets/cards-sm')
const socketedCardThumbRoot = join(publicRoot, 'assets/cards-socketed-sm')
const cardArtRoot = join(publicRoot, 'assets/card-art')
const iconRoot = join(publicRoot, 'assets/icons')
const enemyRoot = join(publicRoot, 'assets/enemies')
const combatEnemyRoot = join(publicRoot, 'assets/combat/enemies')
const combatRiggedRoot = join(publicRoot, 'assets/combat/rigged')
const bossAnimationRoot = join(combatEnemyRoot, 'animations')
const bossProjectileRoot = join(combatEnemyRoot, 'projectiles')
const combatCharacterRoot = join(publicRoot, 'assets/combat/characters')
const combatSlimeRoot = join(publicRoot, 'assets/combat/slimes')
const merchantCharacterRoot = join(publicRoot, 'assets/noncombat/merchant/characters')
const combatVfxRoot = join(publicRoot, 'assets/combat/vfx')
const combatActionVfxRoot = join(combatVfxRoot, 'actions')
const combatPileRoot = join(publicRoot, 'assets/combat/piles')
const combatStageRoot = join(publicRoot, 'assets/combat')
const statusIconRoot = join(publicRoot, 'assets/status-icons')
const powerIconRoot = join(publicRoot, 'assets/power-icons')
const relicIconRoot = join(publicRoot, 'assets/relic-icons')
const potionIconRoot = join(publicRoot, 'assets/potion-icons')
const menuRoot = join(publicRoot, 'assets/menu')
const compendiumIconRoot = join(menuRoot, 'compendium-icons')
const campfireRoot = join(publicRoot, 'assets/noncombat/campfire')
const fontRoot = join(publicRoot, 'assets/fonts')
const sfxRoot = join(publicRoot, 'assets/sfx')

const cardFiles = listing(cardRoot, '.webp')
const cardThumbFiles = listing(cardThumbRoot, '.webp')
const socketedCardThumbFiles = listing(socketedCardThumbRoot, '.webp')
// Per-hero art is keyed by visual id (VISUAL_IDS): every character, plus every skin
// (which wears a character's slot with its own art, named by the skin id).
const CARD_ART_OWNERS = ['ironclad', 'silent', 'defect', 'watcher']
const DOWNFALL_CARD_OWNERS = ['slime_boss', 'guardian', 'hexaghost', 'hermit']
const cardArtFiles = CARD_ART_OWNERS.flatMap((owner) =>
  listing(join(cardArtRoot, owner), '.webp').map((file) => `${owner}/${file}`))
const iconFiles = listing(iconRoot, '.png')
const enemyFiles = listing(enemyRoot, '.webp')
const combatEnemyFiles = listing(combatEnemyRoot, '.webp')
const combatRiggedFiles = listing(combatRiggedRoot, '.webp')
const combatRiggedVideoFiles = listing(combatRiggedRoot, '.mov')
const bossAnimationFiles = listing(bossAnimationRoot, '.webp')
const bossProjectileFiles = listing(bossProjectileRoot, '.webp')
const combatCharacterFiles = listing(combatCharacterRoot, '.webp')
const combatSlimeFiles = listing(combatSlimeRoot, '.webp')
const merchantCharacterFiles = listing(merchantCharacterRoot, '-standing.webp')
const combatVfxFiles = listing(combatVfxRoot, '.webp')
const combatActionVfxFiles = listing(combatActionVfxRoot, '.webp')
const combatPileFiles = listing(combatPileRoot, '.webp')
const statusIconFiles = listing(statusIconRoot, '.png')
const powerIconFiles = listing(powerIconRoot, '.png')
const relicIconFiles = listing(relicIconRoot, '.png')
// The official prototype's Hexaghost starting component is unlabeled and has
// no publisher icon. A locally generated placeholder may exist, but runtime
// correctness and clean-clone verification must not depend on it.
const optionalRelicIconFiles = new Set(['hexaghost_starting_relic.png'])
const requiredRelicIconFiles = relicIconFiles.filter((file) => !optionalRelicIconFiles.has(file))
const potionIconFiles = listing(potionIconRoot, '.png')
const compendiumIconFiles = listing(compendiumIconRoot, '.webp')
const campfireSceneFiles = [...listing(campfireRoot, '_firecamp.png'), ...listing(campfireRoot, '_firecamp.webp')]

const SLIME_ASSET_SLUGS = [
  'armored', 'bruiser', 'evolution', 'leeching', 'massive', 'muscle', 'psychic',
  'royal', 'scrappy', 'spike', 'spreading', 'sticky', 'taunting',
]

const cardIndex = JSON.parse(readFileSync(join(repoRoot, 'data/card-index.json'), 'utf8'))

/**
 * Longest-edge [floor, cap] in pixels for the runtime art below, as
 * `[floor, cap]` pairs.
 *
 * The cap matters as much as the floor. Decoded image memory is width x height
 * x 4 bytes regardless of how small the element is on screen, and iOS Safari
 * evicts and re-decodes under pressure — which is a stutter, not a slow load.
 * A 1326x1187 pile icon painted into a 41px box cost 6 MB of texture to draw
 * 41 pixels; the combat screen alone held 59 MB that way. Each cap below is
 * the widest CSS box the asset is ever painted into, times three for a
 * DPR-3 screen, rounded up to a power of two.
 *
 *   pile stacks / current deck  .pile__stack, 2.55rem       -> 41 CSS px
 *   enemy cutouts               .enemy__portrait             -> 146 CSS px
 *   die faces                   Icon size={26}               -> 26 CSS px
 *
 * The enemy figure is measured, not read off a rule: `.row__enemies` declares
 * `minmax(190px, 250px)` columns, but a later unconditional
 * `.row__enemies { display: contents }` takes the enemies out of that grid, so
 * the portrait is sized by `.enemy` under `.board` instead. Measured at 146 CSS
 * px across seven viewports from 900x600 to 3440x1440 and one to four enemies.
 *
 * Character cutouts keep their full resolution: the character-select hero
 * paints one at `max-height: 62vh`.
 */
const PILE_ICON_EDGE = [160, 256]
const ENEMY_CUTOUT_EDGE = [256, 1024]
const BOSS_ELITE_CUTOUT_EDGE = [256, 1024]
/** Only the `-hero` pair, painted by the character-select and Neow scenes. */
const CHARACTER_HERO_EDGE = [700, 1536]
/** Every other character cutout: combat seats, roster thumbs, lobby seats. */
const CHARACTER_CUTOUT_EDGE = [256, 1024]
const MERCHANT_CHARACTER_EDGE = [256, 576]
const DIE_ICON_EDGE = 128
/** Matches THUMB_WIDTH in scripts/sync-card-assets.mjs. */
const CARD_THUMB_WIDTH = 448

/** Every icon name Icon.tsx can render. */
const REQUIRED_ICONS = [
  'attack', 'block', 'strength', 'vulnerable', 'weak', 'poison', 'daze', 'burn',
  'shiv', 'miracle', 'energy', 'potion', 'gold', 'relic', 'elite', 'monster',
  'boss', 'aoe', 'die1', 'die2', 'die3', 'die4', 'die5', 'die6',
]

suite('assets')

check('every rigged animation has a current Safari hardware-video companion', () => {
  const manifestPath = join(repoRoot, 'scripts/animation/safari-video-sources.json')
  assert(existsSync(manifestPath), 'missing Safari animation manifest; run pnpm sync:combat-video')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const expected = combatRiggedFiles.map((file) => `public/assets/combat/rigged/${file}`).sort()
  assertDeepEqual(Object.keys(manifest).sort(), expected, 'Safari animation source inventory')
  assertDeepEqual(combatRiggedVideoFiles.sort(), combatRiggedFiles.map((file) => file.replace(/\.webp$/, '.mov')).sort(),
    'Safari animation video inventory')
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  for (const relative of expected) {
    const source = join(repoRoot, relative)
    const video = source.replace(/\.webp$/, '.mov')
    assertEqual(manifest[relative].encoder, 'hevc-alpha-vfr-q100-v1', `${relative} Safari encoder`)
    assertEqual(manifest[relative].source, hash(source), `${relative} Safari source hash`)
    assertEqual(manifest[relative].video, hash(video), `${relative} Safari video hash`)
  }
})

check('every campfire party resolves to one complete wide scene', () => {
  // A party is a set of visual ids (one to four): a hero's character id or its skin ids, never a character beside
  // its own skin. Skins sort after the characters.
  const heroOf = (id) => Object.entries(SKINS).find(([, list]) => list.includes(id))?.[0] ?? id
  const choose = (pool, size) => size === 0 ? [[]]
    : pool.flatMap((id, index) => choose(pool.slice(index + 1), size - 1).map((rest) => [id, ...rest]))
  const parties = (pool, sizes) => sizes.flatMap((size) => choose(pool, size))
    .filter((party) => party.every((id) => !SKIN_IDS.includes(id) || !party.includes(heroOf(id))))
  const named = (party) => VISUAL_IDS.filter((id) => party.includes(id)).join('_')
  const legal = new Map(parties(VISUAL_IDS, [1, 2, 3, 4]).map((party) => [named(party), party]))
  const listed = campfireScenes()
  assertDeepEqual(CAMPFIRE_SCENES, listed, 'src/game/campfire-scenes.ts is stale; run node scripts/sync-campfire-scenes.mjs')
  assertDeepEqual(listed.filter((name) => !legal.has(name)), [], 'campfire scenes no party can use')
  assertDeepEqual([...legal.keys()].filter((name) => !listed.includes(name)).sort(), [],
    'campfire scenes missing for a registered party')
  for (const [name, party] of legal) {
    const scene = campfireScenePath(party).split('/').pop().replace(/_firecamp\.webp$/, '')
    assert(scene === 'empty' || listed.includes(scene), `${name} resolves to a missing scene`)
  }
  const scenes = [...listed, 'empty'].map((name) => `${name}_firecamp.webp`)
  assertDeepEqual(campfireSceneFiles.sort(), scenes.sort(), 'campfire scenes must be WebP files named <party>_firecamp.webp')
  for (const file of scenes) {
    const info = spawnSync('webpinfo', ['-summary', join(campfireRoot, file)], { encoding: 'utf8' })
    assert(info.status === 0 && /Width: 3840[\s\S]*Height: 2161/.test(info.stdout), `${file} is not 3840x2161 WebP`)
  }
  // A repository budget, not a hosting limit: Pages never carries these scenes (the deploy deletes them from dist and
  // `assetPath` serves them from the SHA-pinned raw origin), so the cap only keeps clones and the raw origin lean.
  // It keeps the original 227-scene catalogue's byte budget per scene as skins add parties.
  assert(scenes.reduce((bytes, file) => bytes + statSync(join(campfireRoot, file)).size, 0) < 128 * 1024 * 1024 * scenes.length / 227,
    'campfire scenes exceed the original per-scene byte budget')
})

check('fresh campfires use original empty and character inputs and retain their native resolution', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'docs/skins/fresh-campfires/manifest.json'), 'utf8'))
  const expected = campfireScenes().filter((name) => /(^|_)monogatari_(silent|watcher)($|_)/.test(name)
    || /(^|_)guardian($|_)/.test(name) && /(^|_)monogatari_(ironclad|defect)($|_)/.test(name)).sort()
  assertDeepEqual(manifest.scenes.map((entry) => entry.scene).sort(), expected, 'fresh campfire provenance inventory')
  const result = spawnSync('python3', ['scripts/art/export-fresh-campfires.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || result.stdout)
})

check('sound effects are complete, compact, and decodable', () => {
  const expected = [
    'attack.ogg', 'block.ogg', 'card.ogg', 'defeat.ogg', 'draw.ogg', 'enemy-hit.ogg',
    'heal.ogg', 'magic.ogg', 'player-hit.ogg', 'ui.ogg', 'victory.ogg', 'weak.ogg',
    'gunshot.mp3', 'bullet-impact.mp3', 'meteor-fall.mp3', 'meteor-impact.mp3',
    'sword-swing.mp3', 'sword-clash.mp3', 'lightning-burst.mp3', 'dark-beam.mp3',
    'frost-bloom.mp3', 'flame-burst.mp3', 'slime-splat.mp3', 'poison-hiss.mp3',
    ...Object.keys(STAGED_SOUND_VOLUMES).map((sound) => `${sound}.mp3`),
  ].sort()
  assertDeepEqual([...listing(sfxRoot, '.ogg'), ...listing(sfxRoot, '.mp3')].sort(), expected)
  const files = expected.map((file) => join(sfxRoot, file))
  for (const file of files) {
    const result = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ], { encoding: 'utf8' })
    assert(result.status === 0 && Number(result.stdout) > 0, result.stderr || `${file} did not decode`)
  }
  assert(files.reduce((bytes, file) => bytes + statSync(file).size, 0) < 512 * 1024,
    'sound effects exceed 512 KiB')
})

check('every character card has exactly one committed illustration', () => {
  // Slayer Pack cards ship only their full scans; there is no text-free illustration for them.
  const expected = Object.values(CARDS)
    .filter((def) => CARD_ART_OWNERS.includes(def.owner) && !def.pack)
    .map((def) => `${def.owner}/${def.id}.webp`)
    .sort()
  // The bundled inventory already contains the pending Watcher batch. Keep its
  // assets through branch composition, while still rejecting unknown IDs.
  const indexed = new Set(cardIndex
    .filter((entry) => CARD_ART_OWNERS.some((owner) => entry.tier.startsWith(`${owner}/`)))
    .map((entry) => {
      const owner = entry.tier.split('/')[0]
      const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
      const id = entry.name === 'Strike' ? `strike_${owner}` : entry.name === 'Defend' ? `defend_${owner}` : slug
      return `${owner}/${id}.webp`
    }))
  assertDeepEqual(expected.filter((file) => !cardArtFiles.includes(file)), [], 'live card art missing')
  assertDeepEqual(cardArtFiles.filter((file) => !indexed.has(file)), [], 'unknown bundled card art')
  assertEqual(cardArtFiles.length, 251, 'complete original-hero illustration inventory')
})

check('committed card illustrations decode at the audited size and budget', () => {
  const files = cardArtFiles.map((file) => join(cardArtRoot, file))
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect committed card illustrations')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded illustration count')
  const faults = inspected.flatMap((block) => {
    const file = block.slice(0, block.indexOf('\n')).split('/').slice(-2).join('/')
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    const height = Number(block.match(/  Height: (\d+)/)?.[1])
    return width === 748 && height === 420 ? [] : [`${file} is ${width}x${height}`]
  })
  assertDeepEqual(faults, [], 'illustration dimensions')
  const sizes = files.map((file) => statSync(file).size)
  assert(Math.max(...sizes) <= 60 * 1024, 'a committed illustration exceeds 60 KiB')
  assert(sizes.reduce((sum, bytes) => sum + bytes, 0) < 9 * 1024 * 1024, 'illustrations exceed 9 MiB')
})

// Per-skin provenance manifests (menu art and energy orb). Extend this table when a skin is registered:
// the check below fails until every registered skin has an entry.
const MENU_ART_MANIFESTS = {
  monogatari_ironclad: 'docs/monogatari-skins/noncombat-manifest.json',
  monogatari_defect: 'docs/monogatari-skins/noncombat-manifest.json',
  kratos: 'docs/skins/kratos-menu-art/manifest.json',
  monogatari_silent: 'docs/skins/monogatari_silent-art/manifest.json',
  monogatari_watcher: 'docs/skins/monogatari_watcher-art/manifest.json',
}

check('every skin has portrait, wallpaper and (with the energyOrb trait) energy orb art at the audited sizes', () => {
  assertDeepEqual(SKIN_IDS.filter((skin) => !Object.hasOwn(MENU_ART_MANIFESTS, skin)), [], 'MENU_ART_MANIFESTS needs an entry per skin')
  const skinPaths = SKIN_IDS.flatMap((skin) => [`character-select/portrait-${skin}.png`, `character-select/character-${skin}-wallpaper.webp`])
    .map((path) => join(menuRoot, path))
  const probe = `
from PIL import Image
import sys
for portrait_path, wallpaper_path in zip(sys.argv[1::2], sys.argv[2::2]):
    portrait = Image.open(portrait_path); portrait.load()
    wallpaper = Image.open(wallpaper_path); wallpaper.load()
    assert portrait.size == (256,384) and portrait.mode == 'RGB', portrait_path
    assert wallpaper.size == (1536,864) and wallpaper.mode == 'RGB', wallpaper_path
`
  const result = spawnSync('python3', ['-c', probe, ...skinPaths], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'skin menu exports did not decode at the audited sizes')
  const orbs = SKIN_IDS.map((skin) => [skin, join(publicRoot, 'assets/combat/energy-orbs', `${skin}.webp`)])
  for (const [skin, file] of orbs) {
    assertEqual(existsSync(file), SKIN_TRAITS[skin].energyOrb, `${skin} paints an energy orb exactly when its energyOrb trait says so`)
  }
  const painted = orbs.filter(([skin]) => SKIN_TRAITS[skin].energyOrb).map(([, file]) => file)
  if (painted.length === 0) return
  const info = spawnSync('webpinfo', ['-summary', ...painted], { encoding: 'utf8' })
  assert(info.status === 0, info.stderr || 'could not decode the skin energy orbs')
  const inspected = info.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, painted.length, 'decoded energy orb count')
  for (const block of inspected) {
    assert(/Width: 256[\s\S]*Height: 256/.test(block) && /Alpha:\s+1/.test(block), `${block.split('\n')[0]} must be a 256x256 transparent orb`)
  }
})

check('skin selected sources, prompts and ready-to-release menu exports match their provenance', () => {
  const verifyHash = ({ path, sha256 }) => {
    assert(!path.startsWith('/') && !path.split('/').includes('..'), 'unsafe provenance path')
    assertEqual(createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex'), sha256, path)
  }
  for (const skin of SKIN_IDS) {
    if (MENU_ART_MANIFESTS[skin].startsWith('docs/monogatari-skins/')) continue
    const manifest = JSON.parse(readFileSync(join(repoRoot, MENU_ART_MANIFESTS[skin]), 'utf8'))
    if (manifest.assets) {
      // Character-art manifests (the Monogatari skins): one entry per exported file, hashed source, prompt and output.
      const menu = manifest.assets.filter((entry) => entry.output.path.startsWith('public/assets/menu/'))
      assertDeepEqual(menu.map((entry) => entry.output.path).sort(), [
        `public/assets/menu/character-select/character-${skin}-wallpaper.webp`,
        `public/assets/menu/character-select/portrait-${skin}.png`,
      ], `${skin} menu provenance inventory`)
      for (const entry of manifest.assets) {
        for (const asset of [entry.source, entry.output, ...(entry.prompt ? [entry.prompt] : [])]) verifyHash(asset)
        for (const reference of entry.references) assert(reference.sha256 && (reference.path || reference.description), `${skin}: ${entry.name} reference`)
      }
      assertEqual(manifest.assets.some((entry) => entry.output.path === `public/assets/combat/energy-orbs/${skin}.webp`), SKIN_TRAITS[skin].energyOrb,
        `${skin} documents its energy orb exactly when its energyOrb trait says so`)
      continue
    }
    assertDeepEqual(manifest.otherAssets.map((entry) => entry.output.path).sort(), [
      `public/assets/menu/character-select/character-${skin}-wallpaper.webp`,
      `public/assets/menu/character-select/portrait-${skin}.png`,
    ], `${skin} menu provenance inventory`)
    for (const entry of manifest.otherAssets) {
      for (const asset of [entry.source, entry.prompt, entry.output, ...entry.references]) verifyHash(asset)
    }
    if (!SKIN_TRAITS[skin].energyOrb) continue
    const { energyOrb } = manifest
    assertEqual(energyOrb.output, `public/assets/combat/energy-orbs/${skin}.webp`)
    for (const [path, sha256] of [[energyOrb.source, energyOrb.sourceSha256], [energyOrb.prompt, energyOrb.promptSha256],
      [energyOrb.output, energyOrb.outputSha256], ...energyOrb.references.map((entry) => [entry.path, entry.sha256])]) {
      verifyHash({ path, sha256 })
    }
  }
})

// Ironclad-chan and Defect-chan were produced as one batch: their combat, noncombat/menu and card manifests live in
// docs/monogatari-skins and hash every source, prompt and output (campfire scenes included).
check('Ironclad-chan and Defect-chan provenance manifests match their committed sources, prompts and outputs', () => {
  const hash = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
  const safe = (path) => !path.startsWith('/') && !path.split('/').includes('..')
  let checked = 0
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== 'object') return
    if (typeof value.path === 'string' && typeof value.sha256 === 'string' && safe(value.path) && existsSync(join(repoRoot, value.path))) {
      assertEqual(hash(value.path), value.sha256, value.path)
      checked += 1
    }
    for (const child of Object.values(value)) walk(child)
  }
  const combat = JSON.parse(readFileSync(join(repoRoot, 'docs/monogatari-skins/combat-manifest.json'), 'utf8'))
  for (const group of [combat.sources, combat.prompts]) {
    for (const [path, sha256] of Object.entries(group)) { assertEqual(hash(path), sha256, path); checked += 1 }
  }
  walk(JSON.parse(readFileSync(join(repoRoot, 'docs/monogatari-skins/noncombat-manifest.json'), 'utf8')))
  assert(checked > 100, `only ${checked} hashes were checked`)
})

// Cards a skin does not have art for yet, as `<skin>:<cardId>`. Each entry is a promise to
// add the art; an Ironclad card that is neither skinned nor listed here fails this check.
const PENDING_SKIN_CARDS = new Set([])

check('every skin has a face, a thumbnail and an illustration for every card of its character, and nothing else', () => {
  const listed = skinCardFaces()
  assertDeepEqual(SKIN_CARD_FACES, listed, 'src/game/skin-card-faces.ts is stale; run node scripts/sync-skin-card-faces.mjs')
  for (const [character, skins] of Object.entries(SKINS)) {
    const owned = Object.values(CARDS).filter((def) => def.owner === character && def.publisherScan !== false)
    for (const skin of skins) {
      const pending = (def) => PENDING_SKIN_CARDS.has(`${skin}:${def.id}`)
      const covered = owned.filter((def) => !pending(def))
      const faces = covered.flatMap((def) => [cardImagePath(def, false), cardImagePath(faceOf(def, true), true)]
        .map((path) => path.slice(CARD_ASSET_ROOT.length + 1, -'.webp'.length))).sort()
      assertDeepEqual(listed[skin]?.faces ?? [], faces, `${skin} faces must be exactly ${character}'s cards`)
      assertDeepEqual(listed[skin]?.art ?? [], covered.map((def) => `${def.owner}/${def.id}`).sort(), `${skin} art`)
      assertEqual(listed[skin].faces.length, 2 * covered.length, `${skin} has both faces of every card`)
      const thumbs = listing(join(publicRoot, 'assets/skin-cards-sm', skin), '.webp').map((file) => file.slice(0, -5)).sort()
      assertDeepEqual(thumbs, faces, `${skin} 448px faces must match the full faces`)
      // Every shipped path resolves into the skin roots, never a default scan.
      for (const def of covered) {
        assertEqual(cardImagePath(def, false, skin), `${SKIN_CARD_ROOT}/${skin}/${cardImagePath(def, false).split('/').pop()}`)
        assertEqual(cardThumbPath(def, false, undefined, skin), `${SKIN_CARD_THUMB_ROOT}/${skin}/${cardImagePath(def, false).split('/').pop()}`)
        assertEqual(cardArtPath(def, skin), `${SKIN_CARD_ART_ROOT}/${skin}/${def.owner}/${def.id}.webp`)
      }
      // Gems keep the default socketed faces, and a card the skin lacks keeps its default scan.
      const gem = CARDS.strike_ironclad ?? owned[0]
      assertEqual(cardThumbPath(owned[0], false, gem, skin), cardThumbPath(owned[0], false, gem))
      const foreign = character === 'silent' ? CARDS.strike_ironclad : CARDS.strike_silent
      assertEqual(cardImagePath(foreign, false, skin), cardImagePath(foreign, false))
      assertEqual(cardArtPath(foreign, skin), cardArtPath(foreign))
    }
  }
})

check('skin card images keep the audited dimensions and sizes, and the art matches its provenance manifest', () => {
  for (const skin of SKIN_IDS) {
    assert(SKIN_CARD_FACES[skin], `${skin} has no skin-card-faces entry`)
    const dir = (name) => join(publicRoot, 'assets', name, skin)
    for (const key of SKIN_CARD_FACES[skin].faces) {
      const full = webpSize(join(dir('skin-cards'), `${key}.webp`))
      const thumb = webpSize(join(dir('skin-cards-sm'), `${key}.webp`))
      assert((full[0] === 744 && full[1] === 1039) || (full[0] === 960 && full[1] === 1341), `${key} is ${full.join('x')}`)
      assertEqual(thumb[0], 448, `${key} thumbnail width`)
      assert(Math.abs(thumb[1] / thumb[0] - full[1] / full[0]) < 0.01, `${key} thumbnail aspect`)
      // The skin face replaces the default scan one for one, so it must have its geometry.
      const original = join(cardRoot, `${key}.webp`)
      if (existsSync(original)) assertDeepEqual(full, webpSize(original), `${key} matches the default scan size`)
      assert(statSync(join(dir('skin-cards'), `${key}.webp`)).size <= 160 * 1024, `${key} exceeds 160 KiB`)
      assert(statSync(join(dir('skin-cards-sm'), `${key}.webp`)).size <= 80 * 1024, `${key} thumbnail exceeds 80 KiB`)
    }
    const artDir = dir('skin-card-art')
    const manifest = JSON.parse(readFileSync(join(repoRoot, `docs/skins/${skin}-card-art/manifest.json`), 'utf8'))
    assertEqual(manifest.cards.length, SKIN_CARD_FACES[skin].art.length, `${skin} manifest covers every illustration`)
    const sha = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
    // Grid skins record the shared inputs of their card pipeline once, at the top of the manifest.
    for (const record of [manifest.catalogue, manifest.registration, ...(manifest.masks ?? [])].filter(Boolean)) {
      assertEqual(sha(record.path), record.sha256, `${skin} manifest: ${record.path}`)
    }
    for (const card of manifest.cards) {
      for (const record of [card.source, card.prompt, card.output,
        ...(card.regeneration?.inputs ?? []).filter((input) => input.path)]) {
        assert(!record.path.startsWith('/') && !record.path.split('/').includes('..'), `unsafe path ${record.path}`)
        assertEqual(sha(record.path), record.sha256, record.path)
      }
      const file = join(artDir, card.output.path.split(`skin-card-art/${skin}/`)[1])
      assertDeepEqual(webpSize(file), [748, 420], `${card.id} art size`)
      assert(statSync(file).size <= 40 * 1024, `${card.id} art exceeds 40 KiB`)
    }
  }
})

check('committed card illustration paths are stable across upgrades', () => {
  for (const def of Object.values(CARDS).filter((card) => CARD_ART_OWNERS.includes(card.owner) && !card.pack)) {
    const path = cardArtPath(def)
    assertEqual(path, `${CARD_ART_ROOT}/${def.owner}/${def.id}.webp`)
    assertEqual(cardArtPath(faceOf(def, true)), path, `${def.id} upgrade reuses its illustration`)
  }
})

/** Slugs the sync script actually produced, so we only demand art it can fetch. */
const indexedKeys = new Set(
  cardIndex.flatMap((entry) => {
    const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const key = `${entry.tier}/${slug}`.replace(/\//g, '__')
    return entry.hasUpgrade ? [`${key}.webp`, `${key}+.webp`] : [`${key}.webp`]
  }),
)

const GENERATED_CARD_KEYS = new Set(['curses__daze.webp', 'curses__burn.webp', 'curses__slimed.webp'])
const downfallCardKeys = new Set(Object.values(CARDS)
  .filter((def) => DOWNFALL_CARD_OWNERS.includes(def.owner) ||
    Object.hasOwn(DOWNFALL_COLORLESS_CARD_DEFS, def.id))
  .flatMap((def) => [cardImagePath(def, false), ...(def.upgrade ? [cardImagePath(def, true)] : [])])
  .map((path) => path.split('/').pop()))
// The Slayer Pack: both faces of all 45 Shop pack cards, each filed under `slayer__<owner>__`.
const slayerCardKeys = new Set(Object.values(CARDS)
  .filter((def) => def.pack)
  .flatMap((def) => [cardImagePath(def, false), cardImagePath(faceOf(def, true), true)])
  .map((path) => path.split('/').pop()))
const knownCardKeys = new Set([...indexedKeys, ...GENERATED_CARD_KEYS, ...downfallCardKeys, ...slayerCardKeys])
const cardGroup = (file) => slayerCardKeys.has(file) ? 'slayer' : 'existing'
const hasPublisherScans = cardFiles.some((file) => !GENERATED_CARD_KEYS.has(file))

check('every defined card resolves to an image that exists', () => {
  if (cardFiles.length === 0) return // not synced
  const missing = []
  const unindexed = []
  for (const def of Object.values(CARDS)) {
    if (def.publisherScan === false) continue
    if (def.owner !== 'status' && !hasPublisherScans) continue
    for (const upgraded of [false, true]) {
      // Only check the upgraded face for cards that actually have one.
      if (upgraded && !def.upgrade) continue
      const path = cardImagePath(faceOf(def, upgraded), upgraded)
      if (!knownCardKeys.has(path.split('/').pop())) {
        unindexed.push(`${def.id}${upgraded ? '+' : ''} -> ${path}`)
        continue
      }
      if (!existsSync(join(publicRoot, path.replace(/^\//, '')))) {
        missing.push(`${def.id}${upgraded ? '+' : ''} -> ${path}`)
      }
    }
  }
  assert(
    unindexed.length === 0,
    `these cards resolve to a path the index does not know, which usually means ` +
      `the path builder is wrong rather than the art missing:\n    ${unindexed.join('\n    ')}`,
  )
  assert(missing.length === 0, `missing card art:\n    ${missing.join('\n    ')}`)
})

check('generated status scans decode at the shipped card resolution', () => {
  const files = [...GENERATED_CARD_KEYS].map((file) => join(cardRoot, file))
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect generated status scans')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded generated status scan count')
  const faults = inspected.flatMap((block) => {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    const height = Number(block.match(/  Height: (\d+)/)?.[1])
    return width === 744 && height === 1039 && statSync(join(cardRoot, file)).size <= 60 * 1024
      ? [] : [`${file} must be a 744x1039 WebP under 60 KiB`]
  })
  assertDeepEqual(faults, [], 'generated status scan faults')
})

// Every gameplay surface reads the thumbnail tier: the hand, the deck viewer,
// the reward and merchant rows, the compendium grid. A card missing from it
// renders as a broken image, and one left at full resolution silently puts the
// 3 MB decode back — which is the whole reason the tier exists.
check('every card scan has a thumbnail inside the decode budget', () => {
  if (cardFiles.length === 0) return // not synced
  assertDeepEqual(
    cardFiles.filter((file) => !cardThumbFiles.includes(file)), [],
    'card scans without a thumbnail — re-run `pnpm sync:cards`',
  )
  assertDeepEqual(
    cardThumbFiles.filter((file) => !cardFiles.includes(file)), [],
    'stale thumbnails with no scan behind them',
  )
  const files = cardThumbFiles.map((file) => join(cardThumbRoot, file))
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect card thumbnails')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded card thumbnail count')
  const faults = inspected.flatMap((block) => {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    return width > 0 && width <= CARD_THUMB_WIDTH ? [] : [`${file} is ${width}px wide`]
  })
  assertDeepEqual(faults, [], `card thumbnails over ${CARD_THUMB_WIDTH}px`)
  for (const [group, budget] of [['existing', 28], ['slayer', 4]]) {
    const bytes = cardThumbFiles.filter(file => cardGroup(file) === group)
      .reduce((sum, file) => sum + statSync(join(cardThumbRoot, file)).size, 0)
    assert(bytes < budget * 1024 * 1024, `${group} thumbnails total ${(bytes / 1048576).toFixed(1)} MB`)
  }
})

check('every Guardian Socket and Gem pair has one compact combined face', () => {
  const gems = Object.values(CARDS).filter((def) => def.guardian?.printedType === 'Gem')
  const hosts = Object.values(CARDS).filter((def) =>
    def.guardian?.socket || def.id === 'guardian_strike')
  const expected = hosts.flatMap((host) => [false, true]
    .filter((upgraded) => !upgraded || host.upgrade)
    .flatMap((upgraded) => gems.map((gem) =>
      cardThumbPath(faceOf(host, upgraded), upgraded, gem).split('/').pop())))
    .sort()
  assertEqual(expected.length, 420, 'complete Socket host and Gem face matrix')
  assertDeepEqual(socketedCardThumbFiles.sort(), expected, 'missing or stale combined Socket faces')
  const files = expected.map((file) => join(socketedCardThumbRoot, file))
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'combined Socket faces did not decode')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded combined Socket face count')
  assert(inspected.every((block) => Number(block.match(/  Width: (\d+)/)?.[1]) === 448),
    'combined Socket faces must be 448px wide')
  assert(files.reduce((bytes, file) => bytes + statSync(file).size, 0) < 32 * 1024 * 1024,
    'combined Socket faces exceed 32 MiB')
})

// Path shape is checked even without artwork, since it is pure code.
check('image paths are safe, normalised browser paths', () => {
  for (const def of Object.values(CARDS)) {
    for (const [root, path] of [
      [CARD_ASSET_ROOT, cardImagePath(def, false)],
      [CARD_THUMB_ROOT, cardThumbPath(def, false)],
    ]) {
      assert(path.startsWith(`${root}/`), `${def.id}: path must live under the asset root`)
      assert(!path.includes('\\'), `${def.id}: no backslashes in a browser path`)
      assert(!path.includes('..'), `${def.id}: no parent traversal`)
      assert(!/%[0-9a-f]{2}/i.test(path), `${def.id}: paths must not be percent-encoded`)
      assert(path === path.trim(), `${def.id}: no surrounding whitespace`)
    }
    // The two tiers are the same scan at two sizes; a key that drifted between
    // them would render one card's art on another card's face.
    assertEqual(
      cardThumbPath(def, false).slice(CARD_THUMB_ROOT.length),
      cardImagePath(def, false).slice(CARD_ASSET_ROOT.length),
      `${def.id}: thumbnail and scan keys disagree`,
    )
  }
})

check('the card art on disk matches the index exactly', () => {
  if (!hasPublisherScans) return
  const expected = cardIndex.reduce((count, entry) => count + (entry.hasUpgrade ? 2 : 1), 0) +
    GENERATED_CARD_KEYS.size + downfallCardKeys.size + slayerCardKeys.size
  assertEqual(slayerCardKeys.size, 90, 'The Slayer Pack: 45 cards, two faces each')
  assertEqual(cardFiles.length, expected, 'every index entry should have exactly one file per face')
})

check('every Downfall card has its official full-size board-game face', () => {
  const files = [...downfallCardKeys].map((file) => join(cardRoot, file))
  assertEqual(files.length, 576, 'Downfall base and upgraded face inventory')
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect Downfall card faces')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded Downfall card face count')
  const gemFiles = new Set([
    'amethyst', 'emerald', 'garnet', 'opal', 'ruby', 'sapphire', 'tourmaline', 'amber', 'aquamarine',
    'bismuth', 'morganite', 'jasper', 'onyx', 'pearl', 'peridot',
  ].map((gem) => `guardian__normal__${gem}.webp`))
  const faults = inspected.flatMap((block) => {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    const height = Number(block.match(/  Height: (\d+)/)?.[1])
    return width === 744 && height === (gemFiles.has(file) ? 1016 : 1039)
      ? [] : [`${file} is ${width}x${height}`]
  })
  assertDeepEqual(faults, [], 'Downfall card face dimensions')
})

check('character card art stays at source resolution', () => {
  if (!hasPublisherScans) return
  const files = cardFiles
    .filter((file) => /^(ironclad|silent|defect|watcher|slayer)__/.test(file))
    .map((file) => join(cardRoot, file))
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect character card dimensions')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'webpinfo should inspect every character card')
  const faults = inspected.flatMap((block) => {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    const height = Number(block.match(/  Height: (\d+)/)?.[1])
    return width >= 744 && height >= 1039 ? [] : [`${file} is ${width}x${height}`]
  })
  assert(faults.length === 0, `low-resolution character card art:\n    ${faults.join('\n    ')}`)
})

// Card art is the bulk of the payload; a careless re-sync at full resolution
// would add hundreds of megabytes without anyone noticing until clone time.
check('card art stays within its size budget', () => {
  if (!hasPublisherScans) return
  // Keep the existing crop budget; the Slayer Pack faces have a separate
  // bounded allowance, without raising other cards' limits.
  for (const [group, budget, perFile] of [['existing', 48, 60], ['slayer', 6, 60]]) {
    let total = 0
    const oversized = []
    for (const file of cardFiles.filter(file => cardGroup(file) === group)) {
      const bytes = statSync(join(cardRoot, file)).size
      total += bytes
      if (bytes > perFile * 1024) oversized.push(`${file} is ${Math.round(bytes / 1024)} KB`)
    }
    assert(oversized.length === 0, `oversized card art:\n    ${oversized.join('\n    ')}`)
    const megabytes = total / 1024 / 1024
    assert(megabytes < budget, `${group} card art totals ${megabytes.toFixed(1)} MB, over the ${budget} MB budget`)
  }
})

check('no stale card images linger from an older naming scheme', () => {
  if (cardFiles.length === 0) return
  const expected = new Set()
  for (const entry of cardIndex) {
    const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const key = `${entry.tier}/${slug}`.replace(/\//g, '__')
    expected.add(`${key}.webp`)
    if (entry.hasUpgrade) expected.add(`${key}+.webp`)
  }
  for (const key of GENERATED_CARD_KEYS) expected.add(key)
  for (const key of downfallCardKeys) expected.add(key)
  for (const key of slayerCardKeys) expected.add(key)
  const strays = cardFiles.filter((file) => !expected.has(file))
  assert(
    strays.length === 0,
    `unexpected files in the card directory:\n    ${strays.slice(0, 10).join('\n    ')}`,
  )
})

check('every icon the UI can render exists on disk', () => {
  const missing = REQUIRED_ICONS.filter((name) => !iconFiles.includes(`${name}.png`))
  assert(missing.length === 0, `missing icons — re-run \`pnpm sync:icons\`: ${missing.join(', ')}`)
})

// The die faces are regenerated art rather than rulebook crops, so they do not
// inherit the 96px export the other icons come out of sync-icons.mjs at. They
// still only ever paint into a 26 CSS px box; shipping them at generator
// resolution cost 800 KB and 4 MB of decoded texture each, per die shown.
check('die faces stay inside the icon decode budget', () => {
  const dice = iconFiles.filter((file) => /^die[1-6]\.png$/.test(file))
  assertEqual(dice.length, 6, 'die face inventory')
  for (const file of dice) {
    const bytes = readFileSync(join(iconRoot, file))
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    assert(Math.max(width, height) <= DIE_ICON_EDGE,
      `${file} is ${width}x${height}, over the ${DIE_ICON_EDGE}px cap`)
  }
})

// Publisher crops are an optional local sync. Keep its mapping honest without
// making a clean clone depend on a portrait for every printed enemy variant.
check('the optional enemy art table names only real enemies', () => {
  const stray = Object.keys(ENEMY_ART).filter((defId) => !(defId in ENEMIES))
  assert(stray.length === 0, `ENEMY_ART names enemies that do not exist: ${stray.join(', ')}`)
})

check('the menu artwork and licensed UI font are bundled', () => {
  for (const file of ['title-spire.webp', 'compendium-archive.webp']) {
    assert(existsSync(join(menuRoot, file)), `missing menu artwork: ${file}`)
  }
  const expectedIcons = [
    'all', 'colorless', 'curse', 'defect', 'guardian', 'hermit', 'hexaghost', 'ironclad',
    'silent', 'slime_boss', 'status', 'watcher',
  ]
    .map((name) => `${name}.webp`)
  assertDeepEqual(compendiumIconFiles.sort(), expectedIcons, 'compendium icon inventory')
  const iconInfo = spawnSync('webpinfo', ['-summary', ...expectedIcons.map((file) => join(compendiumIconRoot, file))], { encoding: 'utf8' })
  assert(iconInfo.status === 0, iconInfo.stderr || 'could not inspect compendium icons')
  for (const block of iconInfo.stdout.split(/^File: /m).slice(1)) {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    assert(/  Width: 256[\s\S]*  Height: 256/.test(block), `${file} is not 256x256`)
    assert(/Alpha:\s+1/.test(block), `${file} has no alpha channel`)
  }
  assert(existsSync(join(fontRoot, 'Kreon.ttf')), 'missing Kreon UI font')
  const license = readFileSync(join(fontRoot, 'Kreon-OFL.txt'), 'utf8')
  assert(license.includes('SIL OPEN FONT LICENSE Version 1.1'), 'Kreon OFL license is incomplete')
})

check('every enemy has exactly one canonical combat cutout', () => {
  const expected = [...new Set(Object.values(ENEMIES)
    .map((def) => `${def.artId ?? def.id}.webp`))].sort()
  assertDeepEqual(combatEnemyFiles.sort(), expected, 'combat enemy cutout inventory')
  const trackedCombat = spawnSync('git', ['ls-files', 'public/assets/combat/enemies'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim().split('\n').filter((file) => dirname(file) === 'public/assets/combat/enemies')
    .map((file) => file.split('/').pop()).sort()
  assertDeepEqual(trackedCombat, expected, 'tracked combat enemy cutout inventory')
  const legacy = spawnSync('git', ['ls-files', 'public/assets/enemies'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim().split('\n').filter(Boolean).map((file) => file.split('/').pop()).sort()
  assertDeepEqual(legacy, [], 'tracked legacy portrait inventory')
})

check('every live enemy runtime image path exists', () => {
  const missing = Object.values(ENEMIES).filter((def) => {
    const relative = enemyImagePath(def).replace(/^\/assets\//, '')
    return !existsSync(join(publicRoot, 'assets', relative))
  }).map((def) => `${def.id}: ${enemyImagePath(def)}`)
  assert(missing.length === 0, `missing runtime enemy images:\n    ${missing.join('\n    ')}`)
})

check('every Downfall enemy asset maps to an official source', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'docs/downfall-enemy-asset-provenance.json'), 'utf8'))
  assertEqual(manifest.upstream?.commit, '030ff7d4a7419a3e21c3075661550b1b479f3502',
    'Downfall provenance must pin the inspected PC-mod revision')
  assertEqual(manifest.boardGame?.workshopId, '3687082014',
    'Downfall provenance must pin the official public-playtest TTS item')
  const entries = manifest.assets ?? []
  const expected = [
    ...combatEnemyFiles.filter((file) => file.startsWith('downfall_') || file === 'spire_shield.webp')
      .map((file) => `public/assets/combat/enemies/${file}`),
    ...bossAnimationFiles.filter((file) => file.startsWith('downfall_') || file.startsWith('spire_shield-'))
      .map((file) => `public/assets/combat/enemies/animations/${file}`),
    ...bossProjectileFiles.map((file) => `public/assets/combat/enemies/projectiles/${file}`),
    ...combatActionVfxFiles.filter((file) => file.startsWith('downfall-'))
      .map((file) => `public/assets/combat/vfx/actions/${file}`),
  ].sort()
  assertDeepEqual(entries.flatMap((entry) => entry.runtime ?? []).sort(), expected,
    'Downfall source-to-runtime asset mapping')
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  for (const entry of entries) {
    assert([
      'pc-downfall-extraction', 'base-game-extraction-via-pc-downfall',
      'base-game-exact-reuse', 'board-game-boss-card-imagegen',
    ].includes(entry.sourceKind),
      `${entry.artId} is not sourced from an official board-game/PC asset or an exact base-game reuse`)
    assert(typeof entry.source === 'string' && entry.source.length > 0, `${entry.artId} lacks an exact source`)
    const source = join(repoRoot, entry.source)
    assert(existsSync(source), `${entry.artId} source capture is not committed`)
    assertEqual(digest(source), entry.sourceSha256, `${entry.artId} source capture hash`)
    if (entry.sourceKind === 'board-game-boss-card-imagegen') {
      assert(Number.isInteger(entry.cardDeckId) && Number.isInteger(entry.cardIndex),
        `${entry.artId} lacks its TTS deck/index source`)
    } else {
      assert(typeof entry.upstreamCode === 'string' && entry.upstreamCode.startsWith('src/'),
        `${entry.artId} lacks its PC Downfall code path`)
      assert(/^[a-f0-9]{64}$/.test(entry.upstreamCodeSha256 ?? ''),
        `${entry.artId} lacks its pinned upstream-code hash`)
    }
    for (const runtime of entry.runtime ?? []) {
      const path = join(repoRoot, runtime)
      assert(existsSync(path), `${runtime} is missing`)
      assertEqual(digest(path), entry.runtimeSha256?.[runtime], `${runtime} derivative hash`)
    }
    if (entry.pipelineArtifact) {
      const artifact = join(repoRoot, entry.pipelineArtifact)
      assert(existsSync(artifact), `${entry.artId} pipeline artifact is not committed`)
      assertEqual(digest(artifact), entry.pipelineArtifactSha256, `${entry.artId} pipeline artifact hash`)
    }
  }
  for (const hero of ['ironclad', 'silent', 'defect', 'watcher']) {
    const entry = entries.find((candidate) => candidate.artId === `downfall_pc_${hero}`)
    assert(entry?.sourceKind === 'pc-downfall-extraction', `${hero} evil boss is not a PC Downfall extraction`)
  }
})

check('every enemy resolves to the continuous rig inventory', () => {
  const defs = Object.values(ENEMIES)
  for (const def of defs) for (const pose of ['idle', 'attack']) {
    const relative = enemyAnimationImagePath(def, pose).replace(/^\/assets\//, '')
    assert(existsSync(join(publicRoot, 'assets', relative)), `${def.id}: missing ${pose} rig`)
  }
  const result = spawnSync('python3', ['scripts/animation/review-rigs.py', '--check-only'], {
    cwd: repoRoot, encoding: 'utf8',
  })
  assert(result.status === 0, result.stderr || result.stdout || 'rig audit requires Python and Pillow')
})

check('Elite and Boss intent placement matches their art', () => {
  const result = spawnSync('python3', ['scripts/calibrate-elite-intent.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'run python3 scripts/calibrate-elite-intent.py')
})

check('held potions and Orbs sit on each hero\'s head', () => {
  const result = spawnSync('python3', ['scripts/calibrate-hero-head.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'run python3 scripts/calibrate-hero-head.py')
})

check('every ranged Downfall boss has one complete transparent projectile', () => {
  const artIds = [
    'downfall_blasphemer', 'downfall_corrupted', 'downfall_dark_core', 'downfall_inferno',
    'downfall_neow', 'downfall_orb_master', 'downfall_witch', 'downfall_wraith',
  ]
  const expected = artIds.map((id) => `${id}.webp`).sort()
  assertDeepEqual(bossProjectileFiles.sort(), expected, 'Downfall boss projectile inventory')
  for (const artId of artIds) {
    assertEqual(bossProjectileImagePath(artId), `/assets/combat/enemies/projectiles/${artId}.webp`)
  }
  for (const artId of ['downfall_demon', 'downfall_doppelganger', 'downfall_trickster', 'downfall_wrathful']) {
    assertEqual(bossProjectileImagePath(artId), undefined, `${artId} is a melee boss`)
  }
  const paths = expected.map((file) => join(bossProjectileRoot, file))
  const result = spawnSync('python3', ['-c', `
import sys
from PIL import Image
for path in sys.argv[1:]:
    image = Image.open(path).convert('RGBA')
    alpha = image.getchannel('A')
    bounds = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
    assert max(image.size) == 256 and min(image.size) >= 128, (path, image.size)
    assert bounds and min(bounds[0], bounds[1], image.width - bounds[2], image.height - bounds[3]) >= 8, (path, bounds)
    assert max(alpha.getpixel(point) for point in ((0, 0), (image.width - 1, 0),
               (0, image.height - 1), (image.width - 1, image.height - 1))) <= 8, path
`, ...paths], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'a Downfall boss projectile clips its transparent canvas')
  assert(paths.reduce((bytes, path) => bytes + statSync(path).size, 0) < 1024 * 1024,
    'Downfall boss projectiles exceed 1 MiB')
})

check('Downfall Slayers use separate PC Downfall art instead of playable hero cutouts', () => {
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  for (const hero of ['ironclad', 'silent', 'defect', 'watcher']) {
    const playable = join(combatCharacterRoot, `${hero}.webp`)
    const enemy = join(combatEnemyRoot, `downfall_pc_${hero}.webp`)
    assert(existsSync(enemy), `missing PC Downfall ${hero} Slayer cutout`)
    assert(digest(enemy) !== digest(playable), `PC Downfall ${hero} Slayer reuses the playable hero cutout`)
  }

  const probe = `
import sys, json
from PIL import Image, ImageChops, ImageStat
faults = []
for index in range(1, len(sys.argv), 2):
    playable = Image.open(sys.argv[index]).convert("RGBA").resize((64, 64))
    enemy = Image.open(sys.argv[index + 1]).convert("RGBA").resize((64, 64))
    distance = sum(ImageStat.Stat(ImageChops.difference(playable, enemy)).mean) / 4
    if distance < 20:
        faults.append(f"{sys.argv[index + 1]}: perceptually reuses playable hero ({distance:.2f})")
print(json.dumps(faults))
`
  const pairs = ['ironclad', 'silent', 'defect', 'watcher'].flatMap((hero) => [
    join(combatCharacterRoot, `${hero}.webp`),
    join(combatEnemyRoot, `downfall_pc_${hero}.webp`),
  ])
  const result = spawnSync('python3', ['-c', probe, ...pairs], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'Slayer comparison requires python3 + Pillow')
  const faults = JSON.parse(result.stdout.trim().split('\n').pop())
  assert(faults.length === 0, `Slayer art is not distinct:\n    ${faults.join('\n    ')}`)
})

check('Slime Boss minions ship one transparent cutout and one complete Command animation', () => {
  const expected = SLIME_ASSET_SLUGS.flatMap((slug) => [`${slug}.webp`, `${slug}-command.webp`]).sort()
  assertDeepEqual(combatSlimeFiles.sort(), expected, 'Slime minion asset inventory')

  const cutouts = SLIME_ASSET_SLUGS.map((slug) => join(combatSlimeRoot, `${slug}.webp`))
  const result = spawnSync('webpinfo', ['-summary', ...cutouts], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect Slime minion cutouts')
  for (const block of result.stdout.split(/^File: /m).slice(1)) {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    assert(/Canvas size 384 x 384/.test(block) && /Alpha:\s+1/.test(block),
      `${file} is not a transparent 384x384 cutout`)
  }

  for (const slug of SLIME_ASSET_SLUGS) {
    const animation = join(combatSlimeRoot, `${slug}-command.webp`)
    const mux = spawnSync('webpmux', ['-info', animation], { encoding: 'utf8' })
    assert(mux.status === 0, mux.stderr || `could not inspect ${slug} Command animation`)
    assert(/Canvas size: 256 x 256/.test(mux.stdout) && /Number of frames: 12/.test(mux.stdout) &&
      /Loop Count : 1/.test(mux.stdout) && /Features present:.*transparency/.test(mux.stdout),
    `${slug} Command is not a transparent one-shot 1.7-second 256px animation`)
    const durations = mux.stdout.split('\n').filter((line) => /^\s*\d+:/.test(line))
      .map((line) => Number(line.trim().split(/\s+/)[6]))
    assertDeepEqual(durations, [600, ...Array(10).fill(50), 600],
      `${slug} Command does not use 0.6s dash, 0.5s personal attack, and 0.6s return timing`)
  }
  const commandEdgeProbe = spawnSync('python3', ['-c', `
import sys
from PIL import Image
for path in sys.argv[1:]:
    image = Image.open(path)
    for index in range(image.n_frames):
        image.seek(index)
        bounds = image.convert('RGBA').getchannel('A').getbbox()
        assert bounds and min(bounds[0], bounds[1], image.width - bounds[2], image.height - bounds[3]) >= 4, (path, index, bounds)
`, ...SLIME_ASSET_SLUGS.map((slug) => join(combatSlimeRoot, `${slug}-command.webp`))], { encoding: 'utf8' })
  assert(commandEdgeProbe.status === 0,
    commandEdgeProbe.stderr || 'a Slime Command frame touches its canvas edge')
  assert(SLIME_ASSET_SLUGS.flatMap((slug) => [
    join(combatSlimeRoot, `${slug}.webp`), join(combatSlimeRoot, `${slug}-command.webp`),
  ]).reduce((bytes, file) => bytes + statSync(file).size, 0) < 12 * 1024 * 1024,
  'Slime minion assets exceed 12 MiB')

  const spawn = spawnSync('webpmux', ['-info', join(combatCharacterRoot, 'slime_boss-spawn.webp')],
    { encoding: 'utf8' })
  assert(spawn.status === 0 && /Canvas size: 256 x 256/.test(spawn.stdout) &&
    /Number of frames: 16/.test(spawn.stdout) && /Loop Count : 1/.test(spawn.stdout) &&
    /Features present:.*transparency/.test(spawn.stdout),
  spawn.stderr || 'Slime Boss spawn is not a transparent one-shot 16-frame 256px animation')
  const spawnDurations = spawn.stdout.split('\n').filter((line) => /^\s*\d+:/.test(line))
    .map((line) => Number(line.trim().split(/\s+/)[6]))
  assert(spawnDurations.length === 16 && spawnDurations.every((duration) => duration === 90),
    'Slime Boss spawn does not use sixteen 90ms key frames')
})

check('bundled combat cutouts are sized for their render box, with transparency', () => {
  const expectedCharacters = [
    'defect-charge.webp', 'defect-hero.webp', 'defect-release.webp', 'defect.webp',
    'guardian-defense.webp', 'guardian-hero.webp', 'guardian-impact.webp', 'guardian-ready.webp',
    'guardian-to-attack.webp', 'guardian-to-defense.webp', 'guardian.webp',
    'hermit-hero.webp', 'hermit-impact.webp', 'hermit-ready.webp', 'hermit.webp',
    ...Array.from({ length: 7 }, (_, heat) => [
      `hexaghost-heat-${heat}-attack.webp`, `hexaghost-heat-${heat}.webp`,
    ]).flat(),
    'hexaghost-hero.webp', 'hexaghost-impact.webp', 'hexaghost-ready.webp', 'hexaghost.webp',
    'ironclad-hero.webp', 'ironclad-impact.webp', 'ironclad-ready.webp', 'ironclad.webp',
    ...SKIN_IDS.flatMap((id) => [`${id}-hero.webp`, `${id}.webp`]),
    'monogatari_defect-charge.webp', 'monogatari_defect-release.webp',
    'monogatari_ironclad-impact.webp', 'monogatari_ironclad-ready.webp',
    'silent-hero.webp', 'silent-throw.webp', 'silent.webp',
    'slime_boss-hero.webp', 'slime_boss-impact.webp', 'slime_boss-ready.webp', 'slime_boss-spawn.webp',
    'slime_boss.webp',
    'watcher-hero.webp', 'watcher-ready.webp', 'watcher-thrust.webp', 'watcher.webp',
  ]
  assertDeepEqual(combatCharacterFiles.sort(), expectedCharacters.sort(), 'combat character cutout inventory')
  const enemyPaths = combatEnemyFiles.map((file) => join(combatEnemyRoot, file))
  const files = [
    ...enemyPaths,
    ...combatCharacterFiles.filter((file) => file !== 'slime_boss-spawn.webp')
      .map((file) => join(combatCharacterRoot, file)),
  ]
  const enemyPathSet = new Set(enemyPaths)
  const bossEliteFiles = new Set(Object.values(ENEMIES).filter(enemy => enemy.isBoss || enemy.elite ||
      ['sentry_a', 'sentry_b', 'red_slaver', 'blue_slaver'].includes(enemy.id))
    .map(enemy => `${enemy.artId ?? enemy.id}.webp`))
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect combat cutouts')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'webpinfo should inspect every combat cutout')
  const faults = inspected.flatMap((block) => {
    const path = block.slice(0, block.indexOf('\n')).trim()
    const file = path.split('/').pop()
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    const height = Number(block.match(/  Height: (\d+)/)?.[1])
    const alpha = /Alpha:\s+1/.test(block)
    const [floor, cap] = enemyPathSet.has(path) ? (bossEliteFiles.has(file) ? BOSS_ELITE_CUTOUT_EDGE : ENEMY_CUTOUT_EDGE)
      : file.endsWith('-hero.webp') ? CHARACTER_HERO_EDGE
      : CHARACTER_CUTOUT_EDGE
    const resolution = Math.min(width, height) >= floor / 2 &&
      Math.max(width, height) >= floor && Math.max(width, height) <= cap
    return resolution && alpha ? [] : [`${file} is ${width}x${height}, alpha ${alpha}`]
  })
  assert(faults.length === 0, `invalid combat cutouts:\n    ${faults.join('\n    ')}`)

  const probe = `
import sys, json, re
from PIL import Image
faults = []
for name in sys.argv[1:]:
    im = Image.open(name).convert("RGBA")
    alpha = im.getchannel("A")
    w, h = im.size
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]
    label = name.rsplit("/", 1)[-1]
    bbox = alpha.point(lambda value: 255 if value >= 16 else 0).getbbox()
    if max(corners) > 8:
        faults.append(f"{label}: corners are opaque {corners}")
    elif sum(1 for value in alpha.getdata() if value < 16) / (w * h) < 0.05:
        faults.append(f"{label}: less than 5% of its canvas is transparent")
    elif bbox is None or min(bbox[2] - bbox[0], bbox[3] - bbox[1]) < 0.30 * min(w, h) or max(bbox[2] - bbox[0], bbox[3] - bbox[1]) < 0.55 * max(w, h):
        faults.append(f"{label}: visible art is undersized ({bbox})")
    heat = re.fullmatch(r"hexaghost-heat-(\d)\.webp", label)
    if heat:
        pixels = im.load()
        green = {(x, y) for y in range(h) for x in range(w)
                 if pixels[x, y][3] > 80 and pixels[x, y][1] > 170
                 and pixels[x, y][1] > pixels[x, y][0] * 1.25
                 and pixels[x, y][1] > pixels[x, y][2] * 1.25}
        components = 0
        while green:
            stack = [green.pop()]
            area = 0
            while stack:
                x, y = stack.pop()
                area += 1
                for point in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if point in green:
                        green.remove(point)
                        stack.append(point)
            components += area > 500
        if components != int(heat.group(1)):
            faults.append(f"{label}: expected {heat.group(1)} visible flames, found {components}")
print(json.dumps(faults))
`
  const pixelResult = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(pixelResult.status === 0, pixelResult.stderr || 'combat cutout pixel audit requires python3 + Pillow')
  const pixelFaults = JSON.parse(pixelResult.stdout.trim().split('\n').pop())
  assert(pixelFaults.length === 0, `combat cutouts have opaque backgrounds:\n    ${pixelFaults.join('\n    ')}`)

  const flameIcon = readFileSync(join(iconRoot, 'hexaghost-flame.png'))
  assert(flameIcon.subarray(1, 4).toString() === 'PNG', 'Hexaghost flame action icon is not a PNG')
  assert(flameIcon.readUInt32BE(16) === 512 && flameIcon.readUInt32BE(20) === 512,
    'Hexaghost flame action icon is not 512x512')
  assertEqual(flameIcon[25], 6, 'Hexaghost flame action icon is not RGBA')
  for (const name of ['hermit-chamber.png', 'hermit-chamber-loaded.png']) {
    const chamberIcon = readFileSync(join(iconRoot, name))
    assert(chamberIcon.subarray(1, 4).toString() === 'PNG', `${name} is not a PNG`)
    assert(chamberIcon.readUInt32BE(16) === 512 && chamberIcon.readUInt32BE(20) === 512,
      `${name} is not 512x512`)
    assertEqual(chamberIcon[25], 6, `${name} is not RGBA`)
  }

  for (const direction of ['attack', 'defense']) {
    const animation = join(combatCharacterRoot, `guardian-to-${direction}.webp`)
    const mux = spawnSync('webpmux', ['-info', animation], { encoding: 'utf8' })
    assert(mux.status === 0, mux.stderr || `could not inspect Guardian ${direction} transformation`)
    assert(/Loop Count\s*:\s*1/.test(mux.stdout), `Guardian ${direction} transformation is not one-shot`)
    assert(/Number of frames:\s*5/.test(mux.stdout), `Guardian ${direction} transformation does not use five frames`)
    assertEqual([...mux.stdout.matchAll(/\s(\d+)\s+none\s+no\s+\d+\s+lossy/g)]
      .reduce((sum, frame) => sum + Number(frame[1]), 0), 600,
    `Guardian ${direction} transformation duration`)
  }
})

check('Kratos attack art provenance and measured pose shifts', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'docs/skins/kratos-art.json'), 'utf8'))
  const digest = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
  for (const entry of manifest.generated) {
    assertEqual(digest(entry.source), entry.sha256, entry.source)
    assertEqual(digest(entry.prompt), entry.promptSha256, entry.prompt)
    for (const reference of entry.inputs) assertEqual(digest(reference.path), reference.sha256, reference.path)
  }
  for (const entry of manifest.runtime) assertEqual(digest(entry.path), entry.sha256, entry.path)
  // The CSS rear-foot shifts and the travel's blade-tip reach in skins/kratos.json are measured from the drawings.
  const measured = spawnSync('python3', ['scripts/animation/kratos.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(measured.status === 0, measured.stderr || measured.stdout)
})

check('Silent-chan and Watcher-chan attack art provenance, and every Monogatari bake matches its sources', () => {
  const digest = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
  const read = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
  const generated = {
    monogatari_silent: read('docs/skins/monogatari_silent-art/manifest.json').attack.generated,
    monogatari_watcher: read('docs/skins/monogatari_watcher-art/attack-manifest.json').generated,
  }
  for (const [skin, entries] of Object.entries(generated)) {
    const config = readFileSync(join(repoRoot, `scripts/animation/skins/${skin}.json`), 'utf8')
    // One manifest entry per drawn pose of the animation clock (the idle key is the separate `ready` drawing).
    const drawn = [...new Set(JSON.parse(config).keys.map(([, pose]) => pose))].filter((pose) => pose !== 'idle').sort()
    assertDeepEqual(entries.map((entry) => entry.name).sort(), drawn, `${skin}: attack provenance entries vs the poses of its animation config`)
    for (const entry of entries) {
      for (const hashed of [entry.source, entry.prompt, entry.output, ...entry.inputs.filter((input) => input.path)]) {
        assert(!hashed.path.startsWith('/') && !hashed.path.split('/').includes('..'), `${skin}: unsafe provenance path ${hashed.path}`)
        assertEqual(digest(hashed.path), hashed.sha256, hashed.path)
      }
      assert(config.includes(`"${entry.name}"`), `${skin}: ${entry.name} is not a pose of the animation config`)
    }
  }
  // Each bake step regenerates its runtime WebP from the committed sources and fails if any byte differs.
  for (const script of ['monogatari.py', 'monogatari_silent.py', 'monogatari_watcher.py']) {
    const baked = spawnSync('python3', [`scripts/animation/${script}`, '--check'], { cwd: repoRoot, encoding: 'utf8' })
    assert(baked.status === 0, `${script} --check: ${baked.stderr || baked.stdout}`)
  }
})

const stagedSkins = SKIN_IDS.filter((id) => SKIN_TRAITS[id].stagedAttack)
const skinConfigs = Object.fromEntries(readdirSync(join(repoRoot, 'scripts/animation/skins')).filter((file) => file.endsWith('.json'))
  .map((file) => [file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(repoRoot, 'scripts/animation/skins', file), 'utf8'))]))

check('every staged attack skin has its config, generated CSS and table; its drawings keep native alpha, planted feet and unclipped overscan', () => {
  // Registering a skin with the stagedAttack trait needs scripts/animation/skins/<skin>.json and a regenerated table.
  // A config may exist before its skin is registered (the art is drawn first); the generated table always lists every config.
  assertDeepEqual(stagedSkins.filter((skin) => !(skin in skinConfigs)), [], 'stagedAttack skins without an animation config')
  assertDeepEqual(Object.keys(STAGED_ATTACKS).sort(), Object.keys(skinConfigs).sort(), 'staged attack table vs the animation configs')
  const generated = spawnSync('python3', ['scripts/animation/skin-attack.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(generated.status === 0, generated.stderr || generated.stdout)
  for (const skin of stagedSkins) {
    const config = skinConfigs[skin]
    const poses = [...new Set(config.keys.map(([, pose]) => pose === 'idle' ? 'ready' : pose))]
    const airborne = config.audit?.airborne ?? {}
    const result = spawnSync('python3', ['-c', `
from PIL import Image, ImageChops
from pathlib import Path
import json
skin, poses, canvas, ground, airborne = json.loads(${JSON.stringify(JSON.stringify([skin, poses, config.canvas, config.ground, airborne]))})
root = Path('public/assets/combat/characters/animated')
idle = Image.open(root / f'{skin}-idle.webp')
assert idle.info['loop'] == 0 and idle.n_frames > 1
ready = Image.open(root / f'{skin}-ready.webp')
assert ImageChops.difference(idle.getchannel('A'), ready.getchannel('A')).getbbox() is None
images = [(idle, 0)] + [(Image.open(root / f'{skin}-{pose}.webp'), airborne.get(pose, 0)) for pose in poses]
for image, lift in images:
    assert image.size == (canvas, canvas), (image.filename, image.size)
    for i in range(image.n_frames):
        image.seek(i)
        alpha = image.getchannel('A')
        assert alpha.histogram()[0] > image.width * image.height / 2
        box = alpha.point(lambda a: 255 if a > 32 else 0).getbbox()
        assert box and min(box[0],box[1],image.width-box[2],image.height-box[3]) >= 4
        assert abs(box[3] - (ground - lift)) <= 4, (image.filename, box)
print('PASS')
`], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, `${skin}: ${result.stderr || result.stdout}`)
    for (const hit of config.hits) {
      assert(existsSync(join(combatActionVfxRoot, skin, `${hit.vfx}.webp`)), `${skin}: missing hit VFX ${hit.vfx}`)
    }
    for (const sound of Object.keys(config.sounds)) assert(sound in STAGED_SOUND_VOLUMES, `${skin}: sound ${sound} missing from the generated table`)
  }
})

check('every hero and skin has a merchant figure offset that lands its feet on the party floor line', () => {
  // merchant-arrival.css pushes each standing sprite down by its transparent bottom margin (translateY in % of its height).
  const css = readFileSync(join(repoRoot, 'src/ui/chrome/merchant-arrival.css'), 'utf8')
  const offsets = Object.fromEntries([...css.matchAll(/figure\[data-character='([a-z_]+)'\] img \{ transform: translateY\(([\d.]+)%\); \}/g)]
    .map(([, id, percent]) => [id, Number(percent)]))
  const ids = [...CHARACTER_IDS.slice(0, 4), ...SKIN_IDS]
  const probe = `
import json, sys
from PIL import Image
for path in sys.argv[1:]:
    image = Image.open(path).convert('RGBA')
    box = image.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()
    print(json.dumps((image.height - box[3]) / image.height * 100))
`
  const result = spawnSync('python3', ['-c', probe, ...ids.map((id) => join(publicRoot, `assets/noncombat/merchant/characters/${id}-standing.webp`))], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr)
  const gaps = result.stdout.trim().split('\n').map(Number)
  ids.forEach((id, index) => {
    assert(Object.hasOwn(offsets, id), `merchant-arrival.css has no floor offset for ${id}`)
    assert(Math.abs(offsets[id] - gaps[index]) <= 0.06, `${id}: floor offset ${offsets[id]}% but its standing figure leaves ${gaps[index].toFixed(2)}% under the feet`)
  })
})

check('every attack drawing keeps the idle\'s head and prop scale, and the audit rejects an enlarged pose', () => {
  // audit-poses.py reads each skin's audit block: head length and every prop within the config's tolerance of the idle's
  // (default 10%), landmarks that still sit on the drawing, planted soles, no clipping, fringes or detached specks.
  const audited = Object.entries(skinConfigs).filter(([skin, config]) => stagedSkins.includes(skin) && config.audit?.landmarks)
  assertDeepEqual(audited.map(([skin]) => skin).sort(), stagedSkins.filter((skin) => skin !== 'kratos').sort(), 'audited staged skins')
  for (const [skin] of audited) {
    const audit = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet'], { cwd: repoRoot, encoding: 'utf8' })
    assert(audit.status === 0, `${skin} attack audit:\n${audit.stdout.split('\n').filter((line) => line.startsWith('FAIL')).join('\n')}`)
  }
  // Mutation: a skin that caps the jump of its props between drawings (propStepPx) must fail when the cap shrinks to 20 px.
  for (const [skin, config] of audited.filter(([, config]) => config.audit.tolerances?.propStepPx)) {
    const audit = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', '--tol', 'propStepPx=20'], { cwd: repoRoot, encoding: 'utf8' })
    assert(audit.status !== 0 && /jumps \d+px between consecutive drawings/.test(audit.stdout), `${skin}: a 20px propStepPx cap passed the attack audit`)
  }
  // Mutation: the first contact drawing of each audited skin enlarged by 15% about its planted foot must fail the audit.
  const scratch = scratchDir('attack-audit')
  try {
    for (const [skin, config] of audited) {
      const pose = config.contactPoses[0]
      const made = spawnSync('python3', ['-c', `
import shutil, sys
sys.path.insert(0, 'scripts/animation')
from pathlib import Path
from PIL import Image
from skin_geometry import rear_foot_centre, solid_box
skin, pose, out = sys.argv[1:4]
source = Path('public/assets/combat/characters/animated')
for file in source.glob(skin + '-*.webp'): shutil.copy(file, out)
path = Path(out) / f'{skin}-{pose}.webp'
image = Image.open(path).convert('RGBA')
foot, ground = rear_foot_centre(image), solid_box(image)[3]
big = image.resize((round(image.width * 1.15), round(image.height * 1.15)), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', image.size)
canvas.alpha_composite(big, (round(foot - foot * 1.15), round(ground - ground * 1.15)))
canvas.save(path, quality=95)
`, skin, pose, scratch.dir], { cwd: repoRoot, encoding: 'utf8' })
      assert(made.status === 0, made.stderr)
      const audit = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', '--dir', scratch.dir], { cwd: repoRoot, encoding: 'utf8' })
      assert(audit.status !== 0 && new RegExp(`FAIL ${pose}:`).test(audit.stdout), `${skin}: a ${pose} drawing enlarged by 15% passed the attack audit`)
    }
  } finally { scratch.remove() }
})

check('every attack audit cap is exercised by a mutation, equals the measured maximum its README table documents, and cannot be loosened', () => {
  // Each audit cap is a number a person chose: shrinking it below the art must fail the real audit (so a check that was
  // disabled or never wired up shows here), and it is held to the measured maximum recorded in the skin's README table
  // (`### Audit caps`: cap | shipped | measured): the shipped cap may be tightened freely but never exceed the documented
  // one, and may not sit more than 10% above what the art measures, so there is no slack to hide a regression in.
  const DEFAULTS = { headRatio: 0.1, propRatio: 0.1, soleRatio: 0.2 }
  const MUTATIONS = {
    headStepPx: [['headStepPx=10'], /the head jumps \d+px between consecutive drawings/],
    propStepPx: [['propStepPx=10'], /the \w+ (tip|butt) jumps \d+px between consecutive drawings/],
    headRatio: [['headRatio=0.001'], /FAIL \w+: head \d/],
    propRatio: [['propRatio=0.001'], /FAIL \w+: prop "\w+" \d/],
    soleRatio: [['soleRatio=0.001'], /FAIL \w+: rear sole .* body scale drift/],
  }
  const scratch = scratchDir('attack-caps')
  try {
    for (const skin of stagedSkins.filter((id) => skinConfigs[id].audit?.landmarks)) {
      const config = skinConfigs[skin]
      const tolerances = config.audit.tolerances ?? {}
      const report = join(scratch.dir, `${skin}.json`)
      const clean = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', '--report', report], { cwd: repoRoot, encoding: 'utf8' })
      assert(clean.status === 0, `${skin}: ${clean.stdout}`)
      const measured = JSON.parse(readFileSync(report, 'utf8')).measured
      const readme = readFileSync(join(repoRoot, `docs/skins/${skin}-art/README.md`), 'utf8')
      const table = Object.fromEntries([...readme.split('### Audit caps')[1]?.split(/\n#{1,3} /)[0].matchAll(/^\| `(\w+)` \| ([\d.]+) \| ([\d.]+) \|$/gm) ?? []]
        .map(([, name, shipped, maximum]) => [name, { shipped: Number(shipped), maximum: Number(maximum) }]))
      const hold = config.minHoldMs ?? 45
      const holds = config.keys.slice(1).map(([time, pose], index) => [pose, (config.keys[index + 2]?.[0] ?? config.durationMs) - time])
        .filter(([pose]) => !(pose in (config.shortHolds ?? {}))).map(([, ms]) => ms)
      const rows = {
        ...Object.fromEntries(Object.keys(MUTATIONS).map((name) => [name, { cap: tolerances[name] ?? DEFAULTS[name], actual: measured[name] }])),
        groundSpeedPxPerMs: { cap: tolerances.groundSpeedPxPerMs },
        minHoldMs: { cap: hold, actual: Math.min(...holds), floor: true },
      }
      for (const [name, { cap, actual, floor }] of Object.entries(rows)) {
        assert(cap !== undefined, `${skin}: audit.tolerances.${name} is not set`)
        const doc = table[name]
        assert(doc, `${skin}: docs/skins/${skin}-art/README.md has no "| \`${name}\` | shipped | measured |" row under "### Audit caps"`)
        if (floor) {
          assert(cap >= doc.shipped && doc.shipped <= doc.maximum, `${skin}: ${name} ${cap} is below the documented ${doc.shipped}`)
          assert(actual >= doc.maximum, `${skin}: the shortest hold ${actual}ms is below the documented ${doc.maximum}ms`)
          continue
        }
        assert(cap <= doc.shipped, `${skin}: ${name} cap ${cap} exceeds the documented ${doc.shipped}: tighten the config, or justify a looser cap in the README table`)
        assert(doc.shipped <= doc.maximum * 1.1 + 1e-9, `${skin}: documented ${name} cap ${doc.shipped} is more than 10% above its documented maximum ${doc.maximum}`)
        assert(cap <= doc.maximum * 1.1 + 1e-9, `${skin}: ${name} cap ${cap} leaves more than 10% slack over the documented maximum ${doc.maximum}`)
        if (actual !== undefined) assert(actual <= doc.maximum + 1e-9, `${skin}: measured ${name} ${actual} exceeds the documented maximum ${doc.maximum}`)
      }
      for (const [name, [flags, expected]] of Object.entries(MUTATIONS)) {
        const run = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', ...flags.flatMap((flag) => ['--tol', flag])], { cwd: repoRoot, encoding: 'utf8' })
        assert(run.status !== 0 && expected.test(run.stdout), `${skin}: shrinking ${name} did not fail the attack audit with ${expected}\n${run.stdout.split('\n').slice(-4).join('\n')}`)
      }
    }
    // The minimum hold: every shipped clock passes, and a clock with a shorter hold, an unlisted short drawing, a short drawing
    // with no reason, a non-flight shortHolds entry or a flight drawing under 20ms fails both the audit and the generator.
    const result = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.path.insert(0, 'scripts/animation')
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
attack, audit = load('skin_attack', 'scripts/animation/skin-attack.py'), load('audit_poses', 'scripts/animation/audit-poses.py')
for skin in sys.argv[1:]:
    config = json.load(open(f'scripts/animation/skins/{skin}.json'))
    assert not attack.hold_problems(config), config
    keys = config['keys']
    def shorten(c, index, hold):
        c['keys'] = [[time - (keys[index + 1][0] - keys[index][0] - hold) * (i > index), pose] for i, (time, pose) in enumerate(keys)]
        c['durationMs'] -= keys[index + 1][0] - keys[index][0] - hold
        return c
    grounded = next(i for i, (_, pose) in enumerate(keys) if 0 < i < len(keys) - 1 and pose not in config.get('shortHolds', {}) and pose not in config['audit'].get('airborne', {}))
    cases = {
        'a grounded drawing held 30ms': shorten(json.loads(json.dumps(config)), grounded, 30),
        'minHoldMs raised past every hold': {**config, 'minHoldMs': 1000},
        'an unreasoned shortHolds entry': {**config, 'shortHolds': {**config.get('shortHolds', {}), 'nope': ''}},
        'a non-flight shortHolds entry': {**config, 'shortHolds': {**config.get('shortHolds', {}), keys[grounded][1]: 'because'}},
    }
    flight = next((i for i, (_, pose) in enumerate(keys) if pose in config.get('shortHolds', {})), None)
    if flight is not None:
        cases['a flight drawing held 10ms'] = shorten(json.loads(json.dumps(config)), flight, 10)
        unlisted = json.loads(json.dumps(config)); unlisted['shortHolds'].pop(keys[flight][1])
        cases['a short flight drawing with no shortHolds entry'] = unlisted
    for label, bad in cases.items():
        assert attack.hold_problems(bad), f'{skin}: {label} passed the hold check'
        assert any('holds' in e or 'shortHolds' in e for e in audit.audit(bad, attack.CHARACTERS / 'animated')[0]), f'{skin}: {label} passed the audit'
        try: attack.validate({**bad, 'contactReach': 0})
        except AssertionError as error:
            assert any(word in str(error) for word in ('holds', 'shortHolds', 'shorter than 20ms')), f'{skin}: {label} failed the generator for another reason: {error}'
            continue
        raise SystemExit(f'{skin}: {label} passed the generator')
print('PASS')
`, ...stagedSkins.filter((id) => skinConfigs[id].audit?.landmarks)], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, result.stderr.trim().split('\n').at(-1) || result.stdout)
  } finally { scratch.remove() }
})

check('stored poseShift and contactReach match a fresh measurement of every Monogatari attack drawing, and drift fails', () => {
  // Kratos is held to the same by kratos.py --check above. --measure --check is read-only.
  const measured = stagedSkins.filter((skin) => skin !== 'kratos')
  for (const skin of measured) {
    const result = spawnSync('python3', ['scripts/animation/skin-attack.py', '--measure', skin, '--check'], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, `${skin}: ${result.stderr.trim().split('\n').at(-1) || result.stdout}`)
  }
  // Mutations: a pose shifted by 60 canvas px (either way) or a contact reach off by 0.3 must be reported stale by the
  // measurement check, and a 60px shift of a contact drawing must fail the planted-sole audit.
  const mutated = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.path.insert(0, 'scripts/animation')
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
attack, audit = load('skin_attack', 'scripts/animation/skin-attack.py'), load('audit_poses', 'scripts/animation/audit-poses.py')
for skin in sys.argv[1:]:
    config = json.load(open(f'scripts/animation/skins/{skin}.json'))
    shifts, reach, _ = attack.measure(config, attack.baked({**config, 'contactReach': 0}))
    assert not attack.stale_measurements(config, shifts, reach), f'{skin}: unmutated config reported stale'
    pose = config['contactPoses'][0]
    for delta in (60, -60):
        bad = {**config, 'poseShift': {**config.get('poseShift', {}), pose: config.get('poseShift', {}).get(pose, 0) + delta}}
        assert attack.stale_measurements(bad, shifts, reach), f'{skin}: a {delta:+d}px poseShift on {pose} passed the measurement check'
        errors = audit.audit(bad, attack.CHARACTERS / 'animated')[0]
        assert any(error.startswith(f'{pose}: planted rear sole') for error in errors), f'{skin}: a {delta:+d}px poseShift on {pose} passed the planted-sole audit'
    assert attack.stale_measurements({**config, 'contactReach': config['contactReach'] + 0.3}, shifts, reach), f'{skin}: a +0.3 contactReach passed'
print('PASS')
`, ...measured], { cwd: repoRoot, encoding: 'utf8' })
  assert(mutated.status === 0, mutated.stderr.trim().split('\n').at(-1) || mutated.stdout)
})

check('the staged attack generator rejects malformed configs and accepts the test skins', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.path.insert(0, 'scripts/animation')
spec = importlib.util.spec_from_file_location('skin_attack', 'scripts/animation/skin-attack.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
for name in ('test_combo', 'test_strike'):
    config = json.load(open(f'scripts/animation/test-skins/{name}.json')); config['contactReach'] = 1
    module.validate(config)
good = json.load(open('scripts/animation/test-skins/test_combo.json')); good['contactReach'] = 1
cases = {
    'hit weights that do not add up': lambda c: c['hits'][0].update(weight=.5),
    'unknown hit style': lambda c: c['hits'][0].update(style='zap'),
    'hit sound without a volume': lambda c: c['hits'][0].update(sound='nope'),
    'hit on an unknown pose': lambda c: c['hits'][0].update(at='nope'),
    'hits out of time order': lambda c: c['hits'].reverse(),
    'clock that does not end idle': lambda c: c['keys'][-1].__setitem__(1, 'slam'),
    'travel back before out': lambda c: c['travel'].update(back=[10, 20]),
    'too many keys': lambda c: c['keys'].__setitem__(slice(1, 1), [[i + 1, 'slam'] for i in range(20)]),
    'contact pose that is not drawn': lambda c: c.update(contactPoses=['nope']),
    'shift for an unknown pose': lambda c: c.update(poseShift={'nope': 1}),
}
for label, mutate in cases.items():
    bad = json.loads(json.dumps(good)); mutate(bad)
    try: module.validate(bad)
    except AssertionError: continue
    raise SystemExit(f'accepted: {label}')
print('PASS')
`], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || result.stdout)
})

check('every character and skin has its combat, menu and merchant art', () => {
  const missing = VISUAL_IDS.flatMap((id) => [
    `combat/characters/${id}.webp`, `combat/characters/${id}-hero.webp`,
    `menu/character-select/portrait-${id}.png`, `menu/character-select/character-${id}-wallpaper.webp`,
    `noncombat/merchant/characters/${id}-standing.webp`,
  ]).filter((path) => !existsSync(join(publicRoot, 'assets', path)))
  assertDeepEqual(missing, [], 'visual-id art inventory')
  const heads = Object.keys(JSON.parse(readFileSync(join(repoRoot, 'src/ui/hero-art-head.json'), 'utf8')))
  assertDeepEqual(VISUAL_IDS.filter((id) => !heads.some((head) => head === id || head.startsWith(`${id}-`))), [], 'hero head calibration per visual id')
})

check('every released hero and skin has registered transparent treasure pickup poses', () => {
  const root = join(repoRoot, 'public/assets/noncombat/treasure')
  const expected = VISUAL_IDS.flatMap((id) => [`hand-${id}.webp`, `grip-${id}.webp`]).sort()
  assertDeepEqual(listing(root, '.webp').filter((name) => /^(hand|grip)-/.test(name)).sort(), expected)
  const result = spawnSync('webpinfo', ['-summary', ...expected.map((name) => join(root, name))], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not decode treasure pickup poses')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, expected.length, 'decoded treasure pickup pose count')
  for (const block of inspected) {
    assert(/Width: 384[\s\S]*Height: 1024/.test(block) && /Alpha:\s+1/.test(block),
      `${block.split('\n')[0]} must retain the registered 384x1024 transparent canvas`)
  }
  assert(expected.reduce((bytes, name) => bytes + statSync(join(root, name)).size, 0) < 96 * 1024 * VISUAL_IDS.length,
    'treasure pickup poses exceed 96 KiB per hero or skin')
})

check('Downfall and skin merchant poses are complete, transparent, and edge-capped', () => {
  const characters = [...CHARACTER_IDS.filter((id) => !['ironclad', 'silent', 'defect', 'watcher'].includes(id)), ...SKIN_IDS]
  assertDeepEqual(
    merchantCharacterFiles.filter((file) => characters.some((id) => file === `${id}-standing.webp`)).sort(),
    characters.map((id) => `${id}-standing.webp`).sort(),
    'Downfall/skin merchant pose inventory',
  )
  const groups = [[merchantCharacterRoot, characters.map((id) => `${id}-standing.webp`), MERCHANT_CHARACTER_EDGE]]
  for (const [root, names, [floor, cap]] of groups) {
    const result = spawnSync('webpinfo', ['-summary', ...names.map((file) => join(root, file))], { encoding: 'utf8' })
    assert(result.status === 0, result.stderr || 'could not inspect Downfall/skin noncombat poses')
    const inspected = result.stdout.split(/^File: /m).slice(1)
    assertEqual(inspected.length, names.length, 'decoded Downfall/skin noncombat pose count')
    const faults = inspected.flatMap((block) => {
      const file = block.slice(0, block.indexOf('\n')).split('/').pop()
      const width = Number(block.match(/  Width: (\d+)/)?.[1])
      const height = Number(block.match(/  Height: (\d+)/)?.[1])
      const longEdge = Math.max(width, height)
      return longEdge >= floor && longEdge <= cap && /Alpha:\s+1/.test(block)
        ? [] : [`${file} is ${width}x${height}, alpha ${/Alpha:\s+1/.test(block)}`]
    })
    assertDeepEqual(faults, [], 'Downfall/skin noncombat pose dimensions')
  }
})

check('combat pile and current-deck icons are HUD-sized transparent images', () => {
  assertDeepEqual(combatPileFiles.sort(), ['discard.webp', 'draw.webp', 'exhaust.webp'])
  const files = [
    ...combatPileFiles.map((file) => join(combatPileRoot, file)),
    join(menuRoot, 'current-deck.webp'),
  ]
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect pile icons')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded pile icon count')
  const [floor, cap] = PILE_ICON_EDGE
  for (const block of inspected) {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    const width = Number(block.match(/  Width: (\d+)/)?.[1])
    const height = Number(block.match(/  Height: (\d+)/)?.[1])
    const long = Math.max(width, height)
    assert(long >= floor && long <= cap, `${file} is ${width}x${height}, outside ${floor}-${cap}px`)
    assert(/Alpha:\s+1/.test(block), `${file} has no alpha channel`)
  }
})

check('combat animation effects are complete, transparent, and compact', () => {
  const expected = [
    'death-ash.webp', 'death-ring.webp', 'enemy-motes.webp', 'hero-motes.webp', 'hit-burst.webp',
  ]
  const expectedActions = [
    'awakened-blue-fire.webp', 'awakened-claw-scratch.webp', 'dark-channel.webp',
    'defect-face-orb.webp', 'defect-lightning-beam.webp', 'defect-dark-beam.webp', 'speed-trail.webp', 'downfall-demon-ground-splat.webp',
    'frost-channel.webp', 'guard-bloom.webp', 'hermit-bullet.webp', 'hermit-impact.webp', 'hexaghost-flame-impact.webp',
    'hexaghost-flame.webp',
    'ironclad-bash.webp', 'ironclad-strike.webp', 'lightning-channel.webp', 'magic-burst.webp',
    'potion-burst.webp', 'silent-knife.webp', 'silent-poison.webp', 'silent-shiv.webp',
    'turn-lightning-strike.webp',
    'watcher-calm-aura.webp', 'watcher-meteor-impact.webp', 'watcher-meteor.webp',
    'watcher-pray.webp', 'watcher-wrath-aura.webp',
  ]
  const expectedTurnEffects = [
    'block', 'block-loss', 'buff', 'burn', 'countdown', 'damage', 'dark-evoke',
    'discard', 'draw', 'exhaust', 'frost-passive', 'heal', 'lightning-passive',
    'poison', 'strength', 'strength-loss', 'vulnerable', 'weak',
  ].map(name => `turn-${name}-impact.webp`)
  assertDeepEqual(combatVfxFiles.sort(), expected, 'combat VFX inventory')
  assertDeepEqual(combatActionVfxFiles.sort(), [...expectedActions, ...expectedTurnEffects].sort(), 'personal combat VFX inventory')
  const entryHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8')
  const appSource = readFileSync(join(repoRoot, 'src/ui/App.tsx'), 'utf8')
  for (const file of ['hit-burst.webp', 'death-ash.webp', 'death-ring.webp']) {
    assert(appSource.includes(`'combat/vfx/${file}'`), `${file} is not warmed after registration`)
    assert(entryHtml.includes(`'${file.replace('.webp', '')}'`), `${file} is not warmed for returning players`)
  }
  for (const file of expectedActions.filter((file) => file !== 'downfall-demon-ground-splat.webp' && !file.startsWith('hermit-'))) {
    assert(appSource.includes(`'${file.replace('.webp', '')}'`), `${file} is not warmed after registration`)
    assert(entryHtml.includes(`'${file.replace('.webp', '')}'`), `${file} is not warmed for returning players`)
  }
  assert(!entryHtml.includes('/assets/combat/vfx/actions/downfall-demon-ground-splat.webp'),
    'Demon-only splat is globally preloaded')
  assert(readFileSync(join(repoRoot, 'src/ui/EnemyCard.tsx'), 'utf8')
    .includes("'combat/vfx/actions/downfall-demon-ground-splat.webp'"),
  'Demon splat is not conditionally preloaded with the rendered boss')
  assert(readFileSync(join(repoRoot, 'src/ui/CombatScreen.tsx'), 'utf8')
    .includes("['hermit-bullet', 'hermit-impact']"), 'Hermit assets are not conditionally preloaded')
  const files = [
    ...expected.map((file) => join(combatVfxRoot, file)),
    ...[...expectedActions, ...expectedTurnEffects].map((file) => join(combatActionVfxRoot, file)),
  ]
  const result = spawnSync('webpinfo', ['-summary', ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'could not inspect combat VFX')
  const inspected = result.stdout.split(/^File: /m).slice(1)
  assertEqual(inspected.length, files.length, 'decoded combat VFX count')
  for (const block of inspected) {
    const file = block.slice(0, block.indexOf('\n')).split('/').pop()
    const dimensions = file === 'turn-lightning-strike.webp'
      ? /  Width: 384[\s\S]*  Height: 768/
      : file === 'hermit-bullet.webp' ? /  Width: 256[\s\S]*  Height: 64/
      : file === 'hermit-impact.webp' ? /  Width: 256[\s\S]*  Height: 256/
      : file.startsWith('defect-') && file.endsWith('-beam.webp') ? /  Width: 512[\s\S]*  Height: 128/
      : file === 'speed-trail.webp' ? /  Width: 512[\s\S]*  Height: 256/
      : /  Width: 512[\s\S]*  Height: 512/
    assert(dimensions.test(block), `${file} has incorrect dimensions`)
    assert(/Alpha:\s+1/.test(block), `${file} has no alpha channel`)
  }
  const probe = `
import sys, json
from PIL import Image
faults = []
for name in sys.argv[1:]:
    alpha = Image.open(name).convert("RGBA").getchannel("A")
    w, h = alpha.size
    values = list(alpha.getdata())
    label = name.rsplit("/", 1)[-1]
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]
    transparent = sum(value < 16 for value in values) / len(values)
    visible = sum(value >= 16 for value in values) / len(values)
    if max(corners) > 8:
        faults.append(f"{label}: corners are opaque {corners}")
    elif transparent < 0.5:
        faults.append(f"{label}: only {transparent * 100:.1f}% transparent")
    elif visible < 0.005:
        faults.append(f"{label}: only {visible * 100:.1f}% visible")
print(json.dumps(faults))
`
  const pixelResult = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(pixelResult.status === 0, pixelResult.stderr || 'combat VFX pixel audit requires python3 + Pillow')
  assertDeepEqual(JSON.parse(pixelResult.stdout.trim().split('\n').pop()), [],
    'combat VFX must be visible effects on transparent canvases')
  assert(expected.map((file) => join(combatVfxRoot, file))
    .reduce((bytes, file) => bytes + statSync(file).size, 0) < 320 * 1024,
    'base combat VFX exceed 320 KiB')
  assert(expectedActions.map((file) => join(combatActionVfxRoot, file))
    .reduce((bytes, file) => bytes + statSync(file).size, 0) < 1.5 * 1024 * 1024,
    'personal combat VFX exceed 1.5 MiB')
})

check('bundled stage and generated icon inventories are complete and decodable', () => {
  const expectedStatus = [
    'aoe', 'attack', 'block', 'burn', 'draw', 'energy', 'miracle', 'orb', 'poison',
    'power', 'shiv', 'slime', 'strength', 'vigor', 'vulnerable', 'weak',
  ].map((name) => `${name}.png`)
  const expectedPowers = [
    'accuracy', 'after_image', 'apotheosis', 'barricade', 'capacitor', 'combust', 'consume',
    'corruption', 'dark_embrace', 'defragment', 'demon_form', 'distraction', 'envenom', 'evolve',
    'feel_no_pain', 'footwork', 'fusion', 'heatsinks', 'infinite_blades', 'inflame',
    'machine_learning', 'mayhem', 'metallicize', 'noxious_fumes', 'panache', 'sadistic_nature',
    'storm', 'the_bomb',
  ].map((name) => `${name}.png`).sort()
  assertDeepEqual(statusIconFiles.sort(), expectedStatus, 'status icon inventory')
  assertDeepEqual(powerIconFiles.sort(), expectedPowers, 'Power icon inventory')
  assertDeepEqual(requiredRelicIconFiles.sort(), [...new Set(Object.keys(RELICS)
    .filter((id) => id !== 'hexaghost_starting_relic')
    .map((id) => `${id.replace(/^downfall_/, '')}.png`))].sort(),
    'relic icon inventory')
  assertEqual(relicIconPath('downfall_ninja_scroll'), '/assets/relic-icons/ninja_scroll.png',
    'Downfall variant relics reuse their matching physical icon')
  assertDeepEqual(potionIconFiles.sort(), Object.keys(POTIONS).map((id) => `${id}.png`).sort(),
    'potion icon inventory')
  const stage = join(combatStageRoot, 'stage-act-1.webp')
  assert(existsSync(stage), 'missing Act I combat stage')
  const stageInfo = spawnSync('webpinfo', ['-summary', stage], { encoding: 'utf8' })
  assert(stageInfo.status === 0 && /Width: 3840[\s\S]*Height: 2159/.test(stageInfo.stdout),
    stageInfo.stderr || 'the Act I stage is missing, corrupt, or the wrong size')
  for (const file of [...statusIconFiles.map((name) => join(statusIconRoot, name)),
    ...powerIconFiles.map((name) => join(powerIconRoot, name)),
    ...requiredRelicIconFiles.map((name) => join(relicIconRoot, name)),
    ...potionIconFiles.map((name) => join(potionIconRoot, name))]) {
    const bytes = readFileSync(file)
    assert(bytes.subarray(1, 4).toString() === 'PNG', `${file} is not a PNG`)
    const size = file === join(statusIconRoot, 'vigor.png') ? 128 : 256
    assert(bytes.readUInt32BE(16) === size && bytes.readUInt32BE(20) === size,
      `${file} is not ${size}x${size}`)
    assert(bytes[25] === 6, `${file} is not an RGBA PNG`)
  }
})

check('generated status, relic, and potion icons have transparent backgrounds', () => {
  const files = [
    ...statusIconFiles.map((name) => join(statusIconRoot, name)),
    ...requiredRelicIconFiles.map((name) => join(relicIconRoot, name)),
    ...potionIconFiles.map((name) => join(potionIconRoot, name)),
    join(iconRoot, 'hexaghost-flame.png'),
    join(iconRoot, 'hermit-chamber.png'),
    join(iconRoot, 'hermit-chamber-loaded.png'),
  ]
  const probe = `
import sys, json
from PIL import Image
faults = []
restored_relics = {
    "battle_buddies.png", "black_powder.png", "chronometer.png", "clasped_locket.png",
    "dented_plate.png", "dueling_glove.png", "forbidden_fruit.png", "fuel_canister.png",
    "greed_ooze.png", "knowing_skull.png", "kunai.png", "makeshift_battery.png",
    "pantograph.png", "potion_belt.png", "sack_of_gems.png", "shot_glass.png",
    "shuriken.png", "snecko_egg.png", "straight_razor.png", "teleportation_stone.png",
    "the_broken_seal.png", "thimble_helm.png", "unceasing_top.png", "wheel_of_change.png",
}
for name in sys.argv[1:]:
    alpha = Image.open(name).convert("RGBA").getchannel("A")
    w, h = alpha.size
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]
    visible = sum(1 for value in alpha.getdata() if value > 32) / (w * h)
    bbox = alpha.point(lambda value: 255 if value > 32 else 0).getbbox()
    if max(corners) > 8 or visible < 0.01:
        faults.append(f"{name}: corners={corners}, visible={visible:.3f}")
    elif "/potion-icons/" in name.replace("\\\\", "/") and bbox and min(bbox[0], bbox[1], w - bbox[2], h - bbox[3]) < 8:
        faults.append(f"{name}: alpha bounds {bbox} still contain the old inventory tile")
    elif name.replace("\\\\", "/").split("/")[-1] in restored_relics and (visible > 0.5 or not bbox or min(bbox[0], bbox[1], w - bbox[2], h - bbox[3]) < 8):
        faults.append(f"{name}: visible={visible:.3f}, alpha bounds={bbox}; relic still looks like a framed tile")
print(json.dumps(faults))
`
  const result = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'generated icon audit requires python3 + Pillow')
  const faults = JSON.parse(result.stdout.trim().split('\n').pop())
  assertDeepEqual(faults, [], 'generated icons need transparent corners and visible art')
})

// Bytes are not pixels. Every broken conversion this pipeline can produce —
// keying disabled, luminance inverted, alpha left faint — yields a file well
// over any size threshold while rendering as a white tile or as nothing at
// all. An invisible icon does not look broken, and this pass removed the text
// captions that used to cover for one.
check('every icon is a symbol on transparent paper, not a tile', () => {
  if (iconFiles.length === 0) return // not synced

  // Measured with Pillow, which this pipeline already requires to build the
  // icons in the first place. Hand-rolling a PNG decoder here would be more
  // code than the check.
  const probe = `
import sys, json
from PIL import Image
faults = []
for name in sys.argv[1:]:
    im = Image.open(name).convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    label = name.rsplit("/", 1)[-1]
    if max(corners) > 8:
        faults.append(f"{label}: corners are opaque {corners} - the paper was not keyed out")
        continue
    opaque = [px[x, y] for y in range(h) for x in range(w) if px[x, y][3] > 200]
    fraction = len(opaque) / (w * h)
    if fraction < 0.02:
        faults.append(f"{label}: only {fraction * 100:.1f}% opaque - effectively invisible")
        continue
    # The paper is white, so ANY opaque near-white pixel means it survived the
    # keying. Measured: a correctly keyed icon has none at all; leaving the
    # paper in gives 50-67%. The corners alone cannot catch this, because the
    # extracted images already have transparent margins.
    paper = sum(1 for p in opaque if min(p[0], p[1], p[2]) > 230) / len(opaque)
    if paper > 0.15:
        faults.append(f"{label}: {paper * 100:.0f}% of the symbol is white paper - it renders as a tile")
print(json.dumps(faults))
`
  const files = REQUIRED_ICONS.map((name) => join(iconRoot, `${name}.png`)).filter((file) =>
    existsSync(file),
  )
  const result = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || result.error?.message || 'icon pixel audit requires python3 + Pillow')
  const faults = JSON.parse(result.stdout.trim().split('\n').pop())
  assert(faults.length === 0, `icon conversion is wrong:\n    ${faults.join('\n    ')}`)
})

check('synced artwork is never truncated', () => {
  for (const [dir, files] of [
    [iconRoot, iconFiles],
    [enemyRoot, enemyFiles],
  ]) {
    for (const file of files) {
      assert(statSync(join(dir, file)).size > 512, `${file} looks truncated; re-sync it`)
    }
  }
})

check('every artwork file fully decodes', () => {
  for (const [dir, extension, count] of [
    [cardRoot, 'webp', cardFiles.length],
    [enemyRoot, 'webp', enemyFiles.length],
    [combatEnemyRoot, 'webp', combatEnemyFiles.length],
    [combatCharacterRoot, 'webp', combatCharacterFiles.length],
    [combatVfxRoot, 'webp', combatVfxFiles.length],
    [combatPileRoot, 'webp', combatPileFiles.length],
    [combatStageRoot, 'webp', existsSync(join(combatStageRoot, 'stage-act-1.webp')) ? 1 : 0],
    [iconRoot, 'png', iconFiles.length],
    [statusIconRoot, 'png', statusIconFiles.length],
    [powerIconRoot, 'png', powerIconFiles.length],
    [relicIconRoot, 'png', relicIconFiles.length],
    [potionIconRoot, 'png', potionIconFiles.length],
    [campfireRoot, 'png', listing(campfireRoot, '.png').length],
    [campfireRoot, 'webp', listing(campfireRoot, '.webp').length],
  ]) {
    if (count === 0) continue
    const result = spawnSync('ffmpeg', [
      '-v', 'error', '-pattern_type', 'glob', '-i', join(dir, `*.${extension}`), '-f', 'null', '-',
    ], { encoding: 'utf8' })
    assert(result.status === 0, result.stderr || `could not decode ${dir}/*.${extension}`)
  }
})

const groups = [
  ['cards', cardFiles.length],
  ['icons', iconFiles.length],
]
for (const [name, count] of groups) {
  if (count === 0) console.log(`· ${name} not synced — run \`pnpm sync:assets\``)
}

report('assets')
