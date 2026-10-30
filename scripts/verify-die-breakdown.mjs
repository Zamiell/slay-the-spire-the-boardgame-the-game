import assert from 'node:assert/strict'
import { CARDS } from '../src/game/cards.ts'
import { createCombat, canActivateRelic } from '../src/game/combat.ts'
import { createPlayer } from '../src/game/run.ts'
import { createRng } from '../src/game/rng.ts'
import { createRelicInstance, manualDieRelicFaces } from '../src/game/relics.ts'
import { combatDieBreakdown, effectsForDie } from '../src/ui/combat-die-breakdown.ts'

const rng = createRng(47)
const player = createPlayer(rng, 'p1', 'Watcher', 'watcher', 0)
player.relics = ['snecko_eye', 'duality', 'tungsten_rod', 'loaded_die', 'dollys_mirror',
  'nilrys_codex', 'charons_ashes', 'fuel_canister'].map(createRelicInstance)
player.hand = [
  { uid: 'lucky', defId: 'just_lucky', upgraded: false },
  { uid: 'lucky-copy', defId: 'just_lucky', upgraded: false },
]
CARDS.fixture_die_power = {
  id: 'fixture_die_power', name: 'Die Power', owner: 'watcher', rarity: 'rare', type: 'power', cost: 0,
  trigger: { kind: 'dieRelic', faces: [3] }, effects: [{ kind: 'gainEnergy', amount: 1 }],
}
player.powers = [{ uid: 'power', defId: 'fixture_die_power', upgraded: false }]
const state = createCombat(rng, [player], [{
  uid: 'snecko', defId: 'snecko', row: 0, hp: 23, maxHp: 23, block: 0, strength: 0,
  weak: 0, vulnerable: 0, poison: 0, actionIndex: 0, abilityUsed: false, dead: false,
}])
const before = structuredClone(state)
const faces = combatDieBreakdown(state, 'p1')
assert.deepEqual(faces.map(row => row.face), [1, 2, 3, 4, 5, 6])
const relic = (face, id) => faces[face - 1].entries.filter(entry => entry.relicId === id)
for (const face of [1, 2]) assert.deepEqual(relic(face, 'snecko_eye')[0].effects, [{ kind: 'draw', amount: 2 }])
for (const face of [3, 4]) assert.deepEqual(relic(face, 'snecko_eye')[0].effects, [{ kind: 'gainEnergy', amount: 1 }])
assert.deepEqual(relic(5, 'snecko_eye')[0].effects, [{ kind: 'setNextCardCost', amount: 2 }])
assert.deepEqual(relic(6, 'snecko_eye')[0].effects, [{ kind: 'setNextCardCost', amount: 0 }])
assert.deepEqual(relic(2, 'duality')[0].effects, [{ kind: 'block', amount: 2 }])
assert.deepEqual(relic(4, 'duality')[0].effects, [{ kind: 'damage', amount: 2 }])
assert.equal(relic(1, 'duality').length, 0)
assert.equal(relic(5, 'tungsten_rod')[0].effects[0].amount, 3)
assert.equal(relic(6, 'loaded_die').length, 1, 'Loaded Die alternatives must not look like two simultaneous effects')
assert.match(relic(6, 'loaded_die')[0].alternative, /instead/)
assert.equal(relic(1, 'dollys_mirror')[0].optional, true)
assert.equal(relic(4, 'nilrys_codex')[0].optional, true)
assert.equal(relic(2, 'nilrys_codex')[0].optional, undefined)
assert.equal(relic(1, 'charons_ashes')[0].optional, true)
assert.equal(relic(2, 'fuel_canister')[0].optional, true)
assert.equal(faces[2].entries.filter(entry => entry.kind === 'power').length, 1)
for (const face of faces) {
  const cards = face.entries.filter(entry => entry.kind === 'card')
  assert.equal(cards.length, 1, 'duplicate hand cards should not repeat the same rule')
  assert.equal(cards[0].effects[1].kind, face.face <= 3 ? 'scry' : 'block')
  const enemy = face.entries.find(entry => entry.id === 'enemy:snecko')
  assert.equal(enemy.actions[0].amount, face.face <= 2 ? 3 : face.face <= 4 ? 5 : 2)
  assert.match(face.entries.find(entry => entry.id === 'confusion:snecko').text, /next card costs/)
}
assert.deepEqual(state, before, 'the reference must not mutate combat, RNG or relic uses')

const party = structuredClone(state)
const ally = createPlayer(createRng(48), 'p2', 'Ally', 'ironclad', 0)
ally.relics = [createRelicInstance('downfall_nilrys_codex')]
ally.hand = [{ uid: 'private', defId: 'flex', upgraded: false }]
party.players.push(ally)
party.players[0].relics.find(held => held.defId === 'dollys_mirror').spent = true
const partyFaces = combatDieBreakdown(party, 'p1')
assert.equal(partyFaces[4].entries.find(entry => entry.relicId === 'tungsten_rod').effects[0].amount, 1)
assert.equal(partyFaces[0].entries.find(entry => entry.relicId === 'dollys_mirror').used, true)
assert.equal(partyFaces[1].entries.find(entry => entry.relicId === 'downfall_nilrys_codex').optional, true)
assert.match(partyFaces[1].entries.find(entry => entry.relicId === 'downfall_nilrys_codex').text, /die-2 ability/)
assert(!partyFaces.some(row => row.entries.some(entry => entry.id === 'card:private')), 'only the viewer hand is inspected')
party.players[1].dead = true
assert(!combatDieBreakdown(party, 'p1').some(row => row.entries.some(entry => entry.owner === 'Ally')))

for (const id of ['dollys_mirror', 'nilrys_codex', 'downfall_nilrys_codex', 'loaded_die', 'charons_ashes', 'fuel_canister']) {
  const probe = structuredClone(state)
  probe.phase = 'start'
  probe.startTurnProgress = undefined
  probe.players[0].relics = [createRelicInstance(id), createRelicInstance('snecko_eye')]
  for (const face of [1, 2, 3, 4, 5, 6]) {
    probe.die = face
    assert.equal(canActivateRelic(probe, probe.players[0], 0), manualDieRelicFaces(id).includes(face), `${id}/${face}`)
  }
}
assert.deepEqual(effectsForDie([{ kind: 'channelDieOrb' }], 6), [{ kind: 'channel', orb: 'dark', amount: 1, when: undefined }])
assert.deepEqual(effectsForDie([{ kind: 'roulette', byRoll: { 2: [{ kind: 'block', amount: 3 }] } }], 2),
  [{ kind: 'block', amount: 3 }])
console.log('PASS six-face rules, alternatives, ownership, conditional cards, enemy actions and read-only state')
