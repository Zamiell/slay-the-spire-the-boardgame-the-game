import * as v from 'valibot'
import type { CombatQuery, CombatQueryResult } from '../game/combat/preview-queries.ts'
import { CardCharacterChoicesSchema, CardTargetsSchema } from './action-fields.ts'
import { UID_LIMIT } from './actions.ts'
import { CAPS } from '../game/types.ts'

const id = v.pipe(v.string(), v.maxLength(256))
const index = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const ids = v.pipe(v.array(id), v.maxLength(UID_LIMIT))
const targets = v.pipe(v.array(v.nullable(id)), v.maxLength(UID_LIMIT))
const slots = v.pipe(v.array(index), v.maxLength(UID_LIMIT))
const optional = v.optional
const context = v.intersect([
  CardTargetsSchema, CardCharacterChoicesSchema,
  v.object({
    enemyUid: v.nullable(id), playerId: v.nullable(id),
    enemyRow: optional(v.nullable(index)),
    mode: optional(v.pipe(index, v.maxValue(64))),
    energySpent: optional(v.pipe(index, v.maxValue(CAPS.energy))),
    switchWithPlayerId: optional(v.nullable(id)),
    discardUids: optional(ids), exhaustUids: optional(ids),
    shivEnemyUids: optional(targets),
    evokeSlots: optional(slots), evokeEnemyUids: optional(targets),
    spendMiracle: optional(v.boolean()), chooseLoadSelf: optional(v.boolean()),
    secondGuardianModeShift: optional(v.boolean()),
    scryToHandUid: optional(id), metamorphosisPowerUid: optional(id),
    hermitDieRelics: optional(v.pipe(v.array(v.object({
      playerId: id, relicIndex: index, abilityIndex: index,
      enemyUid: optional(v.nullable(id)), targetPlayerId: optional(v.nullable(id)), discardUids: optional(ids),
    })), v.maxLength(UID_LIMIT))),
  }),
])
const cardQuery = {
  cardUid: id, source: v.picklist(['hand', 'chamber', 'copy']), context,
}
const choice = v.object({
  id, enemyUid: optional(id), targetPlayerId: optional(id), exhaustUids: optional(ids),
  guardianModeShift: optional(v.boolean()), shivEnemyUids: targets,
  evokeSlots: optional(slots), evokeEnemyUids: optional(targets),
})
const query = v.variant('kind', [
  v.object({ kind: v.literal('hud'), enemyUid: optional(v.nullable(id)) }),
  v.object({ kind: v.literal('startTurn'), order: ids,
    choices: v.pipe(v.array(choice), v.maxLength(UID_LIMIT)) }),
  v.object({ kind: v.literal('evoke'), ...cardQuery }),
  v.object({ kind: v.literal('shivs'), ...cardQuery }),
  v.object({ kind: v.literal('scryPlay'), ...cardQuery, discarded: ids }),
])
const request = v.object({ combatId: id, version: index, query })

const label = v.pipe(v.string(), v.maxLength(4096))
const target = v.object({ uid: id, label })
const targetOptions = v.pipe(v.array(target), v.maxLength(UID_LIMIT))
const orb = v.picklist(['frost', 'lightning', 'dark'])
const card = v.looseObject({ uid: id, defId: id, upgraded: v.boolean() })
const ability = v.object({
  id, playerId: id, label,
  visual: optional(v.variant('kind', [
    v.object({ kind: v.literal('relic'), relicId: id }),
    v.object({ kind: v.literal('card'), cardUid: id }),
  ])),
  targets: optional(targetOptions), targetDescription: optional(label),
  players: optional(v.pipe(v.array(v.object({ id, label })), v.maxLength(4))),
  exhaustCards: optional(v.pipe(v.array(card), v.maxLength(UID_LIMIT))),
  guardianModeShift: optional(v.literal(true)), enemyTargetStale: optional(v.boolean()),
  overflowShivs: index, staleShivIndex: optional(index), shivTargets: optional(targetOptions),
  evokeChoice: optional(v.object({ index, options: v.pipe(v.array(v.object({ slot: index, orb })), v.maxLength(UID_LIMIT)) })),
  evokeTargets: optional(targetOptions), evokeOrbs: optional(v.pipe(v.array(orb), v.maxLength(UID_LIMIT))),
  evokeTargetIndex: optional(index), evokeTargetless: optional(slots),
  evokePlanOrbs: optional(v.pipe(v.array(v.nullable(orb)), v.maxLength(UID_LIMIT))),
  deferredAfterForcedCard: optional(v.literal(true)),
})
const progress = v.nullable(v.object({ index, options: targetOptions, complete: v.boolean() }))
const damage = v.nullable(v.object({ damage: v.number(), baseline: v.number() }))
const block = v.nullable(v.object({ block: v.number(), baseline: v.number() }))
const result = v.variant('kind', [
  v.object({ kind: v.literal('hud'),
    incoming: v.pipe(v.array(v.tuple([id, v.object({
      damage: v.number(), wastedBlock: v.number(), frostBlock: optional(v.number()),
      hiddenHandEffects: optional(v.literal(true)),
    })])), v.maxLength(4)),
    cards: v.pipe(v.array(v.object({ uid: id, block,
      damage: v.pipe(v.array(v.object({ enemyUid: v.nullable(id), value: damage })), v.maxLength(UID_LIMIT)),
    })), v.maxLength(UID_LIMIT)),
  }),
  v.object({ kind: v.literal('startTurn'), abilities: v.pipe(v.array(ability), v.maxLength(UID_LIMIT)) }),
  v.object({ kind: v.literal('evoke'), progress }),
  v.object({ kind: v.literal('shivs'), progress }),
  v.object({ kind: v.literal('scryPlay'), eligible: v.nullable(ids) }),
])
const reply = v.variant('status', [
  v.object({ status: v.literal('ready'), combatId: id, version: index, result }),
  v.object({ status: v.literal('stale'), combatId: id, version: index }),
])

export type CombatQueryRequest = { combatId: string; version: number; query: CombatQuery }
export type CombatQueryReply =
  | { status: 'ready'; combatId: string; version: number; result: CombatQueryResult }
  | { status: 'stale'; combatId: string; version: number }
export const parseCombatQuery = (value: unknown): CombatQueryRequest => v.parse(request, value)
export const decodeCombatQueryReply = (value: unknown): CombatQueryReply => v.parse(reply, value)
