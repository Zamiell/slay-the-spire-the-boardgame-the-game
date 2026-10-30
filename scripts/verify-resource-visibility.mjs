import assert from 'node:assert/strict'
import { trackCombatResources } from '../src/ui/combat-screen/resource-visibility.ts'

const emptyPlayer = id => ({ id, shivs: 0, miracles: 0, vigor: 0, soulburn: 0 })
let state = { combatId: 'first', players: [emptyPlayer('p1'), emptyPlayer('p2')] }
let history = trackCombatResources(undefined, state)
assert.equal(history.byPlayer.size, 0, 'unacquired resources must not create visible counters')
for (const resource of ['shivs', 'miracles', 'vigor', 'soulburn', 'clawCubesGainedThisCombat']) {
  state = { ...state, players: [{ ...state.players[0], [resource]: 1 }, state.players[1]] }
  const before = history
  history = trackCombatResources(history, state)
  assert(history.byPlayer.get('p1').has(resource))
  assert(!before.byPlayer.get('p1')?.has(resource), 'tracking must not mutate previous visibility')
  state = { ...state, players: [{ ...state.players[0], [resource]: 0 }, state.players[1]] }
  assert.equal(trackCombatResources(history, state), history, 'spending the balance must preserve visibility')
}
assert.equal(history.byPlayer.get('p2'), undefined, "one player must not reveal another player's counters")
const nextFight = trackCombatResources(history, { ...state, combatId: 'second' })
assert.equal(nextFight.byPlayer.size, 0, 'a new fight must forget prior resource acquisition')
const joined = trackCombatResources(nextFight, { ...state, combatId: 'second',
  players: [state.players[0], { ...state.players[1], miracles: 2 }] })
assert(joined.byPlayer.get('p2').has('miracles'), 'joining a fight with resources must reveal them immediately')
assert.equal(joined.byPlayer.get('p1'), undefined)
console.log('PASS per-fight, per-player resource visibility and zero-balance persistence')
