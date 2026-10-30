import { addCard, healingCapFor, nextCardUid, potionLimit } from '../game/acquisition.ts'
import { CARDS, cardDef, registeredCardDefinitions } from '../game/cards.ts'
import { enemyLabel, mandatoryChoicePending } from '../game/combat.ts'
import type { CombatState } from '../game/combat.ts'
import { damageEnemyLogged, damagePlayer, drawInto, settle, triggerEnemyDeath } from '../game/combat/effects.ts'
import { POTIONS, RELICS } from '../game/relics.ts'
import { cardHasGuardianSocket, queueGuardianSocket } from '../game/guardian-gems.ts'
import { acquireRelic, hasPendingRelicAcquisition } from '../game/run.ts'
import type { RunState } from '../game/run.ts'
import { CAPS } from '../game/types.ts'
import type { Enemy, Player } from '../game/types.ts'
import { previousTurnStart } from './console-rewind.ts'
import type { RunLog } from './run-log.ts'

export class ConsoleCommandError extends Error {}

const HELP = {
  help: 'help [command] - Show commands or usage.',
  clear: 'clear - Clear console output.',
  status: 'status - Show your stats and target indices (0 = you, 1+ = enemies).',
  rewind: 'rewind - Restore the start of the previous turn in this fight. Requires recorded turn history.',
  list: 'list cards|relics|potions|powers [filter] - Find board-game IDs.',
  gold: 'gold AMOUNT - Add or remove Gold (not account Coins).',
  heal: 'heal [AMOUNT] - Heal yourself; omit the amount for a full heal.',
  energy: 'energy AMOUNT - Add or remove Energy this turn, within the board-game cap.',
  block: 'block AMOUNT [target] - Add or remove Block; default target is 0.',
  draw: 'draw [AMOUNT] - Draw cards normally, including reshuffles; default 1.',
  card: 'card ID [hand|draw|discard|deck] - Spawn a card; default hand in combat, deck otherwise. Append + to upgrade.',
  remove_card: 'remove_card ID [hand|deck] - Remove one matching card. Permanent removal is between fights only.',
  upgrade: 'upgrade [position] - Upgrade a hand card, or a deck card between fights. Positions start at 0.',
  relic: 'relic ID - Gain a relic with its acquisition effects. Choice-producing relics require being outside combat.',
  potion: 'potion ID - Add a potion to a free belt slot.',
  power: 'power ID AMOUNT [target] - Add/remove Strength, Weak, Vulnerable, or Poison. Default target 0.',
  damage: 'damage AMOUNT [target|all] - Deal damage normally; default all enemies.',
  kill: 'kill [target|all] - Kill an enemy (default 1); all ends the fight.',
  win: 'win - Immediately win this fight, including pending summons.',
  die: 'die - Kill your character in this fight.',
} as const

const POWERS = ['strength', 'weak', 'vulnerable', 'poison'] as const
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const fail = (message: string): never => { throw new ConsoleCommandError(message) }
const integer = (text: string | undefined, fallback?: number): number => {
  if (text === undefined && fallback !== undefined) return fallback
  if (text === undefined || !/^-?\d+$/.test(text)) return fail('Expected a whole number.')
  const value = Number(text)
  if (!Number.isSafeInteger(value) || Math.abs(value) > 9999) return fail('Use a whole number between -9999 and 9999.')
  return value
}
const positive = (text: string | undefined, fallback?: number) => {
  const value = integer(text, fallback)
  return value > 0 ? value : fail('The amount must be positive.')
}

function tokens(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(match => {
    if (match[2]?.includes('"')) return fail('Close quoted names with a double quote.')
    return match[1] ?? match[2]!
  })
}

function catalog(kind: string): Array<{ id: string; name: string }> {
  switch (kind) {
    case 'cards': return Object.values({ ...registeredCardDefinitions(), ...CARDS })
    case 'relics': return Object.values(RELICS)
    case 'potions': return Object.values(POTIONS)
    case 'powers': return POWERS.map(id => ({ id, name: id }))
    default: return fail(HELP.list)
  }
}

function identifier(kind: string, value: string | undefined, player: Player): string {
  if (!value) return fail(`Specify an ID. Use list ${kind} to find one.`)
  const key = normalize(value)
  const entries = catalog(kind)
  const exact = entries.find(entry => entry.id === key)
  if (exact) return exact.id
  const starter = kind === 'cards' && entries.find(entry => entry.id === `${key}_${player.character}`)
  if (starter) return starter.id
  const matches = entries.filter(entry => normalize(entry.name) === key)
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) return fail(`Ambiguous name. Use one of: ${matches.map(entry => entry.id).join(', ')}`)
  return fail(`Unknown ${kind} ID "${value}". Use list ${kind} ${value}.`)
}

export function consoleCompletions(line: string): string[] {
  const parts = line.trimStart().split(/\s+/)
  if (parts.length === 1) return Object.keys(HELP).filter(command => command.startsWith(parts[0]!.toLowerCase()))
  const command = parts[0]!.toLowerCase()
  const kinds: Record<string, string> = { card: 'cards', remove_card: 'cards', relic: 'relics', potion: 'potions', power: 'powers' }
  const prefix = normalize(parts.at(-1)!)
  const options = parts.length === 2
    ? command === 'help' ? Object.keys(HELP)
      : command === 'list' ? ['cards', 'relics', 'potions', 'powers']
        : Object.hasOwn(kinds, command) ? catalog(kinds[command]!).map(entry => entry.id) : []
    : []
  return options.filter(option => option.startsWith(prefix)).sort()
    .map(option => [...parts.slice(0, -1), option].join(' '))
}

/** Console edits are atomic, local-only, and never evaluate arbitrary code. */
export function executeConsoleCommand(run: RunState, playerId: string, line: string, history?: RunLog | null): { run: RunState; output: string } {
  const [rawCommand = '', ...args] = tokens(line.trim())
  const command = rawCommand.toLowerCase()
  if (!Object.hasOwn(HELP, command)) return fail(`Unknown command "${rawCommand}". Type help.`)
  const usage = HELP[command as keyof typeof HELP]
  const arity = (min: number, max = min) => {
    if (args.length < min || args.length > max) fail(usage)
  }
  if (command === 'help') {
    arity(0, 1)
    if (args[0] && !Object.hasOwn(HELP, args[0].toLowerCase())) return fail(`Unknown command "${args[0]}".`)
    return { run, output: args[0] ? HELP[args[0].toLowerCase() as keyof typeof HELP] : Object.values(HELP).join('\n') }
  }
  if (command === 'clear') { arity(0); return { run, output: '' } }
  if (command === 'list') {
    arity(1, 2)
    const filter = normalize(args[1] ?? '')
    const entries = catalog(args[0]!.toLowerCase()).filter(entry =>
      normalize(entry.id).includes(filter) || normalize(entry.name).includes(filter))
    return { run, output: entries.length ? entries.slice(0, 80).map(entry => `${entry.id} - ${entry.name}`).join('\n') +
      (entries.length > 80 ? `\n${entries.length - 80} more; narrow the filter.` : '') : 'No matches.' }
  }
  if (command === 'rewind') {
    arity(0)
    if (run.phase !== 'combat' || !run.combat || run.campaign.finalized) return fail('Rewind requires an active fight.')
    if (run.combat.turn < 2) return fail('There is no previous turn in this fight.')
    const restored = previousTurnStart(run, history)
    if (!restored) return fail('The start of the previous turn is not available in this run\'s recorded history.')
    restored.consoleModified = true
    restored.log.push(`Console: rewound to the start of turn ${restored.combat!.turn}.`)
    return { run: restored, output: `Rewound to the start of turn ${restored.combat!.turn}.` }
  }
  const current = (run.combat?.players ?? run.players).find(player => player.id === playerId)
  if (!current) return fail('No local character is available.')
  if (command === 'status') {
    arity(0)
    return { run, output: `0: ${current.name} | HP ${current.hp}/${current.maxHp} | Gold ${current.gold} | Energy ${current.energy} | Block ${current.block}` +
      (run.combat ? '\n' + run.combat.enemies.map((enemy, index) =>
        `${index + 1}: ${enemyLabel(run.combat!.enemies, enemy)} | HP ${enemy.hp}/${enemy.maxHp} | Block ${enemy.block}${enemy.dead ? ' (dead)' : ''}`).join('\n') : '') }
  }
  if (run.campaign.finalized || run.phase === 'victory' || run.phase === 'defeat') return fail('This run has ended. Start another run to change it.')
  if (current.dead) return fail('Your character is dead.')
  if (['card', 'remove_card', 'upgrade', 'relic'].includes(command) &&
    (run.pendingGuardianSockets.length || hasPendingRelicAcquisition(run))) {
    return fail('Finish the current relic or Gem choice before changing cards or relics.')
  }
  if (run.combat && !['win', 'die', 'kill'].includes(command) &&
    (run.combat.phase !== 'player' || mandatoryChoicePending(run.combat))) {
    return fail('Finish start-of-turn ordering or the current choice, then use commands during your player turn.')
  }
  if (run.combat && ['won', 'lost'].includes(run.combat.phase)) return fail('The fight has already ended.')
  let next = structuredClone(run)
  const combat = next.combat
  const player = (combat?.players ?? next.players).find(candidate => candidate.id === playerId)!
  const requireCombat = (): CombatState => combat ?? fail('This command requires an active fight.')
  const target = (value: string | undefined, fallback = 0): Player | Enemy => {
    const index = integer(value, fallback)
    const result = index === 0 ? player : requireCombat().enemies[index - 1]
    if (index < 0 || !result || result.dead) return fail('Invalid or dead target. Use status to see target indices.')
    return result
  }
  let output: string
  switch (command) {
    case 'gold': {
      arity(1)
      player.gold = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, player.gold + integer(args[0])))
      output = `Gold: ${player.gold}`
      break
    }
    case 'heal': {
      arity(0, 1)
      const cap = healingCapFor(player, next.meta.ruleset)
      player.hp = Math.min(cap, player.hp + positive(args[0], cap))
      output = `HP: ${player.hp}/${player.maxHp}`
      break
    }
    case 'energy': {
      arity(1)
      requireCombat()
      player.energy = Math.max(0, Math.min(CAPS.energy, player.energy + integer(args[0])))
      output = `Energy: ${player.energy} (cap ${CAPS.energy})`
      break
    }
    case 'block': {
      arity(1, 2)
      requireCombat()
      const recipient = target(args[1])
      recipient.block = Math.max(0, Math.min(CAPS.block, recipient.block + integer(args[0])))
      output = `Block: ${recipient.block}`
      break
    }
    case 'draw': {
      arity(0, 1)
      const amount = positive(args[0], 1)
      if (amount > 100) return fail('Draw at most 100 cards at once.')
      const drawn = drawInto(requireCombat(), player, amount)
      if (!drawn.length) return fail('No cards could be drawn (empty piles or drawing is locked).')
      output = `Drew ${drawn.length} card(s).`
      break
    }
    case 'card': {
      arity(1, 2)
      const upgraded = args[0]!.endsWith('+')
      const id = identifier('cards', upgraded ? args[0]!.slice(0, -1) : args[0], player)
      if (upgraded && !cardDef(id).upgrade) return fail('That card cannot be upgraded.')
      const socket = cardHasGuardianSocket(id)
      if (socket && combat) return fail('Add Socket cards between fights so their Gem can be attached.')
      if (socket && !next.guardianGemDeck.length) return fail('No Guardian Gems remain for this Socket card.')
      const pile = args[1]?.toLowerCase() ?? (combat ? 'hand' : 'deck')
      if (!['hand', 'draw', 'discard', 'deck'].includes(pile)) return fail(usage)
      if (pile !== 'deck') requireCombat()
      const allPlayers = [...next.players, ...(combat?.players ?? [])]
      const uid = nextCardUid(allPlayers.map(owner => ({ ...owner,
        deck: [...owner.deck, ...owner.hand, ...owner.draw, ...owner.discard, ...owner.exhaust, ...owner.powers, ...owner.chamber,
          ...owner.slimes.map(slime => slime.card)],
      })))()
      if (pile === 'deck') Object.assign(player, addCard(player, id, uid, upgraded))
      else if (pile === 'hand' || pile === 'draw' || pile === 'discard') {
        player[pile].unshift({ uid, defId: id, upgraded })
      }
      if (socket) next = queueGuardianSocket(next, player.id, uid, 'gain')
      output = `Added ${cardDef(id).name}${upgraded ? '+' : ''} to ${pile}.`
      break
    }
    case 'remove_card': {
      arity(1, 2)
      const id = identifier('cards', args[0], player)
      const pile = args[1]?.toLowerCase() ?? (combat ? 'hand' : 'deck')
      if (pile !== 'hand' && pile !== 'deck') return fail(usage)
      if (pile === 'hand') requireCombat()
      if (pile === 'deck' && combat) return fail('Remove permanent deck cards between fights.')
      const index = player[pile].findIndex(card => card.defId === id)
      if (index < 0) return fail(`No ${cardDef(id).name} in your ${pile}.`)
      player[pile].splice(index, 1)
      output = `Removed ${cardDef(id).name} from ${pile}.`
      break
    }
    case 'upgrade': {
      arity(0, 1)
      const pile = combat ? player.hand : player.deck
      const card = pile[integer(args[0], 0)]
      if (!card || card.upgraded || !cardDef(card.defId).upgrade) return fail('Choose an unupgraded, upgradeable card position (starting at 0).')
      card.upgraded = true
      const permanent = player.deck.find(candidate => candidate.uid === card.uid)
      if (permanent) permanent.upgraded = true
      output = `Upgraded ${cardDef(card.defId).name}.`
      break
    }
    case 'relic': {
      arity(1)
      const id = identifier('relics', args[0], player)
      if (player.relics.some(relic => relic.defId === id)) return fail('You already own that relic.')
      next = acquireRelic({ ...next, players: combat?.players ?? next.players, potionDeck: combat?.potionDeck ?? next.potionDeck }, playerId, id)
      if (combat) {
        if (next.players.some(owner => owner.relics.some(relic => relic.pending))) return fail('This relic needs acquisition choices. Gain it between fights.')
        combat.players = next.players
        combat.potionDeck = next.potionDeck
      }
      output = `Gained ${RELICS[id]!.name}.`
      break
    }
    case 'potion': {
      arity(1)
      const id = identifier('potions', args[0], player)
      if (player.potions.length >= potionLimit(next.ascension, player)) return fail('The potion belt is full.')
      player.potions.push(id)
      output = `Gained ${POTIONS[id]!.name}.`
      break
    }
    case 'power': {
      arity(2, 3)
      requireCombat()
      const id = identifier('powers', args[0], player)
      const recipient = target(args[2])
      const amount = integer(args[1])
      if (id === 'poison') {
        if (!('poison' in recipient)) return fail('Poison can only be applied to an enemy.')
        const available = CAPS.poison - requireCombat().enemies.reduce((sum, enemy) =>
          sum + (enemy === recipient || enemy.dead ? 0 : enemy.poison), 0)
        recipient.poison = Math.max(0, Math.min(available, recipient.poison + amount))
        output = `Poison: ${recipient.poison}`
      } else if (id === 'strength' || id === 'weak' || id === 'vulnerable') {
        recipient[id] = Math.max(0, Math.min(CAPS[id], recipient[id] + amount))
        output = `${id}: ${recipient[id]}`
      } else return fail(usage)
      break
    }
    case 'damage': {
      arity(1, 2)
      const state = requireCombat()
      const amount = positive(args[0])
      const recipients = args[1] === undefined || args[1].toLowerCase() === 'all'
        ? state.enemies.filter(enemy => !enemy.dead) : [target(args[1])]
      for (const recipient of recipients) {
        if ('character' in recipient) damagePlayer(state, recipient, amount)
        else damageEnemyLogged(state, recipient, amount, 'Console', player)
      }
      output = `Applied ${amount} damage to ${recipients.length} target(s), respecting Block and damage rules.`
      break
    }
    case 'kill':
    case 'win': {
      arity(0, command === 'win' ? 0 : 1)
      const state = requireCombat()
      if (command === 'win' || args[0]?.toLowerCase() === 'all') {
        for (const enemy of state.enemies) { enemy.hp = 0; enemy.dead = true }
        state.pendingSummons = []
        output = 'Won the fight.'
      } else {
        const enemy = target(args[0], 1)
        if ('character' in enemy) return fail('Use die to kill your character.')
        enemy.hp = 0
        enemy.dead = true
        triggerEnemyDeath(state, enemy)
        output = 'Killed the enemy.'
      }
      break
    }
    case 'die':
      arity(0)
      requireCombat()
      player.hp = 0
      player.dead = true
      output = 'Your character died.'
      break
    default: return fail(usage)
  }
  if (combat) next.combat = settle(combat)
  next.consoleModified = true
  next.log.push(`Console: ${line.trim()}`)
  return { run: next, output }
}
