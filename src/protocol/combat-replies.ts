import * as v from 'valibot'

export const ReplyIdSchema = v.pipe(v.string(), v.maxLength(256))
export const ReplyIndexSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
export const ReplyLabelSchema = v.pipe(v.string(), v.maxLength(4096))
export const EnemyTargetSchema = v.object({ uid: ReplyIdSchema, label: ReplyLabelSchema })
export const PlayerTargetSchema = v.object({ id: ReplyIdSchema, label: ReplyLabelSchema })
export const OrbSchema = v.picklist(['frost', 'lightning', 'dark'])
const card = v.looseObject({ uid: ReplyIdSchema, defId: ReplyIdSchema, upgraded: v.boolean() })
const targets = v.array(EnemyTargetSchema)
const slots = v.array(ReplyIndexSchema)

/** Snapshot and calculation replies describe the same public ability. Request budgets are separate. */
export const StartTurnAbilitySchema = v.object({
  id: ReplyIdSchema, playerId: ReplyIdSchema, label: ReplyLabelSchema,
  visual: v.optional(v.variant('kind', [
    v.object({ kind: v.literal('relic'), relicId: ReplyIdSchema }),
    v.object({ kind: v.literal('card'), cardUid: ReplyIdSchema }),
  ])),
  targets: v.optional(targets), targetDescription: v.optional(ReplyLabelSchema),
  players: v.optional(v.array(PlayerTargetSchema)),
  exhaustCards: v.optional(v.array(card)),
  guardianModeShift: v.optional(v.literal(true)), enemyTargetStale: v.optional(v.boolean()),
  overflowShivs: ReplyIndexSchema, staleShivIndex: v.optional(ReplyIndexSchema),
  shivTargets: v.optional(targets),
  evokeChoice: v.optional(v.object({ index: ReplyIndexSchema,
    options: v.array(v.object({ slot: ReplyIndexSchema, orb: OrbSchema })) })),
  evokeTargets: v.optional(targets), evokeOrbs: v.optional(v.array(OrbSchema)),
  evokeTargetIndex: v.optional(ReplyIndexSchema), evokeTargetless: v.optional(slots),
  evokePlanOrbs: v.optional(v.array(v.nullable(OrbSchema))),
  deferredAfterForcedCard: v.optional(v.literal(true)),
})

export type WireEnemyTarget = v.InferOutput<typeof EnemyTargetSchema>
export type WirePlayerTarget = v.InferOutput<typeof PlayerTargetSchema>
export type WireStartTurnAbility = v.InferOutput<typeof StartTurnAbilitySchema>
