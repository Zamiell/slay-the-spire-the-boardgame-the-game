import assert from 'node:assert/strict'
import { beginGesture, followPose, moveGesture, releaseGesture } from '../src/ui/combat-screen/card-interaction.ts'
import { startCardInput, transitionCardInput } from '../src/ui/combat-screen/card-input-state.ts'

const start = beginGesture({ x: 300, y: 850 }, 900, 1)
assert.equal(start.playY, 750)
assert.equal(start.cancelY, 855)
assert.equal(releaseGesture(start, 'enemy', null, false), 'aim', 'clicking should arm targeting')
assert.equal(releaseGesture(start, 'self', null, false), 'aim', 'clicking a skill should pick it up without playing it')
const aimed = moveGesture(start, { x: 800, y: 400 })
assert(aimed.enteredPlay)
assert.equal(releaseGesture(aimed, 'enemy', null, false), 'aim', 'an empty drag release should retain targeting')
assert.equal(releaseGesture(aimed, 'enemy', null, true), 'cancel', 'an empty second click should cancel')
assert.equal(releaseGesture(aimed, 'enemy', 'enemy-1', false), 'submit')
assert.equal(releaseGesture(aimed, 'self', null, false), 'submit')
const belowPlay = moveGesture(aimed, { x: 500, y: 800 })
assert(belowPlay.enteredPlay, 'returning below the play boundary must retain the cancellation hysteresis')
assert.equal(releaseGesture(belowPlay, 'self', null, false), 'cancel')
const pose = { x: 0, y: 0, scale: 0.8, angle: -8 }
const target = { x: 100, y: 80, scale: 1, angle: 0 }
const halfFrames = followPose(followPose(pose, target, 1 / 120), target, 1 / 120)
const fullFrame = followPose(pose, target, 1 / 60)
for (const key of Object.keys(pose)) assert(Math.abs(halfFrames[key] - fullFrame[key]) < 1e-10)
for (const mode of ['self', 'enemy', 'player']) {
  const pressed = startCardInput({ x: 300, y: 850 }, 900, 1, 1, 'mouse')
  const event = (type, point, target = null, pointerId = 1) => ({ type, point, mode, target, pointerId })
  const picked = transitionCardInput(pressed, event('release', { x: 300, y: 850 }))
  assert.equal(picked.state.kind, 'carrying')
  assert.equal(picked.effect, 'none', 'first click must not confirm any card type')
  const stale = transitionCardInput(pressed, event('release', { x: 700, y: 300 }, 'target', 2))
  assert.equal(stale.state, pressed, 'another pointer must not release this gesture')
  const submitted = transitionCardInput(picked.state, event('release', { x: 700, y: 300 }, 'target'))
  assert.equal(submitted.effect, 'confirm')
  assert.equal(transitionCardInput(submitted.state, event('release', { x: 700, y: 300 }, 'target')).effect, 'none')
  assert.equal(transitionCardInput(submitted.state, { type: 'cancel' }).state, submitted.state,
    'cancellation cannot retract an action awaiting the server')
  assert.equal(transitionCardInput(submitted.state, { type: 'refused' }).state.kind, 'returning')
  const accepted = transitionCardInput(submitted.state, { type: 'accepted' }).state
  assert.equal(accepted.kind, 'resolving')
  assert.equal(transitionCardInput(accepted, { type: 'refused' }).state, accepted,
    'a late refusal cannot retract an accepted flight')
  assert.equal(transitionCardInput(submitted.state, { type: 'choose' }).state.kind, 'idle')
  assert.equal(transitionCardInput(picked.state, { type: 'cancel' }).effect, 'return')
  const above = transitionCardInput(picked.state, event('move', { x: 300, y: 300 })).state
  assert.equal(transitionCardInput(above, event('move', { x: 300, y: 890 })).effect, 'return')
}
const touch = startCardInput({ x: 300, y: 850 }, 900, 1, 3, 'touch')
const touchEvent = (type, point) => ({ type, point, pointerId: 3, mode: 'self', target: null })
assert.equal(transitionCardInput(touch, touchEvent('release', { x: 300, y: 850 })).effect, 'inspect')
const scroll = transitionCardInput(touch, touchEvent('move', { x: 450, y: 845 }))
assert.equal(scroll.effect, 'scroll')
assert.equal(transitionCardInput(scroll.state, { type: 'cancel' }).state.kind, 'idle',
  'cancelling an unlifted touch must not animate a phantom return')
assert.equal(transitionCardInput(scroll.state, touchEvent('release', { x: 450, y: 845 })).state.kind, 'idle')
const lift = transitionCardInput(scroll.state, touchEvent('move', { x: 300, y: 400 }))
assert.equal(lift.effect, 'lift', 'a vertical gesture can leave horizontal scrolling')
assert.equal(transitionCardInput(lift.state, touchEvent('release', { x: 300, y: 400 })).effect, 'confirm')
console.log('PASS shared gesture transitions, touch inspection, server outcomes, cancellation and motion')
