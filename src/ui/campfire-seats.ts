/** A spot on one of the camp's two logs, in percent of the camp painting. */
export type Seat = { x: number; y: number; scale: number; facing: 'left' | 'right' }

const seat = (x: number, y: number, scale: number): Seat =>
  ({ x: x / 38.4, y: y / 21.61, scale, facing: x < 2000 ? 'right' : 'left' })
// Hips on the top of each log in camp.webp pixels (3840x2161). The fire is at x 2000; outer seats sit nearer the viewer.
const LEFT = seat(1230, 1386, 1)
const LEFT_OUTER = seat(1010, 1445, 1.03)
const LEFT_INNER = seat(1450, 1327, 0.97)
const RIGHT = seat(2790, 1410, 1)
const RIGHT_INNER = seat(2560, 1340, 0.97)
const RIGHT_OUTER = seat(3010, 1474, 1.03)

/** Where a party of each size sits, in party order. */
export const SEATING: readonly (readonly Seat[])[] = [
  [],
  [LEFT],
  [LEFT, RIGHT],
  [LEFT_OUTER, LEFT_INNER, RIGHT],
  [LEFT_OUTER, LEFT_INNER, RIGHT_INNER, RIGHT_OUTER],
]
