// Every base-game Boss has one hardest-hitting turn that gets a signature effect.
// This pins which rotation slot that is, so a rebalanced rotation or a new Boss
// cannot silently lose (or wrongly gain) the spectacle, and keeps the stylesheet
// and the preloader in step with the rules.
import { readFileSync } from 'node:fs'
import { ENEMIES, actionsFor, enemyDef } from '../src/game/enemies.ts'
import {
  BOSS_CONTACT_MS, BOSS_HEAVY_HIT_GAP_MS, bossAttackDurationFor, bossHeavyArtFor, bossHeavyAttackFor,
} from '../src/ui/combat-vfx.ts'
import { suite, check, assertDeepEqual, assertEqual, assert, report } from './lib/harness.mjs'

// Slot index within each Boss's cube. Donu and Deca have no standout turn.
const HEAVY_SLOTS = {
  slime_boss: { kind: 'slime-crush', slots: [2] },
  guardian_attack: { slots: [] },
  guardian_defensive: { kind: 'guardian-bash', slots: [1] },
  hexaghost: { kind: 'hexaghost-inferno', slots: [5], hits: 2 },
  the_collector: { kind: 'collector-fireball', slots: [2] },
  the_champ: { kind: 'champ-execute', slots: [2] },
  the_champ_fury: { kind: 'champ-flurry', slots: [1], hits: 2 },
  bronze_automaton: { kind: 'automaton-beam', slots: [3] },
  awakened_one_phase_1: { kind: 'awakened-rend', slots: [1] },
  awakened_one_phase_2: { kind: 'awakened-eruption', slots: [0] },
  time_eater: { kind: 'time-crush', slots: [2] },
  donu: { slots: [] },
  deca: { slots: [] },
  corrupt_heart: { kind: 'heart-pulse', slots: [1] },
}

suite('boss heavy attacks › rotation')
const baseBosses = Object.values(ENEMIES).filter(def => def.isBoss && !def.id.startsWith('downfall_')).map(def => def.id)
check('every base Boss has a decision', () => {
  assertDeepEqual([...baseBosses].sort(), Object.keys(HEAVY_SLOTS).sort())
})
for (const [id, expected] of Object.entries(HEAVY_SLOTS)) {
  for (const ascension of [0, 10, 13]) {
    check(`${id} A${ascension}`, () => {
      const def = enemyDef(id, ascension)
      const slots = def.pattern.kind === 'cube' ? def.pattern.slots : []
      const heavy = slots.flatMap((_, index) => {
        const result = bossHeavyAttackFor(id, actionsFor(def, 1, index))
        return result ? [{ index, ...result }] : []
      })
      assertDeepEqual(heavy.map(entry => entry.index), expected.slots)
      for (const entry of heavy) {
        assertEqual(entry.kind, expected.kind)
        assertEqual(entry.hits, expected.hits ?? 1)
      }
    })
  }
}

suite('boss heavy attacks › strength is not spectacle')
check('a stronger Slime Boss swing is the same signature', () => {
  assertEqual(bossHeavyAttackFor('slime_boss', [{ kind: 'attack', amount: 6 }])?.kind, 'slime-crush')
  assertEqual(bossHeavyAttackFor('slime_boss', [{ kind: 'attack', amount: 3 }, { kind: 'status', card: 'slimed', amount: 2, aoe: true }]), undefined)
})

suite('boss heavy attacks › stylesheet')
const css = readFileSync(new URL('../src/ui/styles/boss-heavy-attacks.css', import.meta.url), 'utf8')
check('timing constants match the TypeScript clock', () => {
  assert(css.includes(`--heavy-contact: ${BOSS_CONTACT_MS}ms;`), 'contact')
  assert(css.includes(`--heavy-gap: ${BOSS_HEAVY_HIT_GAP_MS}ms;`), 'gap')
  assert(css.includes(`--heavy-total: ${bossAttackDurationFor('slime_boss')}ms;`), 'total')
})
check('every signature is styled', () => {
  for (const { kind } of Object.values(HEAVY_SLOTS)) {
    if (kind) assert(css.includes(`[data-heavy-attack='${kind}']`), kind)
  }
})
check('every painted asset is preloaded', () => {
  const painted = new Set([...css.matchAll(/url\('\/(assets\/[^']+)'\)/g)].map(match => match[1]))
  const preloaded = new Set(Object.keys(HEAVY_SLOTS).flatMap(bossHeavyArtFor).map(path => path.replace(/^.*?(assets\/)/, '$1')))
  for (const path of painted) assert(preloaded.has(path), `${path} is painted but not preloaded`)
})

report('boss heavy attacks')
