/** Keep keyword stacks beside their card; viewport overflow changes alignment, not the anchor. */
export function cardTooltipPosition(
  card: { left: number; right: number; top: number },
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const gap = 9
  const margin = 8
  const rightSpace = viewport.width - card.right - gap - margin
  const leftSpace = card.left - gap - margin
  const left = rightSpace >= tooltip.width || rightSpace >= leftSpace
    ? card.right + gap : card.left - tooltip.width - gap
  return {
    x: Math.max(margin, Math.min(left, viewport.width - tooltip.width - margin)),
    y: Math.max(margin, Math.min(card.top, viewport.height - tooltip.height - margin)),
  }
}
