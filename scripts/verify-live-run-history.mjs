import assert from 'node:assert/strict'
import { enterRoom } from '../src/game/run.ts'
import { playCard } from '../src/game/combat.ts'
import { postNeowRun } from './lib/post-neow-run.mjs'
import { reduceRunHistory } from '../src/ui/live-run-history.ts'

const run = postNeowRun(47, [{ id: 'p1', name: 'Watcher', character: 'watcher' }])
const room = run.map.rows[0][0]
run.map.rooms[room].kind = 'encounter'
const before = enterRoom(run, room)
before.combat.phase = 'player'
const player = before.combat.players[0]
player.energy = 3
player.enemyNextCardCost = 2
player.hand = [{ uid: 'zero', defId: 'crescendo', upgraded: false }]
player.draw[0].uid = 'private-draw-order-sentinel'
const after = { ...before, combat: playCard(before.combat, 'p1', 'zero') }
assert.notEqual(after.combat, before.combat, 'the fixture must execute a real card')
assert.equal(after.combat.players[0].energy, 1)

const idle = { status: 'idle', reason: 'No run' }
const loading = reduceRunHistory(idle, { type: 'load', runId: run.campaign.runId })
assert.throws(() => reduceRunHistory(loading, { type: 'commit', index: 1, before, after }), /must be ready/)
const ready = reduceRunHistory(loading, { type: 'loaded' })
const original = JSON.stringify({ before, after, ready })
let history = reduceRunHistory(ready, { type: 'commit', index: 1, before, after })
assert.equal(JSON.stringify({ before, after, ready }), original, 'the reducer must not mutate gameplay or its previous state')
const played = history.transitions[0]
assert.equal(played.cards[0].cardId, 'crescendo')
assert.equal(played.cards[0].printedCost, 0)
assert.equal(played.cards[0].effectEnergy, 2)
assert.deepEqual(played.cardEnergySpent, [{ playerId: 'p1', amount: 2 }])
assert.equal(played.before.players[0].energy, 3)
assert.equal(played.after.players[0].energy, 1)
assert(!JSON.stringify(history).includes('private-draw-order-sentinel'))
assert(!JSON.stringify(history).includes('"rng"'))
assert(!JSON.stringify(history).includes('"hand"'))
assert(!JSON.stringify(history).includes('"seed"'))

const copied = structuredClone(after)
const resolution = copied.combat.presentationEvents.at(-1)
copied.combat.presentationEvents.push({ ...resolution, seq: resolution.seq + 1, copied: true })
history = reduceRunHistory(history, { type: 'commit', index: 2, before: after, after: copied })
assert.equal(history.transitions.at(-1).cards[0].effectEnergy, 2)
assert.deepEqual(history.transitions.at(-1).cardEnergySpent, [{ playerId: 'p1', amount: 0 }],
  'copy resolution Energy must not be reported as a second payment')
assert.equal(history.transitions.at(-1).before.players[0].energy, history.transitions.at(-1).after.players[0].energy)

history = reduceRunHistory(history, { type: 'commit', index: 3, before: copied, after: before })
assert.equal(history.transitions.at(-1).timelineReset, true)
assert.deepEqual(history.transitions.at(-1).cards, [], 'a rewind must not invent another card play')
assert.throws(() => reduceRunHistory(history, { type: 'commit', index: 5, before, after }), /consecutive/)
const otherRun = structuredClone(after)
otherRun.seed = 'another-run'
assert.throws(() => reduceRunHistory(history, { type: 'commit', index: 4, before, after: otherRun }), /same run/)

const overflow = structuredClone(after)
overflow.combat.presentationEvents = [{ ...resolution, seq: 100 }]
history = reduceRunHistory(history, { type: 'commit', index: 4, before, after: overflow })
assert.equal(history.transitions.at(-1).cardEventsTruncated, true, 'missing bounded presentation events must be explicit')
let current = overflow
for (let index = 5; index <= 45; index++) {
  const next = structuredClone(current)
  next.combat.players[0].energy = index % 2
  history = reduceRunHistory(history, { type: 'commit', index, before: current, after: next })
  current = next
}
assert.equal(history.truncated, true)
assert.equal(history.transitions.at(-1).index, 45)
assert(history.transitions.length < history.processedTransitions)
const failed = reduceRunHistory(history, { type: 'fail', message: 'Recording unavailable' })
assert.equal(failed.status, 'error')
assert.equal(failed.transitions, undefined, 'an error cannot masquerade as current history')
const cleared = reduceRunHistory(history, { type: 'clear', reason: 'Left the local run' })
assert.equal(cleared.status, 'idle')
assert.equal(cleared.transitions, undefined, 'leaving the run cannot expose another timeline')
console.log('Public run-history reducer: real zero-cost override, copies, rewinds, gaps, boundaries, and privacy passed.')
