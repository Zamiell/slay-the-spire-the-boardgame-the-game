import assert from 'node:assert/strict'
import { cardTooltipPosition } from '../src/ui/card-tooltip-position.ts'

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
