import assert from 'node:assert/strict'
import fc from 'fast-check'
import { transitionAction } from '../src/ui/combat-screen/action-lifecycle.ts'
import { transitionPotionSelection } from '../src/ui/combat-screen/potion-selection.ts'

const event = fc.record({
  type: fc.constantFrom('start', 'reply', 'failed', 'observe', 'reset'),
  mode: fc.constantFrom('local', 'online'),
  status: fc.constantFrom('accepted', 'refused', 'reconciled', 'unknown'),
  id: fc.nat(30),
  refresh: fc.option(fc.nat(20), { nil: undefined }),
  committed: fc.boolean(),
  board: fc.nat(3),
})

fc.assert(fc.property(fc.array(event, { minLength: 1, maxLength: 100 }), events => {
  const boards = [0, 1, 2, 3].map(revision => ({ revision }))
  let state = { kind: 'idle' }
  let sequence = 0
  for (const input of events) {
    const before = state
    const id = input.type === 'start' ? ++sequence : input.id % (sequence + 2)
    const command = input.type === 'start'
      ? { type: 'start', id, mode: input.mode, board: boards[input.board], payload: { id } }
      : input.type === 'reply'
        ? { type: 'reply', id, outcome: { status: input.status, refreshAttempt: input.refresh }, latestRefresh: input.refresh }
        : { type: input.type, id, latestRefresh: input.refresh, committed: input.committed, board: boards[input.board] }
    const result = transitionAction(state, command)
    state = result.state
    if (before.kind !== 'idle' && input.type === 'start') assert.equal(state, before, 'a second submission replaced a live lock')
    if ((input.type === 'reply' || input.type === 'failed') && before.kind !== 'idle' && id !== before.id)
      assert.equal(state, before, 'a stale callback changed a newer action')
    if (before.kind === 'idle' && input.type !== 'start') assert.equal(state.kind, 'idle', 'an unsolicited event created work')
    if (before.kind === 'unknown' && input.type === 'observe' && !input.committed &&
      !(before.refreshAttempt !== undefined && input.refresh !== undefined && input.refresh > before.refreshAttempt))
      assert.equal(state, before, 'unknown delivery unlocked without causal evidence')
    if (result.resolution) {
      assert.equal(state.kind, 'idle')
      assert.equal(result.resolution.payload.id, before.payload.id, 'a result was delivered to the wrong submission')
      const late = transitionAction(state, { type: 'reply', id, outcome: { status: 'accepted' } })
      assert.equal(late.resolution, undefined, 'a settled action resolved twice')
    }
  }
}), { seed: 20261101, numRuns: 200 })

fc.assert(fc.property(fc.array(fc.string({ maxLength: 8 }), { maxLength: 80 }), ids => {
  let state = transitionPotionSelection({ kind: 'idle' }, { type: 'stage', potionId: 'purity_potion', overflow: 0 })
  for (const uid of ids) {
    state = transitionPotionSelection(state, { type: 'toggleCard', uid })
    assert.equal(state.kind, 'cards')
    assert(state.picked.length <= 3)
    assert.equal(new Set(state.picked).size, state.picked.length)
  }
  const alive = new Set(ids.filter((_, index) => index % 2 === 0))
  state = transitionPotionSelection(state, { type: 'refresh', usable: true, overflow: 0, alive: new Set(), cards: alive })
  assert(state.picked.every(uid => alive.has(uid)), 'a stale card survived reconciliation')
  assert.deepEqual(transitionPotionSelection(state, { type: 'cancel' }), { kind: 'idle' })
}), { seed: 20261102, numRuns: 200 })

console.log('PASS action properties: generated callback orderings and selection reconciliation')
