import type { CardDef, Effect, SlimeBossEffect } from '../../src/game/cards.ts'
import { HERMIT_CARD_DEFS } from '../../src/game/downfall/hermit.ts'
import { HEXAGHOST_CARDS } from '../../src/game/downfall/hexaghost.ts'

declare const slime: SlimeBossEffect
const effect: Effect = slime
const hermit: Readonly<Record<string, CardDef>> = HERMIT_CARD_DEFS
const hexaghost: Readonly<Record<string, CardDef>> = HEXAGHOST_CARDS
// @ts-expect-error Expansion opcodes must belong to the canonical engine vocabulary.
const badKind: (typeof HERMIT_CARD_DEFS)[string]['effects'][number] = { kind: 'notAnEngineEffect' }
// @ts-expect-error Expansion effect payloads retain the canonical field types.
const badAmount: (typeof HEXAGHOST_CARDS)['sear']['effects'][number] = { kind: 'hit', amount: 'two' }
// @ts-expect-error Slime Commands need a real amount.
const missingAmount: Effect = { kind: 'commandSlime' }
void [effect, hermit, hexaghost, badKind, badAmount, missingAmount]
