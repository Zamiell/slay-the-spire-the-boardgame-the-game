// Regenerates cards/<owner>.json (the catalogue the skin art pipeline reads for one character: its attack, skill and power
// cards; a skin that gives a card type another frame, like the Slime Boss `slime` creature cards, has no entry for it):
//   node --experimental-strip-types scripts/art/skin-cards/dump-cards.mjs [owner ...]   (default: every skinned owner)
import { writeFileSync } from 'node:fs'
import { CARDS } from '../../../src/game/cards.ts'
import { SKINS } from '../../../src/game/skins.ts'
import '../../../src/game/downfall/slime-boss.ts'   // registers the Slime Boss cards into CARDS

const owners = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SKINS)
for (const owner of owners) {
  const cards = Object.values(CARDS)
    .filter((card) => card.owner === owner && ['attack', 'skill', 'power'].includes(card.type))
    .map((card) => ({ id: card.id, name: card.name, type: card.type, rarity: card.rarity, cost: card.cost,
      ...(card.pack ? { pack: card.pack } : {}), text: card.printedText ?? null }))
  writeFileSync(new URL(`./cards/${owner}.json`, import.meta.url), `${JSON.stringify(cards, null, 1)}\n`)
  console.log(`${cards.length} ${owner} cards`)
}
