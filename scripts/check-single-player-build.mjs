import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { SKIN_IDS } from '../src/game/skins.ts'
import { SKIN_CARD_FACES } from '../src/game/skin-card-faces.ts'

const dist = resolve(process.argv[2] ?? 'dist')
const multiplayer = process.argv.includes('--multiplayer')
const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && ['.css', '.html', '.js'].includes(extname(entry.name)))
  .map((entry) => join(entry.parentPath, entry.name))
const output = files.map((file) => readFileSync(file, 'utf8')).join('\n')

if (!multiplayer) {
  assert(!output.includes('/api/rooms'), 'single-player build still contains the room API')
  assert(!output.includes('Play online'), 'single-player build still contains the multiplayer entry')
}
assert(!output.match(/["'`(]\/(?:assets\/|favicon\.png)/), 'single-player build contains a domain-root asset URL')
assert(!output.match(/["']--combat-stage-image["']:/), 'combat background still resolves relative to the CSS bundle')
assert(!output.match(/["']--campfire-scene["']:`url\("\$\{[\w$]+\(/), 'campfire scene still resolves relative to the CSS bundle')
assert(readFileSync(join(dist, 'index.html'), 'utf8').includes('./assets/'), 'entry assets are not relative')
assert(readFileSync(join(dist, 'index.html'), 'utf8').includes('./favicon.png'), 'favicon is not relative')
assert(existsSync(join(dist, 'assets/cards/relics__boss__empty-cage.webp')), 'Empty Cage card is missing from Pages output')
for (const skin of SKIN_IDS) {
  const face = SKIN_CARD_FACES[skin]?.faces[0]
  assert(face, `${skin} has no skin card faces to ship`)
  assert(existsSync(join(dist, `assets/skin-cards-sm/${skin}/${face}.webp`)), `${skin} skin card faces are missing from Pages output`)
}
assert(existsSync(join(dist, 'assets/relic-icons/empty_cage.png')), 'Empty Cage icon is missing from Pages output')

console.log(`${multiplayer ? 'multiplayer' : 'single-player'} Pages build verified (${files.length} text files)`)
