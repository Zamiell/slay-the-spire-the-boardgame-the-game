// A long four-player Gremlin Leader fight must not block every room while
// deriving start-turn targets. Synthetic state only; no player saves/tokens.
import assert from 'node:assert/strict'
import { apply, createRoom, createStore, joinRoom, snapshotFor, startRun } from './lib/rooms.mjs'
import { createCombat } from '../src/game/combat/create.ts'

const room = createRoom(createStore(), { code: 'LATENC' })
for (const character of ['defect', 'watcher', 'silent', 'ironclad']) {
  joinRoom(room, { name: `Latency ${character}`, character })
}
startRun(room, room.seats[0].token, { seed: 42 })
const card = (uid, defId, upgraded = false) => ({ uid, defId, upgraded })
const enemies = Array.from({ length: 9 }, (_, index) => ({
  uid: `latency-enemy-${index}`, defId: index === 8 ? 'gremlin_leader' : 'gremlin_wizard',
  row: index === 8 ? 0 : Math.floor(index / 2), isBoss: false,
  hp: index === 8 ? 47 : 4, maxHp: index === 8 ? 47 : 4,
  block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0,
  actionIndex: 0, abilityUsed: true, dead: false,
}))
room.run.phase = 'combat'
room.run.neow = null
room.run.combat = createCombat(room.run.rng, room.run.players, enemies, 'latency-combat')
const combat = room.run.combat
Object.assign(combat, {
  phase: 'start', turn: 7, die: 4, startTurnStage: 'effects', pendingTriggers: [],
  log: Array.from({ length: 442 }, (_, index) => `Turn history ${index}: attack, Block and card draw.`),
})
for (const player of combat.players) Object.assign(player, { powers: [], relics: [], potions: [] })
const [defect, , silent] = combat.players
defect.relics = [{ defId: 'fusion_hammer', spent: false }, { defId: 'duality', spent: false }]
defect.orbs = ['frost', 'frost', 'frost']
silent.powers = [card('latency-blades', 'infinite_blades', true), card('latency-fumes', 'noxious_fumes', true)]
silent.relics = [{ defId: 'stone_calendar', spent: false }]
silent.shivs = 5
Object.assign(room, {
  startTurnPostRollLock: { combatId: combat.combatId, turn: combat.turn },
  startTurnRequired: [silent.id, defect.id], startTurnReady: { [silent.id]: false, [defect.id]: true },
})

function broadcast(sample, shared = {}) {
  return sample.seats.map((seat) => snapshotFor(sample, seat.token, shared))
}
function cpuMilliseconds(callback) {
  const before = process.cpuUsage()
  callback()
  const used = process.cpuUsage(before)
  return (used.user + used.system) / 1_000
}
// Warm the engine, then measure fresh rooms and repeated independent seat
// reads. CPU time avoids failures caused solely by another task using the host.
broadcast(structuredClone(room))
const cold = [], repeated = []
for (let index = 0; index < 5; index++) {
  const sample = structuredClone(room)
  cold.push(cpuMilliseconds(() => broadcast(sample)))
  repeated.push(cpuMilliseconds(() => {
    for (const seat of sample.seats) snapshotFor(sample, seat.token)
  }))
}
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
assert(median(cold) < 500, `four-seat planning consumed ${median(cold).toFixed(1)} ms CPU (budget 500)`)
assert(median(repeated) < 100, `unchanged seat reads consumed ${median(repeated).toFixed(1)} ms CPU (budget 100)`)

const views = broadcast(room)
const fumes = views[2].startTurnAbilities.find((ability) => ability.id.endsWith('latency-fumes'))
assert.deepEqual(fumes.targets.map((target) => target.uid), [0, 2, 4, 6].map((index) => enemies[index].uid))
assert.equal(views[2].startTurnAbilities.find((ability) => ability.id.endsWith('latency-blades')).overflowShivs, 2)

// In-place combat changes and committed plans must invalidate cached targets,
// even when the room version has not changed.
combat.enemies[0].dead = true
combat.enemies[0].hp = 0
const changed = snapshotFor(room, room.seats[2].token)
assert.deepEqual(changed.startTurnAbilities.find((ability) => ability.id === fumes.id).targets
  .map((target) => target.uid), [1, 2, 4, 6].map((index) => enemies[index].uid))
room.startTurnCombatId = combat.combatId
room.startTurnOrder = changed.startTurnAbilities.map((ability) => ability.id).reverse()
assert.deepEqual(snapshotFor(room, room.seats[0].token).startTurnAbilities
  .map((ability) => ability.id), room.startTurnOrder)

// The cached plan can contain private Exhaust candidates; each seat still
// receives its own redacted view, including after another seat reads first.
silent.powers = [card('latency-sacrifice', 'worthy_sacrifice')]
silent.hand = [card('latency-private-a', 'strike_silent'), card('latency-private-b', 'defend_silent')]
room.startTurnOrder = undefined
room.startTurnChoices = undefined
const observer = snapshotFor(room, room.seats[0].token)
const owner = snapshotFor(room, room.seats[2].token)
const sacrifice = owner.startTurnAbilities.find((ability) => ability.id.endsWith('latency-sacrifice'))
assert.deepEqual(sacrifice.exhaustCards.map((entry) => entry.uid), silent.hand.map((entry) => entry.uid))
for (const entry of silent.hand) assert(!JSON.stringify(observer).includes(entry.uid), 'a cached plan leaked a private card')
assert.deepEqual(snapshotFor(room, room.seats[0].token).startTurnAbilities
  .find((ability) => ability.id === sacrifice.id).exhaustCards, undefined)

// Hello World + Storm+, Fumes+ and Pen Nib used to exhaust the exact ordering
// replay budget both after changing the die and after staging the Orb picks.
const orbRoom = createRoom(createStore(), { code: 'ORBCPU' })
for (const character of ['defect', 'silent', 'watcher']) joinRoom(orbRoom, { name: character, character })
startRun(orbRoom, orbRoom.seats[0].token, { seed: 7 })
orbRoom.run.phase = 'combat'
orbRoom.run.neow = null
orbRoom.run.combat = createCombat(orbRoom.run.rng, orbRoom.run.players,
  [0, 1, 2, 1, 0].map((row, index) => ({ ...enemies[0], uid: `orb-e${index}`, row,
    defId: index === 4 ? 'slime_boss' : 'cultist', isBoss: index === 4, hp: 50, maxHp: 50 })), 'orb-cpu')
Object.assign(orbRoom.run.combat, { phase: 'start', turn: 2, die: 4, startTurnStage: 'effects' })
const [orbDefect, orbSilent, orbWatcher] = orbRoom.run.combat.players
Object.assign(orbDefect, { orbs: ['lightning', 'frost', 'dark'], relics: [], potions: [],
  powers: [card('cpu-hello', 'slayer_hello_world'), card('cpu-storm', 'storm', true)] })
Object.assign(orbSilent, { powers: [card('cpu-fumes', 'noxious_fumes', true)], potions: [],
  relics: [{ defId: 'pen_nib', spent: false }] })
Object.assign(orbWatcher, { powers: [], relics: [], potions: ['gamblers_brew'] })
function orbChoices(sample, picks = {}) {
  const view = snapshotFor(sample, sample.seats[1].token)
  const stored = new Map((view.startTurnChoices ?? []).map((choice) => [choice.id, choice]))
  return view.startTurnAbilities.map((ability) => ({
    id: ability.id, shivEnemyUids: [], evokeSlots: [], evokeEnemyUids: [],
    ...stored.get(ability.id),
    enemyUid: view.startTurnEnemyTargets?.[ability.id] ?? stored.get(ability.id)?.enemyUid,
    ...picks[ability.id],
  }))
}
const orbCpu = []
for (let index = 0; index < 5; index++) {
  const sample = structuredClone(orbRoom)
  const decisions = [
    [2, () => ({ kind: 'usePotion', potionId: 'gamblers_brew', die: 5 })],
    [0, () => ({ kind: 'resolveStartTurn', choices: orbChoices(sample, {
      'p1/power:cpu-hello': { evokeSlots: [1], evokeEnemyUids: [null] },
      'p1/power:cpu-storm': { evokeSlots: [1, 1], evokeEnemyUids: ['orb-e1', 'orb-e1'] },
    }) })],
    [1, () => ({ kind: 'resolveStartTurn', choices: orbChoices(sample) })],
    [1, () => ({ kind: 'resolveStartTurn', choices: orbChoices(sample, {
      'p2/power:cpu-fumes': { enemyUid: 'orb-e1' },
    }) })],
    [1, () => ({ kind: 'resolveStartTurn', choices: orbChoices(sample, {
      'p2/relic:0:0': { enemyUid: 'orb-e1' },
    }) })],
  ]
  for (const [seat, decision] of decisions) {
    const action = decision()
    let result
    const used = cpuMilliseconds(() => { result = apply(sample, sample.seats[seat].token, action) })
    assert(result.changed, 'the performance sample skipped an action')
    assert(used < 2_000, `Orb party ${action.kind} consumed ${used.toFixed(1)} ms CPU (budget 2000)`)
    orbCpu.push(used)
  }
  assert.equal(sample.run.combat.phase, 'player', 'the performance sample did not finish the turn')
  assert.equal(sample.run.combat.die, 5)
  const target = sample.run.combat.enemies[1]
  assert.deepEqual([target.hp, target.poison, target.vulnerable], [43, 1, 1])
}

console.log(`✓ four-player room planning: cold ${median(cold).toFixed(1)} ms CPU, repeated ${median(repeated).toFixed(1)} ms CPU; targets, invalidation and private cards verified`)
console.log(`✓ Orb party transactions: max ${Math.max(...orbCpu).toFixed(1)} ms CPU; five start-of-turn sequences and their target effects verified`)
