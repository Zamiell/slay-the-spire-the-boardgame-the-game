import assert from 'node:assert/strict'
import { consoleCompletions, ConsoleCommandError, executeConsoleCommand } from '../src/ui/developer-commands.ts'
import { enterRoom, finishRun } from '../src/game/run.ts'
import { CAPS } from '../src/game/types.ts'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { check, report, suite } from './lib/harness.mjs'

suite('developer console')
const runFixture = () => postNeowRun(61, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
const fight = () => {
  const run = runFixture()
  const room = run.map.rows[0][0]
  run.map.rooms[room].kind = 'encounter'
  const next = enterRoom(run, room)
  next.combat.phase = 'player'
  next.combat.pendingTriggers = []
  next.combat.startTurnProgress = undefined
  next.combat.players[0].relics = []
  next.combat.enemies = [
    { ...next.combat.enemies[0], defId: 'small_slime', hp: 20, maxHp: 20, block: 2, dead: false, uid: 'e1', poison: 0 },
    { ...next.combat.enemies[0], defId: 'small_slime', hp: 20, maxHp: 20, block: 0, dead: false, uid: 'e2', poison: 0 },
  ]
  return next
}
const command = (run, text) => executeConsoleCommand(run, 'p1', text).run
const player = run => (run.combat?.players ?? run.players)[0]
const rejects = (run, text, pattern) => {
  const before = structuredClone(run)
  assert.throws(() => command(run, text), error => error instanceof ConsoleCommandError && pattern.test(error.message))
  assert.deepEqual(run, before, `failed ${text} must be atomic`)
}
const historyOf = (...states) => ({
  version: 2, runId: states[0].campaign.runId, initial: structuredClone(states[0]),
  events: states.slice(1).map(state => ({ patch: [{ path: [], value: structuredClone(state) }] })),
})

check('help, catalogs, status and completion are read-only and use real board-game IDs', () => {
  const run = fight()
  for (const text of ['help', 'help card', 'list cards bash', 'status', 'clear']) {
    assert.equal(command(run, text), run)
  }
  assert.match(executeConsoleCommand(run, 'p1', 'status').output, /0: Ironclad.*\n1:/)
  assert.deepEqual(consoleCompletions('ca'), ['card'])
  assert(consoleCompletions('relic VAJ').includes('relic vajra'))
  assert(consoleCompletions('potion energy_').includes('potion energy_potion'))
  assert.deepEqual(consoleCompletions('__proto__ '), [])
  assert.match(executeConsoleCommand(run, 'p1', 'list cards bash').output, /bash - Bash/)
  for (const invalid of ['gold NaN', 'energy 1.5', 'gold 10000', 'win now', '__proto__', 'card "Bash', 'draw -1']) {
    rejects(run, invalid, /./)
  }
})

check('stat edits are immutable, capped, and permanently unranked', () => {
  const original = fight()
  const before = structuredClone(original)
  let run = command(original, 'GOLD 20')
  assert.equal(player(run).gold, player(original).gold + 20)
  run = command(run, 'energy 999')
  assert.equal(player(run).energy, CAPS.energy)
  run = command(run, 'block 999')
  assert.equal(player(run).block, CAPS.block)
  run = command(run, 'power STRENGTH 99')
  assert.equal(player(run).strength, CAPS.strength)
  run = command(run, 'power POISON 20 1')
  run = command(run, 'power POISON 20 2')
  assert.equal(run.combat.enemies[1].poison, 10)
  run = command(run, 'energy -999')
  run = command(run, 'gold -999')
  assert.equal(player(run).energy, 0)
  assert.equal(player(run).gold, 0)
  player(run).hp = 1
  run = command(run, 'heal')
  assert.equal(player(run).hp, player(run).maxHp)
  assert.equal(run.consoleModified, true)
  assert.deepEqual(original, before)
  rejects(run, 'power poison 2', /only.*enemy/)
})

check('cards have unique identities, correct destinations and synchronized upgrades', () => {
  let run = fight()
  const deckSize = player(run).deck.length
  run = command(run, 'card "Bash"')
  run = command(run, 'card STRIKE+ draw')
  run = command(run, 'card BASH discard')
  run = command(run, 'card BASH deck')
  assert.equal(player(run).hand[0].defId, 'bash')
  assert.equal(player(run).draw[0].upgraded, true)
  assert.equal(player(run).discard[0].defId, 'bash')
  assert.equal(player(run).deck.length, deckSize + 1)
  const created = [player(run).hand[0], player(run).draw[0], player(run).discard[0], player(run).deck.at(-1)]
  assert.equal(new Set(created.map(card => card.uid)).size, 4)
  const permanent = player(run).deck[0]
  player(run).hand = [{ ...permanent }]
  run = command(run, 'upgrade 0')
  assert(player(run).hand[0].upgraded)
  assert(player(run).deck[0].upgraded)
  rejects(run, 'upgrade 0', /unupgraded/)
  rejects(run, 'remove_card BASH deck', /between fights/)
  const outside = command(runFixture(), 'card BASH')
  assert.equal(player(command(outside, 'remove_card BASH')).deck.length, player(outside).deck.length - 1)
})

check('draws reshuffle normally and refuse locked draws without partial mutation', () => {
  let run = fight()
  const owner = player(run)
  owner.draw = []
  owner.hand = []
  owner.discard = owner.deck.slice(0, 3).map(card => ({ ...card }))
  run = command(run, 'draw 2')
  assert.equal(player(run).hand.length, 2)
  assert.equal(player(run).draw.length, 1)
  player(run).drawLocked = true
  rejects(run, 'draw', /locked/)
})

check('Socket gains use the normal Gem choice instead of leaving incomplete cards', () => {
  const run = runFixture()
  run.guardianGemDeck = ['guardian_ruby', 'guardian_onyx']
  const next = command(run, 'card GUARDIAN_CRYSTAL_EDGE')
  assert.equal(next.pendingGuardianSockets.length, 1)
  assert.deepEqual(next.pendingGuardianSockets[0].gemIds, ['guardian_ruby'])
  rejects(next, 'remove_card GUARDIAN_CRYSTAL_EDGE', /Gem choice/)
  rejects(fight(), 'card GUARDIAN_CRYSTAL_EDGE', /between fights/)
})

check('relic acquisition effects and potion capacity remain coherent', () => {
  let run = command(fight(), 'relic OLD_COIN')
  assert.equal(player(run).gold, player(fight()).gold + 10)
  run = command(run, 'relic VAJRA')
  assert(player(run).relics.some(relic => relic.defId === 'vajra'))
  rejects(run, 'relic VAJRA', /already own/)
  rejects(run, 'relic ORRERY', /between fights/)
  assert(player(command(runFixture(), 'relic ORRERY')).relics.some(relic => relic.defId === 'orrery' && relic.pending))
  player(run).potions = []
  run = command(run, 'potion ENERGY_POTION')
  assert.deepEqual(player(run).potions, ['energy_potion'])
  player(run).potions = ['energy_potion', 'energy_potion', 'energy_potion']
  rejects(run, 'potion ENERGY_POTION', /full/)
})

check('damage, kill, win and die settle fights without stranded summons', () => {
  let run = command(fight(), 'damage 3 1')
  assert.equal(run.combat.enemies[0].hp, 19)
  assert.equal(run.combat.enemies[0].block, 0)
  rejects(run, 'damage 1 99', /Invalid/)
  run = command(run, 'kill 1')
  assert(run.combat.enemies[0].dead)
  assert.equal(run.combat.phase, 'player')
  run = command(run, 'kill all')
  assert.equal(run.combat.phase, 'won')
  assert.deepEqual(run.combat.pendingSummons, [])
  assert.equal(command(fight(), 'die').combat.phase, 'lost')
  rejects(runFixture(), 'win', /active fight/)
  const start = fight()
  start.combat.phase = 'start'
  rejects(start, 'draw', /start-of-turn/)
  assert.equal(command(start, 'win').combat.phase, 'won')
})

check('console runs cannot earn campaign marks or Ascension unlocks', () => {
  const run = runFixture()
  run.phase = 'victory'
  run.act = 3
  run.campaign.bossesDefeated = 3
  run.campaign.highestBossActDefeated = 3
  const modified = finishRun({ ...run, consoleModified: true })
  assert(modified.campaign.finalized)
  assert.deepEqual(modified.campaignProgress, run.campaignProgress)
  assert.notDeepEqual(finishRun(run).campaignProgress, run.campaignProgress)
})

check('rewind restores the entire previous opening, including choices, RNG and supplies', () => {
  const first = fight()
  const second = structuredClone(first)
  second.combat.turn = 2
  second.combat.phase = 'start'
  second.combat.startTurnProgress = { choices: [] }
  const changedSecond = command({ ...structuredClone(second), combat: { ...structuredClone(second.combat), phase: 'player' } }, 'gold 10')
  const third = command(changedSecond, 'damage 5 1')
  third.combat.turn = 3
  third.combat.players[0].hp = 0
  third.combat.players[0].dead = true
  third.combat.phase = 'lost'
  third.combat.rng = { state: 999 }
  third.potionDeck.reverse()
  const history = historyOf(first, second, changedSecond, third)
  const before = structuredClone({ third, history })
  const result = executeConsoleCommand(third, 'p1', 'REWIND', history)
  assert.equal(result.output, 'Rewound to the start of turn 2.')
  const expected = structuredClone(second)
  expected.consoleModified = true
  expected.log.push('Console: rewound to the start of turn 2.')
  assert.deepEqual(result.run, expected)
  assert.deepEqual({ third, history }, before)
  assert.notEqual(result.run.combat, history.events[0].patch[0].value.combat)
  const again = executeConsoleCommand(result.run, 'p1', 'rewind', historyOf(first, second, third, result.run))
  assert.equal(again.run.combat.turn, 1)
  assert.deepEqual(again.run.combat, first.combat)
  assert(again.run.consoleModified)
})

check('rewind follows replayed turns rather than discarded future branches', () => {
  const first = fight()
  const oldSecond = structuredClone(first)
  oldSecond.combat.turn = 2
  const third = structuredClone(oldSecond)
  third.combat.turn = 3
  const newFirst = command(first, 'gold 30')
  const newSecond = structuredClone(newFirst)
  newSecond.combat.turn = 2
  const current = command(newSecond, 'card BASH')
  current.combat.turn = 3
  const result = executeConsoleCommand(current, 'p1', 'rewind',
    historyOf(first, oldSecond, third, newFirst, newSecond, current))
  assert.deepEqual(result.run.combat, newSecond.combat)
  // Reloading a checkpoint in the middle of turn 2 does not redefine its opening.
  const midway = command(newSecond, 'gold 1')
  const restored = executeConsoleCommand(current, 'p1', 'rewind',
    historyOf(first, newSecond, current, midway, current))
  assert.deepEqual(restored.run.combat, newSecond.combat)
})

check('rewind refuses unavailable history, turn 1 and other fights without changing the run', () => {
  const first = fight()
  rejects(first, 'rewind', /no previous turn/)
  rejects(first, 'rewind 2', /rewind -/)
  rejects(runFixture(), 'rewind', /active fight/)
  const second = structuredClone(first)
  second.combat.turn = 2
  rejects(second, 'rewind', /not available/)
  const other = structuredClone(first)
  other.combat.combatId = 'other-fight'
  for (const history of [historyOf(other, second), { ...historyOf(first, second), runId: 'other-run' }]) {
    assert.throws(() => executeConsoleCommand(second, 'p1', 'rewind', history), /not available/)
  }
  const foreign = structuredClone(first)
  foreign.campaign.runId = 'other-run'
  assert.throws(() => executeConsoleCommand(second, 'p1', 'rewind',
    { ...historyOf(foreign, second), runId: second.campaign.runId }), /not available/)
  assert.deepEqual(consoleCompletions('rew'), ['rewind'])
})

report()
