const motions = new WeakMap<HTMLElement, Animation>()

/** Reflow the remaining holders without transferring pointer capture off the source. */
export function liftFromHand(source: HTMLElement, lifted: boolean, reducedMotion: boolean) {
  if (source.hasAttribute('data-interaction-lifted') === lifted) return
  if (source.parentElement?.hasAttribute('data-hand-layout')) {
    source.toggleAttribute('data-interaction-lifted', lifted)
    source.parentElement.dispatchEvent(new Event('hand-layout-change'))
    return
  }
  const cards = [...source.parentElement?.querySelectorAll<HTMLElement>(':scope > .card') ?? []]
  const before = new Map(cards.map((card) => [card, card.getBoundingClientRect()]))
  for (const card of cards) motions.get(card)?.cancel()
  source.toggleAttribute('data-interaction-lifted', lifted)
  if (reducedMotion) return
  for (const card of cards) {
    if (card === source) continue
    const from = before.get(card)!
    const to = card.getBoundingClientRect()
    const animation = card.animate([
      { translate: `${from.x - to.x}px ${from.y - to.y}px` },
      { translate: '0 0' },
    ], { duration: 180, easing: 'cubic-bezier(.16,.8,.24,1)' })
    motions.set(card, animation)
  }
}
