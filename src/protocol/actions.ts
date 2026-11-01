import * as v from 'valibot'

export const UID_LIMIT = 32

const wholeNumber = (message: string) => v.pipe(v.number(message), v.integer(message))
const safeWholeNumber = (message: string) => v.pipe(v.number(message), v.safeInteger(message))
const idList = (message: string) => v.pipe(v.array(v.string(message), message), v.maxLength(UID_LIMIT, message))

export const RoomCredentialsSchema = v.looseObject({
  code: v.string(),
  token: v.string(),
})
export type RoomCredentials = v.InferOutput<typeof RoomCredentialsSchema>

export const DieRelicChoiceActionSchema = v.looseObject({
  kind: v.literal('resolveDieRelicChoice'),
  choiceId: wholeNumber('Die Relic choice id must be a whole number'),
  enemyUid: v.optional(v.nullable(v.string('Die Relic enemy must be a valid id'))),
  discardUids: v.optional(idList('Discard choices must be a list of card ids')),
  exhaustUids: v.optional(idList('Exhaust choices must be a list of card ids')),
})

const playerChoiceKeys = new Set([
  'kind', 'choiceId', 'draw', 'discardUid', 'count', 'type', 'requestId', 'preflight',
])
const PlayerChoiceIdSchema = v.object({
  kind: v.literal('resolvePlayerChoice'),
  choiceId: wholeNumber('No card choice is pending'),
})

// This action historically rejects extra answer fields, unlike other actions.
// Validate that restriction before its optional answer fields to preserve errors.
export const PlayerChoiceActionSchema = v.pipe(
  v.unknown(),
  v.check(
    // Check the raw keys before looseObject drops unsafe property names.
    (action) => !v.is(PlayerChoiceIdSchema, action) ||
      Object.keys(action).every((key) => playerChoiceKeys.has(key)),
    'A card choice answer carries only draw, discardUid or count',
  ),
  v.looseObject({
    kind: v.literal('resolvePlayerChoice'),
    choiceId: wholeNumber('No card choice is pending'),
    draw: v.optional(v.boolean('Draw must be true or false')),
    discardUid: v.optional(v.string('Discard must be a card id')),
    count: v.optional(safeWholeNumber('Count must be a whole number')),
  }),
)

export const SlayerChoiceActionSchema = v.looseObject({
  kind: v.literal('resolveSlayerChoice'),
  enemyUid: v.optional(v.nullable(v.string('A Nightmare target must be an enemy id'))),
  replace: v.optional(v.boolean('Replace must be true or false')),
  // Absent ids remain valid for choices restored from old saves.
  choiceId: v.optional(safeWholeNumber('The choice id must be a whole number')),
})

export type DieRelicChoiceAction = v.InferOutput<typeof DieRelicChoiceActionSchema>
export type PlayerChoiceAction = v.InferOutput<typeof PlayerChoiceActionSchema>
export type SlayerChoiceAction = v.InferOutput<typeof SlayerChoiceActionSchema>
export type ValidatedChoiceAction = DieRelicChoiceAction | PlayerChoiceAction | SlayerChoiceAction

type ChoiceActionParseResult =
  | { status: 'valid'; action: ValidatedChoiceAction }
  | { status: 'invalid'; error: string }
  | { status: 'unsupported' }

const ChoiceKindSchema = v.object({ kind: v.string() })

/**
 * Deliberately covers only these migrated action families, not the whole dispatcher.
 * Unsupported actions must still go through their existing validation and legality checks.
 */
export function parseChoiceAction(input: unknown): ChoiceActionParseResult {
  const envelope = v.safeParse(ChoiceKindSchema, input)
  if (!envelope.success) return { status: 'unsupported' }
  let result
  switch (envelope.output.kind) {
    case 'resolveDieRelicChoice':
      result = v.safeParse(DieRelicChoiceActionSchema, input, { abortEarly: true })
      break
    case 'resolvePlayerChoice':
      result = v.safeParse(PlayerChoiceActionSchema, input, { abortEarly: true })
      break
    case 'resolveSlayerChoice':
      result = v.safeParse(SlayerChoiceActionSchema, input, { abortEarly: true })
      break
    default:
      return { status: 'unsupported' }
  }
  return result.success
    ? { status: 'valid', action: result.output }
    : { status: 'invalid', error: result.issues[0].message }
}
