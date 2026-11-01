type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

export function avoidTooltipControls(
  preferred: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  controls: readonly Bounds[],
) {
  const { width, height } = preferred
  const margin = 16
  const gap = 8
  const candidates: [number, number][] = [[preferred.x, preferred.y]]
  for (const box of controls) {
    candidates.push([box.left - width - gap, preferred.y], [box.right + gap, preferred.y],
      [preferred.x, box.top - height - gap], [preferred.x, box.bottom + gap])
  }
  for (const x of [margin, (viewport.width - width) / 2, viewport.width - width - margin]) {
    for (const y of [margin, (viewport.height - height) / 2, viewport.height - height - margin]) {
      candidates.push([x, y])
    }
  }
  return candidates.map(([left, top]) => {
    const x = Math.max(margin, Math.min(left, viewport.width - width - margin))
    const y = Math.max(margin, Math.min(top, viewport.height - height - margin))
    const overlap = controls.reduce((area, box) => area +
      Math.max(0, Math.min(x + width, box.right) - Math.max(x, box.left)) *
      Math.max(0, Math.min(y + height, box.bottom) - Math.max(y, box.top)), 0)
    return { x, y, overlap, distance: Math.hypot(x - preferred.x, y - preferred.y) }
  }).sort((a, b) => a.overlap - b.overlap || a.distance - b.distance)[0]!
}
