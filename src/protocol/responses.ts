import * as v from 'valibot'
import { CHARACTER_IDS } from '../game/types.ts'
import { normalizeCardPacks } from '../game/packs.ts'
import { normalizeSkins } from '../game/skins.ts'

const number = v.pipe(v.number(), v.finite())
const count = v.pipe(number, v.safeInteger(), v.minValue(0))
const optionalCount = v.optional(count)
const nullableNumber = v.nullable(number)
const character = v.picklist(CHARACTER_IDS)
const card = v.looseObject({ defId: v.string(), upgraded: v.boolean(), attachedGemId: v.optional(v.string()) })
const metrics = { runs: count, averageFloors: nullableNumber, averageDamage: nullableNumber, averageBlock: nullableNumber }

export const ProfileClaimReply = v.looseObject({ username: v.string() })
export const LoginReply = v.looseObject({ username: v.string(), token: v.string(), restricted: v.optional(v.boolean()) })
export const StandingReply = v.looseObject({ restricted: v.boolean() })
export const AscensionReply = v.looseObject({ highestAscension: count })
export const ProfileStatsReply = v.looseObject({
  runs: count, act3Wins: count, act4Wins: count, bestFloors: count, bestAscensionWon: v.nullable(count),
  dailyClimbs: count, firstRunAt: v.nullable(count), lastRunAt: v.optional(v.nullable(count)),
  heroes: v.array(v.looseObject({ character: v.string(), runs: count, wins: count })),
})
export const WalletReplySchema = v.union([
  v.object({ registered: v.literal(false) }),
  v.object({
    wallet: v.looseObject({
      version: v.literal(1), coins: count, dailyCoinsEarned: optionalCount,
      packs: v.pipe(v.array(v.string()), v.transform((ids: string[]) => normalizeCardPacks(ids))),
      skins: v.pipe(v.array(v.string()), v.transform((ids: string[]) => normalizeSkins(ids))),
      addPacksToRuns: v.boolean(), credited: v.record(v.string(), count),
    }),
    purchase: v.optional(v.looseObject({ ok: v.boolean(), reason: v.optional(v.string()) })),
  }),
])

const letter = v.looseObject({ id: v.string(), from: v.picklist(['player', 'developer']), body: v.string(), at: count })
export const MailboxReply = v.object({
  letters: v.array(letter), unread: count, personalUnread: optionalCount, admin: v.optional(v.boolean(), false),
})
export const MailDeskReply = v.object({
  threads: v.array(v.looseObject({
    username: v.string(), unread: count, lastAt: count,
    lastFrom: v.optional(v.picklist(['player', 'developer'])), preview: v.optional(v.string()), letters: v.optional(v.array(letter)),
  })),
  unread: count,
})
export const StatsReply = v.looseObject({
  ...metrics, pending: count,
  rows: v.array(v.looseObject({ ...metrics, deckType: v.string(), character })),
  nextCards: v.array(v.looseObject({
    ...metrics, defId: v.string(), deltaFloors: nullableNumber, deltaDamage: nullableNumber, deltaBlock: nullableNumber,
  })),
})
export const SampleDeckReply = v.looseObject({ deckType: v.string(), character, cards: v.array(card) })
export const LeaderboardReply = v.looseObject({
  totalRuns: count,
  rows: v.array(v.looseObject({
    character, characters: v.optional(v.array(character)), ascension: count, runs: count,
    act3Runs: count, act3Wins: count, act3WinRate: nullableNumber, averageDamagePerFight: nullableNumber,
    averageDamageBlocked: nullableNumber, averageFloorsCleared: v.optional(nullableNumber), act4Wins: count,
  })),
})
export const DailyLeaderboardReply = v.looseObject({
  date: v.string(), total: count,
  rows: v.array(v.looseObject({
    rank: count, username: v.string(), character, floorsCleared: count, highestBossActDefeated: count,
    averageDamagePerFight: nullableNumber, damageBlockedRate: nullableNumber, cards: v.array(card),
  })),
})
export const WinningDecksReply = v.looseObject({
  total: count, nextCursor: v.nullable(v.string()),
  rows: v.array(v.looseObject({
    id: v.string(), character, characters: v.optional(v.array(character)), ascension: count, cardCount: count,
    username: v.string(), recordedAt: count, cards: v.array(card),
  })),
})
export const LeaderboardAcknowledgement = v.looseObject({
  floorsClearedAccepted: v.optional(v.boolean()), finalDeckAccepted: v.optional(v.boolean()),
  profileAccepted: v.optional(v.boolean()), dailyDateAccepted: v.optional(v.boolean()),
  dailyCoinsAccepted: v.optional(v.boolean()),
})
