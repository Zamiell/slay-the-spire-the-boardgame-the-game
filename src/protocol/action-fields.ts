import * as v from 'valibot'
import { idList, safeWholeNumber, wholeNumber } from './actions.ts'

const ids = (message: string) => v.optional(idList(message))
const id = (message: string) => v.optional(v.string(message))
const spend = (label: string) => {
  const message = `${label} must be a non-negative whole number`
  return v.optional(v.pipe(safeWholeNumber(message), v.minValue(0, message)))
}
const recoverDiscardUid = id('Discard recovery must be a card id')
const recoverExhaustUid = id('Exhaust recovery must be a card id')
const energySpent = v.optional(wholeNumber('X Energy must be a whole number'))
const corruptedShardMode = v.optional(v.picklist(
  ['attack', 'defense'], 'Corrupted Shard Mode must be attack or defense',
))
const guardianPowerCardUid = id('Power Beam must identify a Power card')
const spendVigor = spend('Vigor spend')
const guardianBlockSpend = spend('Guardian Block spend')

// These are ordered field groups, not complete action validators. The writer
// invokes each group at its original position among ownership and legality checks.
export const CardTargetsSchema = v.intersect([
  v.pipe(v.object({
    enemyUids: ids('Enemy choices must be a list of ids'),
    playerIds: ids('Player choices must be a list of ids'),
    scryDiscardUids: ids('Scry choices must be a list of card ids'),
    topdeckUids: ids('Topdeck choices must be a list of card ids'),
    searchDrawUids: ids('Draw-pile choices must be a list of card ids'),
    recoverDiscardUid,
    recoverDiscardUids: ids('Discard recovery must be a list of card ids'),
  }), v.check((value) => value.recoverDiscardUid === undefined || value.recoverDiscardUids === undefined,
    'Discard recovery must use one choice format')),
  v.pipe(v.object({
    recoverExhaustUid,
    recoverExhaustUids: ids('Exhaust recovery must be a list of card ids'),
  }), v.check((value) => value.recoverExhaustUid === undefined || value.recoverExhaustUids === undefined,
    'Exhaust recovery must use one choice format')),
  v.object({ energySpent, corruptedShardMode }),
])

export const CardCharacterChoicesSchema = v.object({
  loadUids: ids('Load choices must be a list of ids'),
  chamberUids: ids('Chamber choices must be a list of ids'),
  hermitEnemyUids: ids('Hermit enemy choices must be a list of ids'),
  slimeUids: ids('Slime choices must be a list of ids'),
  slimeEnemyUids: ids('Slime enemy choices must be a list of ids'),
  soulburnEnemyUids: ids('Soulburn enemy choices must be a list of ids'),
  spendVigor,
  guardianBlockSpend,
  guardianModeShift: v.optional(v.boolean('Guardian Mode shift must be true or false')),
  guardianPowerCardUid,
})

// Chamber plays historically report field names and check both recovery ids
// before either exclusive-format constraint. Preserve that order.
export const ChamberChoicesSchema = v.intersect([
  v.pipe(v.object({
    enemyUids: ids('enemyUids must be a list of ids'),
    playerIds: ids('playerIds must be a list of ids'),
    scryDiscardUids: ids('scryDiscardUids must be a list of ids'),
    topdeckUids: ids('topdeckUids must be a list of ids'),
    searchDrawUids: ids('searchDrawUids must be a list of ids'),
    recoverDiscardUids: ids('recoverDiscardUids must be a list of ids'),
    recoverExhaustUids: ids('recoverExhaustUids must be a list of ids'),
    loadUids: ids('loadUids must be a list of ids'),
    chamberUids: ids('chamberUids must be a list of ids'),
    hermitEnemyUids: ids('hermitEnemyUids must be a list of ids'),
    slimeUids: ids('slimeUids must be a list of ids'),
    slimeEnemyUids: ids('slimeEnemyUids must be a list of ids'),
    soulburnEnemyUids: ids('soulburnEnemyUids must be a list of ids'),
    recoverDiscardUid,
    recoverExhaustUid,
  }),
  v.check((value) => value.recoverExhaustUid === undefined || value.recoverExhaustUids === undefined,
    'Exhaust recovery must use one choice format'),
  v.check((value) => value.recoverDiscardUid === undefined || value.recoverDiscardUids === undefined,
    'Discard recovery must use one choice format')),
  v.object({ energySpent, corruptedShardMode, guardianPowerCardUid, spendVigor, guardianBlockSpend }),
])

export const PowerChoicesSchema = v.object({
  loadUids: ids('Load choices must be a list of ids'),
  chamberUids: ids('Chamber choices must be a list of ids'),
  hermitEnemyUids: ids('Hermit enemy choices must be a list of ids'),
  scryDiscardUids: ids('Scry choices must be a list of ids'),
  exhaustUids: ids('Exhaust choices must be a list of ids'),
})

export const TriggerTargetsSchema = v.object({
  enemyRow: v.optional(wholeNumber('Triggered ability row must be a whole number')),
  enemyUid: id('Triggered ability enemy must be a valid id'),
  targetPlayerId: id('Triggered ability player must be a valid id'),
  slimeUids: ids('Triggered Slime choices must be a list of ids'),
  slimeEnemyUids: ids('Triggered Slime targets must be a list of ids'),
})

export type CardTargets = v.InferOutput<typeof CardTargetsSchema>
export type CardCharacterChoices = v.InferOutput<typeof CardCharacterChoicesSchema>
export type ChamberChoices = v.InferOutput<typeof ChamberChoicesSchema>
export type PowerChoices = v.InferOutput<typeof PowerChoicesSchema>
export type TriggerTargets = v.InferOutput<typeof TriggerTargetsSchema>

export function parseActionFields<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: T, input: unknown,
): { status: 'valid'; fields: v.InferOutput<T> } | { status: 'invalid'; error: string } {
  const result = v.safeParse(schema, input, { abortEarly: true })
  return result.success
    ? { status: 'valid', fields: result.output }
    : { status: 'invalid', error: result.issues[0].message }
}
