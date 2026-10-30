import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { handLayout } from './hand-layout.ts'
import '../styles/hand-layout.css'

type Pose = { x: number; y: number; angle: number; scale: number }
type Holder = { pose: Pose; target: Pose; center: number }

/** One motion owner for the fan, hover spreading and changes to the hand. */
export function useHandLayout(rootRef: RefObject<HTMLDivElement | null>, reducedMotion: boolean, busy: boolean) {
  const options = useRef({ reducedMotion, busy })
  options.current = { reducedMotion, busy }
  const refreshRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const holders = new Map<HTMLElement, Holder>()
    let hovered: HTMLElement | null = null
    let preferFocus = false
    let frame = 0
    let previous = performance.now()
    root.dataset.handLayout = ''
    const cardAt = (target: EventTarget | null) => {
      const card = target instanceof Element ? target.closest<HTMLElement>('.card') : null
      return card?.parentElement === root ? card : null
    }
    const paint = (card: HTMLElement, holder: Holder) => {
      const { x, y, angle, scale } = holder.pose
      const transform = `translate3d(${x - holder.center}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`
      card.style.transform = transform
      card.style.setProperty('--hand-transform', transform)
    }
    const tick = (now: number) => {
      frame = 0
      const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000))
      previous = now
      let moving = false
      for (const [card, holder] of holders) {
        for (const [key, speed, epsilon] of [
          ['x', 7, 0.25], ['y', 7, 0.25], ['angle', 10, 0.1], ['scale', 8, 0.002],
        ] as const) {
          const difference = holder.target[key] - holder.pose[key]
          if (options.current.reducedMotion || Math.abs(difference) < epsilon) holder.pose[key] = holder.target[key]
          else { holder.pose[key] += difference * Math.min(1, dt * speed); moving = true }
        }
        paint(card, holder)
      }
      if (moving) frame = requestAnimationFrame(tick)
      else {
        root.removeAttribute('data-hand-moving')
        document.dispatchEvent(new Event('card-keyword-help-reposition'))
      }
    }
    const refresh = () => {
      const all = [...root.querySelectorAll<HTMLElement>(':scope > .card')]
      const cards = all.filter(card => !card.hasAttribute('data-interaction-lifted'))
      const active = cards.find(card => card === document.activeElement || card.classList.contains('card--selected')) ?? null
      const pointer = hovered && cards.includes(hovered) ? hovered : null
      const focus = options.current.busy ? null : preferFocus ? active ?? pointer : pointer ?? active
      const focused = focus ? cards.indexOf(focus) : -1
      const layout = handLayout(cards.length, focused)
      const width = cards[0]?.offsetWidth ?? 0
      const unit = width / 300
      // Large browser/Chamber hands extend the reference's ten-card fan into a scrollable strip.
      const step = cards.length > 10 ? Math.max(layout.step * unit, 64) : layout.step * unit
      for (const card of cards) card.style.marginInline = `${(step - width) / 2}px`
      const center = root.clientWidth / 2
      const gutter = parseFloat(getComputedStyle(root).paddingLeft)
      for (const [index, card] of cards.entries()) {
        const base = layout.cards[index]!
        const selected = index === focused && !card.classList.contains('card--interaction-source')
        const x = center + (cards.length > 10 ? (index - (cards.length - 1) / 2) * step
          + (base.x - (index - (cards.length - 1) / 2) * layout.step) * unit : base.x * unit)
        const scale = selected ? 1 : base.scale
        const target = { x: Math.max(gutter + width * scale / 2, Math.min(x, root.clientWidth - gutter - width * scale / 2)),
          y: selected ? -8 : card.offsetHeight / 2 + base.y * unit, angle: selected ? 0 : base.angle, scale }
        const holder = holders.get(card) ?? { pose: { ...target }, target, center: 0 }
        holder.center = card.offsetLeft + width / 2
        holder.target = target
        if (options.current.reducedMotion || card.classList.contains('card--interaction-source')) holder.pose = { ...target }
        holders.set(card, holder)
        card.toggleAttribute('data-hand-focused', selected)
        card.dataset.handNumber = String(all.indexOf(card) + 1)
        card.style.zIndex = selected ? '20' : String(index + 1)
        paint(card, holder)
      }
      for (const card of holders.keys()) if (!cards.includes(card)) holders.delete(card)
      if (focus && focus === active && root.parentElement) {
        const box = focus.getBoundingClientRect()
        const viewport = root.parentElement.getBoundingClientRect()
        const target = holders.get(focus)!.target
        const center = root.getBoundingClientRect().left + target.x
        const left = Math.min(box.left, center - width * target.scale / 2)
        const right = Math.max(box.right, center + width * target.scale / 2)
        root.parentElement.scrollLeft += left < viewport.left
          ? left - viewport.left - 8 : Math.max(0, right - viewport.right + 8)
      }
      root.dataset.handMoving = ''
      if (!frame) { previous = performance.now(); frame = requestAnimationFrame(tick) }
    }
    refreshRef.current = refresh
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || preferFocus) return
      const card = cardAt(event.target)
      if (card && card !== hovered) { hovered = card; refresh() }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      if (preferFocus) { preferFocus = false; hovered = cardAt(event.target); refresh() }
      else over(event)
    }
    const out = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || cardAt(event.relatedTarget) === hovered) return
      hovered = cardAt(event.relatedTarget)
      refresh()
    }
    const focus = (event: FocusEvent) => {
      if (event.type === 'focusin' && cardAt(event.target)?.matches(':focus-visible')) preferFocus = true
      queueMicrotask(() => { if (root.isConnected) refresh() })
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target === root ||
        record.target instanceof HTMLElement && record.target.parentElement === root)) refresh()
    })
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-interaction-lifted'] })
    const resize = new ResizeObserver(refresh)
    resize.observe(root)
    root.addEventListener('pointerover', over)
    root.addEventListener('pointermove', move)
    root.addEventListener('pointerout', out)
    root.addEventListener('focusin', focus)
    root.addEventListener('focusout', focus)
    root.addEventListener('hand-layout-change', refresh)
    window.addEventListener('resize', refresh)
    refresh()
    return () => {
      observer.disconnect()
      resize.disconnect()
      cancelAnimationFrame(frame)
      root.removeEventListener('pointerover', over)
      root.removeEventListener('pointermove', move)
      root.removeEventListener('pointerout', out)
      root.removeEventListener('focusin', focus)
      root.removeEventListener('focusout', focus)
      root.removeEventListener('hand-layout-change', refresh)
      window.removeEventListener('resize', refresh)
      refreshRef.current = () => {}
    }
  }, [rootRef])
  useLayoutEffect(() => refreshRef.current(), [reducedMotion, busy])
}
