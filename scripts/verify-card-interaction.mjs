import assert from 'node:assert/strict'
import { beginGesture, followPose, moveGesture, releaseGesture, simpleCardMode } from '../src/ui/combat-screen/card-interaction.ts'

const card = (defId, extra = {}) => ({ uid: defId, defId, upgraded: false, ...extra })
assert.equal(simpleCardMode(card('strike_ironclad'), 1), 'enemy')
assert.equal(simpleCardMode(card('defend_ironclad'), 1), 'self')
assert.equal(simpleCardMode(card('defend_ironclad', { upgraded: true }), 2), null)
for (const id of ['bash', 'survivor', 'whirlwind', 'battle_trance', 'cleave', 'inflame']) {
  assert.equal(simpleCardMode(card(id), 1), null, `${id} must retain the complex-card path`)
}
assert.equal(simpleCardMode(card('strike_ironclad', { attachedGemId: 'guardian_ruby' }), 1), null)
const start = beginGesture({ x: 300, y: 850 }, 900, 1)
assert.equal(start.playY, 750)
assert.equal(start.cancelY, 855)
assert.equal(releaseGesture(start, 'enemy', null, false), 'aim', 'clicking should arm targeting')
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
console.log('PASS simple-card eligibility, play/cancel zones, click targeting, and frame-independent motion')
