// STS2 HandPosHelper positions, in its 300 x 422 card coordinate system.
const POSITIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, -50]],
  [[-100, -50], [100, -50]],
  [[-180, -50], [0, -59], [180, -50]],
  [[-240, -25], [-80, -50], [80, -50], [240, -25]],
  [[-340, 10], [-170, -30], [0, -50], [170, -30], [340, 10]],
  [[-460, 13], [-273, -25], [-90, -50], [90, -50], [273, -25], [460, 13]],
  [[-534, 18], [-365, -14], [-189, -39], [0, -50], [189, -39], [365, -14], [534, 18]],
  [[-565, 28], [-400, -14], [-231, -39], [-80, -50], [80, -50], [231, -39], [400, -14], [565, 28]],
  [[-600, 37], [-445, -2], [-300, -29], [-150, -45], [0, -50], [150, -45], [300, -29], [445, -2], [600, 37]],
  [[-610, 38], [-472, 5], [-340, -21], [-200, -41], [-64, -50], [64, -50], [200, -41], [340, -21], [472, 5], [610, 38]],
]
const ANGLES: readonly (readonly number[])[] = [
  [0], [-2, 2], [-3, 0, 3], [-8, -4, 4, 8], [-8, -4, 0, 4, 8],
  [-9, -6, -3, 3, 6, 9], [-9, -6, -3, 0, 3, 6, 9],
  [-12, -9, -6, -3, 3, 6, 9, 12], [-12, -9, -6, -3, 0, 3, 6, 9, 12],
  [-15, -12, -9, -6, -3, 3, 6, 9, 12, 15],
]

export function handLayout(count: number, focused = -1) {
  const scale = 0.8 * Math.max(0.75, 1 - Math.max(0, count - 7) * 0.05)
  const positions = POSITIONS[count - 1]
  const step = count <= 1 ? 200 : positions
    ? (positions[count - 1]![0] - positions[0]![0]) / (count - 1)
    : Math.max(90, 1220 / (count - 1))
  return {
    step,
    cards: Array.from({ length: count }, (_, index) => {
      const distance = count > 1 ? (index - (count - 1) / 2) / ((count - 1) / 2) : 0
      const [x, y] = positions?.[index] ?? [(index - (count - 1) / 2) * step, -50 + 88 * distance ** 2]
      const spread = focused < 0 ? 0 : Math.sign(index - focused) * Math.max(0, 100 - 25 * Math.abs(index - focused))
      return { x: x + spread, y, angle: ANGLES[count - 1]?.[index] ?? distance * 15, scale }
    }),
  }
}
