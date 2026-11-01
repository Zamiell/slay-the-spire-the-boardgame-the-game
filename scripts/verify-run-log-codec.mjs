import fc from 'fast-check'
import { createRun, giveUpRun } from '../src/game/run.ts'
import { applyRunLogEvent, parseRunLog, statePatch, validateRunLog } from '../src/ui/run-log/codec.ts'
import { validSoloRun } from '../src/ui/run-state-validation.ts'
import { suite, check, assert, assertEqual, report } from './lib/harness.mjs'

suite('run log codec')
const opening = () => createRun(123, [{ id: 'p1', name: 'Ironclad', character: 'ironclad' }])
const recording = initial => {
  const terminal = giveUpRun(initial)
  return { version: 2, runId: initial.campaign.runId, initial,
    events: [{ patch: statePatch(initial, terminal), viewerId: 'p1' }] }
}

check('patches reconstruct additions, removals, and whole card piles without the DOM', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 8 }), (gold, removed) => {
    const before = opening()
    before.players[0].skin = 'kratos'
    const after = structuredClone(before)
    after.players[0].gold = gold
    after.players[0].deck.splice(0, removed)
    delete after.players[0].skin
    after.log.push('Recorded transition.')
    assertEqual(JSON.stringify(applyRunLogEvent(before, { patch: statePatch(before, after) })), JSON.stringify(after))
    assertEqual(before.players[0].skin, 'kratos')
  }), { numRuns: 60 })
})

check('finished recordings round-trip and selector validation remains an explicit boundary', () => {
  const log = recording(opening())
  log.events[0].choice = { source: { selector: 'button', name: 'Give up' } }
  assert(parseRunLog(JSON.stringify(log), selector => selector === 'button'))
  assertEqual(validateRunLog(log, () => false), null)
  log.events[0].choice.source.selector = 'button, *'
  assertEqual(validateRunLog(log, () => true), null)
})

check('legacy omitted patch values normalize to explicit removals', () => {
  const initial = opening()
  initial.players[0].skin = 'kratos'
  const log = recording(initial)
  log.events[0].patch.push({ path: ['players', 0, 'skin'] })
  const parsed = parseRunLog(JSON.stringify(log), () => true)
  assert(parsed)
  assertEqual(parsed.events[0].patch.at(-1).remove, true)
  assertEqual(applyRunLogEvent(initial, parsed.events[0]).players[0].skin, undefined)
})

check('strict imported recordings retain work limits without rejecting recoverable local saves', () => {
  const initial = opening()
  initial.log = Array.from({ length: 513 }, () => 'An older local journal.')
  assert(validSoloRun(initial))
  assertEqual(validateRunLog(recording(initial), () => true), null)
})

check('cross-run and unsafe patch paths cannot pass reconstruction validation', () => {
  const log = recording(opening())
  log.events[0].patch.push({ path: ['campaign', 'runId'], value: 'another-run' })
  assertEqual(validateRunLog(log, () => true), null)
  log.events[0].patch = [{ path: ['__proto__', 'polluted'], value: true }]
  assertEqual(validateRunLog(log, () => true), null)
})

report('run log codec')
