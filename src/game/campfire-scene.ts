// Which campfire scene lights a party. Pure: the painted scenes and the skin registry are parameters.
import { SKIN_IDS, VISUAL_IDS, characterOfSkin } from './skins.ts'

/** The art keys in party-name order, and the hero each skin dresses. */
export interface CampfireRegistry {
  readonly order: readonly string[]
  readonly heroOfSkin: Readonly<Record<string, string>>
}

const REGISTRY: CampfireRegistry = {
  order: VISUAL_IDS,
  heroOfSkin: Object.fromEntries(SKIN_IDS.map((skin) => [skin, characterOfSkin(skin)])),
}

/** Every subset of `items` keeping their order, larger subsets first, equal sizes in `items` order. */
function subsetsLargestFirst<T>(items: readonly T[]): T[][] {
  const subsets: T[][] = []
  const grow = (start: number, chosen: T[]) => {
    subsets.push([...chosen])
    for (let index = start; index < items.length; index += 1) {
      chosen.push(items[index]!)
      grow(index + 1, chosen)
      chosen.pop()
    }
  }
  grow(0, [])
  return subsets.sort((a, b) => b.length - a.length)
}

/**
 * The scene name (a party joined by `_`, `''` for the empty camp) that lights `visuals`.
 *
 * A scene is named by the party's visual ids in `order`, each hero once: a skin's id where
 * the skin is worn, else the character's id. The scene must be listed in `scenes`. Otherwise
 * the worn skins are dropped as little as possible. Each candidate keeps a subset of them and
 * shows every dropped skin's hero by its character id. Candidates are tried by keeping the
 * most skins first and, among equals, the earliest skins in `order`. The empty camp is the last resort.
 */
export function campfireParty(
  visuals: readonly string[],
  scenes: readonly string[],
  { order, heroOfSkin }: CampfireRegistry = REGISTRY,
): string {
  const party = order.filter((visual) => visuals.includes(visual))
  const worn = party.filter((visual) => Object.hasOwn(heroOfSkin, visual))
  for (const kept of subsetsLargestFirst(worn)) {
    const shown = new Set(party.map((visual) => worn.includes(visual) && !kept.includes(visual) ? heroOfSkin[visual]! : visual))
    const name = order.filter((visual) => shown.has(visual)).join('_')
    if (name && scenes.includes(name)) return name
  }
  return ''
}
