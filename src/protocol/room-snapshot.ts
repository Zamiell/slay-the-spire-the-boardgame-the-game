import * as v from 'valibot'
import { CHARACTER_IDS } from '../game/types.ts'
import type { RoomSnapshot } from './room.ts'

export const ROOM_SNAPSHOT_VERSION = 1
const text = v.string()
const number = v.pipe(v.number(), v.finite())
const count = v.pipe(number, v.safeInteger(), v.minValue(0))
const strings = v.array(text)
const optional = v.optional
const object = v.looseObject
const dictionary = <Schema extends v.GenericSchema>(schema: Schema) => v.record(text, schema)
const record = v.record(text, v.unknown())
const card = object({
  uid: text, defId: text, upgraded: v.boolean(), attachedGemId: optional(text),
  counter: optional(number), costReductionThisTurn: optional(number), playWindowCost: optional(number),
  endTurnProtected: optional(v.boolean()), retainedLastTurn: optional(v.boolean()),
  retainThisTurn: optional(v.boolean()), mayRetainThisTurn: optional(v.boolean()),
  metamorphosis: optional(object({ upgraded: v.boolean(), sourceUid: text, copiedX: optional(number) })),
})
const cards = v.array(card)
const relic = object({ defId: text, spent: v.boolean(), uses: optional(number), cubes: optional(number),
  pending: optional(v.boolean()), pendingId: optional(number) })
const seat = object({ playerId: text, name: text, character: v.picklist(CHARACTER_IDS),
  skin: optional(text), connected: v.boolean(), cardPacks: optional(strings) })
const player = object({
  id: text, name: text, character: v.picklist(CHARACTER_IDS), skin: optional(text),
  row: number, hp: number, maxHp: number, block: number, energy: number, gold: number,
  strength: number, vulnerable: number, weak: number, dead: v.boolean(),
  strengthLossAtEndOfTurn: number, lostHpThisCombat: v.boolean(), attacksPlayedThisTurn: number,
  shivDamageBonus: number, cardBlockBonus: number, hitPoison: number, wrathAttackDamageBonus: number,
  chamberSlots: number, heat: number, soulburn: number, vigor: number, vigorSpentThisTurn: number,
  guardianMode: v.nullable(v.picklist(['attack', 'defense'])),
  slimes: v.array(object({ card, level: number, vigor: number, commandsThisTurn: number, vigorLossAtEndOfTurn: number })),
  damageStats: optional(object({ attack: number, poison: number, special: number, taken: number, blocked: number })),
  nextCardCost: optional(v.nullable(number)), enemyNextCardCost: optional(v.nullable(number)),
  nextPowerOrSlimeDiscount: optional(v.union([number, v.literal('free')])),
  drawLocked: v.boolean(), cardPlayLocked: v.boolean(), powerPlayedThisTurn: v.boolean(),
  deck: v.nullable(cards), draw: v.nullable(cards), hand: v.nullable(cards), chamber: v.nullable(cards),
  discard: cards, exhaust: cards, powers: cards, relics: v.array(relic), potions: strings,
  deckCount: count, drawCount: count, handCount: count, chamberCount: count,
  cardRewardCount: count, rareRewardCount: count, tradableDeckCount: count,
  orbs: v.array(v.nullable(v.picklist(['lightning', 'frost', 'dark']))),
  shivs: number, miracles: number, stance: v.picklist(['neutral', 'calm', 'wrath']),
  transformAvailable: optional(v.boolean()),
})
const enemy = object({
  uid: text, defId: text, row: number, hp: number, maxHp: number, dead: v.boolean(),
})
const target = object({ uid: text, label: text })
const ability = object({
  id: text, playerId: text, label: text, overflowShivs: number,
  targets: optional(v.array(target)), exhaustCards: optional(cards),
  players: optional(v.array(object({ id: text, name: text }))),
  evokeSlots: optional(v.array(number)),
})
const trigger = object({ id: number, playerId: text, sourceId: text })
const reveal = object({ playerId: text, cards: v.nullable(cards) })
const combat = object({
  combatId: text, phase: v.picklist(['start', 'player', 'discard', 'copy', 'enemy', 'roundEnd', 'won', 'lost']),
  turn: number, die: number, lastStand: v.boolean(), potionLimit: number,
  players: v.array(player), enemies: v.array(object({ ...enemy.entries, block: number, strength: number,
    vulnerable: number, weak: number, poison: number, actionIndex: number, abilityUsed: v.boolean() })), log: strings,
  powerTriggersUsedThisTurn: strings, pendingTriggers: v.array(trigger), nextTriggerId: number,
  playedCardsThisTurn: v.array(object({ playerId: text, card: card })),
  pendingSummons: v.array(object({ sourceUid: text, row: number, defIds: strings, turn: number })),
  pendingDistilled: optional(reveal), pendingRelicScry: optional(reveal),
  pendingCardCopy: optional(object({ id: number, playerId: text, card, energySpent: number,
    resumePhase: text, forcedExhaust: v.boolean(), forcedChoices: v.nullable(v.array(record)), deferredHavocs: v.array(record) })),
  startTurnProgress: optional(object({ choices: v.array(record) })),
  presentationEvents: optional(v.array(object({ seq: number, kind: text }))),
})
const map = object({
  position: v.nullable(text), rows: v.array(strings),
  rooms: dictionary(object({ id: text, row: number, column: number, kind: text, visited: v.boolean(), exits: strings })),
})
const prepared = object({
  combatId: optional(text), players: v.array(object({ id: text, hand: v.nullable(cards) })),
  enemies: v.array(enemy),
})
const room = v.variant('kind', [
  object({ kind: v.literal('merchant'), relics: v.array(v.nullable(text)), potions: v.array(v.nullable(text)),
    colorless: v.array(v.nullable(text)), cards: dictionary(object({ choices: v.array(v.nullable(text)) })),
    removalUsed: strings }),
  object({ kind: v.picklist(['treasure', 'elite']), offers: dictionary(v.nullable(text)),
    playerIds: strings, decisions: dictionary(v.union([text, number])) }),
  object({ kind: v.literal('event'), card: object({ id: text, instanceId: text, name: text,
    options: v.array(object({ id: text, label: text, description: text, effects: v.array(object({ tag: text })) })) }),
    decisions: dictionary(object({ optionIds: strings })), dieRolls: dictionary(v.array(number)),
    pendingDecisions: optional(dictionary(object({ optionIds: strings }))),
    rewardOffers: optional(dictionary(v.array(strings))), itemOffers: optional(dictionary(v.array(object({ kind: text, id: text })))),
    preparedCombat: optional(prepared), preparedStartTurnScry: optional(reveal) }),
])
const campaignProgress = object({
  colorless: number, actIV: number, highestAscension: number, unspentMarks: number, nextRunNumber: number,
})
const run = object({
  phase: v.picklist(['neow', 'map', 'combat', 'reward', 'betweenCombat', 'room', 'setup', 'victory', 'defeat']),
  act: number, ascension: number, chooseYourRelic: v.boolean(), lastStand: v.boolean(),
  meta: object({ mode: text, modifierIds: strings }), log: strings,
  setup: v.nullable(object({ kind: text, playerIds: strings, targetAct: number, rowIndex: number,
    repeatIndex: number, playerIndex: number, die: v.nullable(object({ value: number, effectIndex: number })) })),
  neow: v.nullable(object({ players: dictionary(v.nullable(object({
    redRewardPending: v.boolean(), blueOption: v.nullable(number), availableSources: strings, done: v.boolean(),
  }))) })),
  players: v.array(player), map, combat: v.nullable(combat), roomState: v.nullable(room),
  pendingBossDefId: v.nullable(text), actBossDefId: v.nullable(text),
  pendingGuardianSockets: v.array(object({ playerId: text, cardUid: text, gemIds: strings })),
  rewards: v.array(object({ playerId: text, gold: optional(v.union([v.literal(false), number])), cardReward: v.boolean(),
    choices: v.nullable(strings), upgraded: v.boolean(),
    potion: v.union([v.literal(false), v.null(), text]),
    relic: optional(v.union([v.literal(false), v.null(), text])),
    bossRelics: optional(v.union([v.literal(false), strings])), transformReward: optional(v.boolean()) })),
  courier: object({ usedBy: strings, offer: v.nullable(object({ playerId: text, kind: text, id: text })) }),
  campaign: object({ runId: text, bossesDefeated: number, highestBossActDefeated: number,
    keys: object({ ruby: v.boolean(), emerald: v.boolean(), sapphire: v.boolean() }), finalized: v.boolean() }),
})
const snapshot = object({
  snapshotSchemaVersion: optional(count),
  code: text, phase: v.picklist(['lobby', 'run']), version: count, epoch: optional(text),
  selectingCampaign: v.boolean(), ascension: number, chooseYourRelic: v.boolean(), lastStand: v.boolean(),
  metaOptions: object({ mode: v.picklist(['standard', 'custom']), modifiers: strings, quickStartAct: number }),
  you: seat, seats: v.array(seat), run: v.nullable(run), campaignProgress,
  campfireDecided: strings, endTurnDecided: strings, endTurnRequired: strings,
  startTurnDecided: optional(strings), startTurnRequired: optional(strings), unavailableEventOptionIds: strings, eventCanSkip: v.boolean(),
  startTurnAbilities: optional(v.array(ability)), endTurnAbilities: optional(v.array(object({ id: text, playerId: text, label: text }))),
  startTurnChoices: optional(v.array(object({ id: text, shivEnemyUids: v.array(v.nullable(text)) }))),
  startTurnScry: optional(reveal), startTurnDiscard: optional(reveal),
  startTurnEnemyTargets: optional(dictionary(text)), discardOrder: optional(strings),
  cardPreview: optional(object({ cardUid: text, kind: text, cards, spendMiracle: v.boolean(), enemyUid: v.nullable(text) })),
  powerPreview: optional(object({ id: number, powerUid: text, kind: v.literal('scry'), cards })),
  pendingRelic: optional(v.nullable(object({ relicId: text }))),
  merchantPledges: optional(dictionary(object({ buyerId: text, payments: dictionary(number) }))),
  merchantReady: optional(strings),
  giveUpVote: optional(object({ runId: text, deadlineAt: number, remainingMs: number,
    eligiblePlayerIds: strings, votes: dictionary(v.boolean()) })),
})

export class InvalidRoomSnapshot extends Error {}

/** Structural presentation validation, not a second implementation of game legality. */
function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  const parsed = v.safeParse(snapshot, value)
  if (!parsed.success) {
    const issue = parsed.issues[0]
    const path = issue.path?.map(entry => String(entry.key)).join('.') ?? 'snapshot'
    throw new InvalidRoomSnapshot(`Invalid room update at ${path}. Refresh or update the client and server.`)
  }
  const data = parsed.output
  if (!data.seats.some(seat => seat.playerId === data.you.playerId) ||
    (data.phase === 'run') !== (data.run !== null)) return false
  const current = data.run
  if (!current) return true
  if (['rng', 'potionDeck', 'relicDeck', 'bossRelicDeck', 'enemyDecks', 'eventDeck'].some(key => key in current)) return false
  if (current.phase === 'combat' && !current.combat || current.phase === 'neow' && !current.neow ||
    current.phase === 'setup' && !current.setup) return false
  for (const players of [current.players, current.combat?.players ?? []]) {
    if (new Set(players.map(player => player.id)).size !== players.length) return false
    for (const player of players) {
      if (player.id !== data.you.playerId &&
        [player.deck, player.draw, player.hand, player.chamber].some(pile => pile !== null)) return false
      if ('cardRewards' in player || 'rareRewards' in player) return false
    }
    if (current.roomState?.kind === 'event' && current.roomState.preparedCombat) {
      const encounter = current.roomState.preparedCombat
      if ('rng' in encounter || encounter.players.some(player => player.id !== data.you.playerId && player.hand !== null)) return false
    }
  }
  return !current.combat || !['rng', 'potionDeck', 'summonSupply'].some(key => key in current.combat!)
}

export function decodeRoomSnapshot(value: unknown): RoomSnapshot {
  const version = v.safeParse(object({ snapshotSchemaVersion: optional(count) }), value)
  if (version.success && (version.output.snapshotSchemaVersion ?? 1) !== ROOM_SNAPSHOT_VERSION)
    throw new InvalidRoomSnapshot('Incompatible room snapshot version. Update the client and server.')
  if (!isRoomSnapshot(value)) throw new InvalidRoomSnapshot('Invalid room state or private-card projection. Refresh the room.')
  return value
}

export function decodeRoomReply(value: unknown): RoomSnapshot {
  const wrapped = v.safeParse(object({ snapshot: record }), value)
  return decodeRoomSnapshot(wrapped.success ? wrapped.output.snapshot : value)
}

export function decodeRoomEntry(value: unknown): { token: string; snapshot: RoomSnapshot } {
  const entry = v.parse(object({ token: text, snapshot: v.unknown() }), value)
  return { token: entry.token, snapshot: decodeRoomSnapshot(entry.snapshot) }
}
