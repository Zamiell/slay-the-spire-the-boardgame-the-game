import assert from 'node:assert/strict'
import { cardTooltipPosition } from '../src/ui/card-tooltip-position.ts'
import { drawLockText } from '../src/ui/draw-lock-text.ts'

for (const [text, blocked] of [
  ['Gain 2 Energy. Draw 3 cards. Exhaust.', ['Draw 3 cards']],
  ['Any player draws 2 cards.', ['draws 2 cards']],
  ['draw 1 card then discard 1 card', ['draw 1 card']],
  ['Draw until you have 5 cards in hand.', ['Draw until you have 5 cards in hand']],
  ['discard your hand, then draw that many cards', ['draw that many cards']],
  ['Draw cards and gain Energy equal to its level.', ['Draw cards']],
  ['Draw 2 cards. You cannot draw more cards this turn.', ['Draw 2 cards']],
  ["You can't draw additional cards this turn.", []],
  ['Search your draw pile for 1 card, then shuffle your draw pile.', []],
]) {
  const parts = drawLockText(text)
  assert.equal(parts.map(part => part.text).join(''), text)
  assert.deepEqual(parts.filter(part => part.blocked).map(part => part.text), blocked)
}

const desktop = { width: 1440, height: 900 }
const card = { left: 600, right: 800, top: 500 }
assert.deepEqual(cardTooltipPosition(card, { width: 224, height: 150 }, desktop), { x: 809, y: 500 },
  'short stacks should start at the card top, on its right')
assert.deepEqual(cardTooltipPosition(card, { width: 224, height: 500 }, desktop), { x: 809, y: 392 },
  'bottom overflow should raise the stack without detaching it sideways')
assert.deepEqual(cardTooltipPosition({ ...card, left: 1200, right: 1400 },
  { width: 224, height: 150 }, desktop), { x: 967, y: 500 },
  'right-edge cards should put their stack on the left')
assert.deepEqual(cardTooltipPosition({ left: 360, right: 480, top: 220 },
  { width: 224, height: 350 }, { width: 844, height: 390 }), { x: 489, y: 32 },
  'horizontal phones must keep tall stacks beside the card and inside the viewport')
console.log('PASS card-side tooltip alignment, upward overflow and left-side fallback')
