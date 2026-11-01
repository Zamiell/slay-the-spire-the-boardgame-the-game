import type { CombatView } from '../../game/combat/view.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CardInstance } from '../../game/types.ts'

import { followPose } from './card-interaction.ts'
import type { CardPose, Point } from './card-interaction.ts'
import { cardInputActive, cardInputStage, startCardInput, transitionCardInput } from './card-input-state.ts'
import type { CardInputState } from './card-input-state.ts'
import type { CardPickup, CardPlayResult, CardSource } from './card-play.ts'
import { liftFromHand } from './hand-motion.ts'

type Destination = 'draw' | 'discard' | 'exhaust' | 'stage'
type Session = CardPickup & {
  id: number
  card: CardInstance
  state: CardInputState
  pointerId: number
  captured: boolean
  touch: boolean
  element: HTMLButtonElement
  scrollLeft: number
  width: number
  height: number
  pose: CardPose
  targetUid: string | null
  aimWithArrow: boolean
  stageStarted: number
  flightStart?: CardPose
  flightEnd?: Point
  returnPose?: CardPose
  destination?: Destination
}
type VisualSession = Session & { stage: ReturnType<typeof cardInputStage> }

type Options = {
  context: string
  combat: CombatView
  reducedMotion: boolean
  canUse: (card: CardInstance, source: CardSource) => boolean
  targetAt: (point: Point, pickup: CardPickup) => string | null
  confirm: (card: CardInstance, pickup: CardPickup, targetUid: string | null, point: Point) => CardPlayResult
  awaitingReply: () => boolean
  onPickup: () => void
  onLand: (destination: Destination) => void
}

/** One visual owns pickup, aiming, acknowledgement, return and the accepted flight. */
export function useCardInteraction(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const live = useRef<Session | null>(null)
  const retiring = useRef<Session[]>([])
  const nextId = useRef(0)
  const [session, setSession] = useState<VisualSession | null>(null)
  const [flights, setFlights] = useState<VisualSession[]>([])
  const cardElements = useRef(new Map<number, HTMLDivElement>())
  const arrowElement = useRef<SVGPathElement | null>(null)
  const clickSuppressed = useRef(false)
  const cancelledPointer = useRef<number | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const needsTargetArrow = (pickup: CardPickup) => pickup.mode !== 'self' &&
    (pickup.mode !== 'enemy' || latest.current.combat.enemies.filter(enemy => !enemy.dead).length !== 1)

  const publish = () => {
    const visual = (current: Session): VisualSession => ({ ...current, stage: cardInputStage(current.state) })
    const current = live.current
    const visible = current && current.state.kind !== 'scrolling' &&
      (current.state.kind !== 'pressed' || current.state.lifted)
    setSession(visible ? visual(current) : null)
    setFlights(retiring.current.map(visual))
  }
  const releaseCapture = (current: Session) => {
    current.captured = false
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId)
  }
  const clear = (interrupt = false) => {
    const current = live.current
    live.current = null
    if (current) {
      if (interrupt && current.captured) cancelledPointer.current = current.pointerId
      releaseCapture(current)
      liftFromHand(current.element, false, latest.current.reducedMotion)
    }
    publish()
  }
  const returnToHand = (current: Session) => {
    if (current.captured) cancelledPointer.current = current.pointerId
    current.state = { kind: 'returning', gesture: current.state.gesture }
    current.stageStarted = performance.now()
    current.flightStart = { ...current.pose }
    current.targetUid = null
    liftFromHand(current.element, false, latest.current.reducedMotion)
    releaseCapture(current)
    current.element.blur()
    publish()
  }
  const cancel = () => {
    const current = live.current
    if (!current) return
    const result = transitionCardInput(current.state, { type: 'cancel' })
    if (result.state === current.state) return
    if (result.state.kind === 'idle') { clear(true); return }
    returnToHand(current)
  }
  const suppressClick = () => {
    clickSuppressed.current = true
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { clickSuppressed.current = false }, 0)
  }
  const begin = (card: CardInstance, pickup: CardPickup, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !latest.current.canUse(card, pickup.source)) return false
    cancelledPointer.current = null
    if (live.current?.state.kind === 'returning') clear()
    if (live.current?.state.kind === 'resolving') {
      retiring.current.push(live.current)
      live.current = null
    }
    if (live.current) return true
    const source = event.currentTarget
    const rect = source.getBoundingClientRect()
    const style = getComputedStyle(source)
    const transform = new DOMMatrixReadOnly(style.transform)
    const width = parseFloat(style.width)
    const height = parseFloat(style.height)
    const pointer = { x: event.clientX, y: event.clientY }
    source.setPointerCapture(event.pointerId)
    live.current = {
      id: ++nextId.current,
      ...pickup, card, element: source, width, height,
      state: startCardInput(pointer, innerHeight, width / 180, event.pointerId, event.pointerType === 'mouse' ? 'mouse' : 'touch'),
      pointerId: event.pointerId, captured: true, touch: event.pointerType !== 'mouse',
      scrollLeft: source.closest('.hand-scroll')?.scrollLeft ?? 0,
      pose: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
        angle: Math.atan2(transform.b, transform.a) * 180 / Math.PI,
        scale: Math.hypot(transform.a, transform.b) },
      targetUid: null, aimWithArrow: needsTargetArrow(pickup), stageStarted: performance.now(),
    }
    // Touch needs to distinguish an inspection tap, a horizontal scroll, and a lift first.
    if (!live.current.touch) {
      liftFromHand(source, true, latest.current.reducedMotion)
      latest.current.onPickup()
      publish()
    }
    return true
  }
  const accept = (uid: string, destination: Destination) => {
    const current = live.current
    if (!current || current.card.uid !== uid || current.state.kind !== 'submitted') return false
    current.state = transitionCardInput(current.state, { type: 'accepted' }).state
    current.stageStarted = performance.now()
    current.flightStart = { ...current.pose }
    current.destination = destination
    const pile = current.element.closest('.combat')?.querySelector(`[data-pile="${destination}"]`)?.getBoundingClientRect()
      ?? document.querySelector(`[data-pile="${destination}"]`)?.getBoundingClientRect()
    current.flightEnd = pile ? { x: pile.x + pile.width / 2, y: pile.y + pile.height / 2 }
      : { x: innerWidth / 2, y: innerHeight * 0.43 }
    publish()
    return true
  }

  useLayoutEffect(() => {
    retiring.current = []
    clear(true)
  }, [options.context])

  useLayoutEffect(() => {
    const current = live.current
    if (!current || !cardInputActive(current.state)) return
    if (!current.element.isConnected) { clear(true); return }
    if (!latest.current.canUse(current.card, current.source)) { cancel(); return }
    const { gesture } = current.state
    const target = current.mode !== 'self' && gesture.pointer.y < gesture.playY
      ? latest.current.targetAt(gesture.pointer, current) : null
    const aimWithArrow = needsTargetArrow(current)
    if (target !== current.targetUid || aimWithArrow !== current.aimWithArrow) {
      current.targetUid = target
      current.aimWithArrow = aimWithArrow
      publish()
    }
  }, [options.combat])

  useEffect(() => {
    const input = (event: PointerEvent, type: 'move' | 'release') => {
      const current = live.current
      if (!current || !cardInputActive(current.state)) return
      const point = { x: event.clientX, y: event.clientY }
      const target = current.mode !== 'self' && point.y < current.state.gesture.playY
        ? latest.current.targetAt(point, current) : null
      const previous = current.state
      const result = transitionCardInput(previous, {
        type, point, pointerId: event.pointerId, mode: current.mode, target,
      })
      if (result.state === previous) return
      current.state = result.state
      const oldTarget = current.targetUid
      current.targetUid = target
      if (result.effect === 'inspect') { clear(); return }
      if (type === 'release') {
        suppressClick()
        event.preventDefault()
        releaseCapture(current)
      }
      if (result.effect === 'scroll' || result.effect === 'lift') {
        const scroll = current.element.closest('.hand-scroll')
        if (scroll) scroll.scrollLeft = result.effect === 'lift' ? current.scrollLeft
          : current.scrollLeft - (point.x - current.state.gesture.origin.x)
      }
      if (result.effect === 'lift') {
        liftFromHand(current.element, true, latest.current.reducedMotion)
        latest.current.onPickup()
      }
      if (result.effect === 'return') { returnToHand(current); return }
      if (current.state.kind === 'idle') { clear(); return }
      if (result.effect === 'confirm') {
        if (!latest.current.canUse(current.card, current.source)) { returnToHand(current); return }
        current.stageStarted = performance.now()
        publish()
        const confirmed = latest.current.confirm(current.card, current, target, point)
        if (live.current === current && current.state.kind === 'submitted') {
          if (confirmed === 'choosing') {
            current.state = transitionCardInput(current.state, { type: 'choose' }).state
            clear()
          } else if (confirmed === 'cancelled') returnToHand(current)
        }
      } else if (cardInputStage(previous) !== cardInputStage(current.state) ||
        previous.kind !== current.state.kind || oldTarget !== target || result.effect === 'lift') publish()
    }
    const move = (event: PointerEvent) => input(event, 'move')
    const up = (event: PointerEvent) => {
      if (cancelledPointer.current === event.pointerId) {
        cancelledPointer.current = null
        suppressClick()
        event.preventDefault()
        return
      }
      if (event.button === 0) input(event, 'release')
    }
    const down = (event: PointerEvent) => {
      const current = live.current
      if (!current || !cardInputActive(current.state)) return
      if (event.button === 2) { event.preventDefault(); cancel(); return }
      const target = event.target instanceof Element ? event.target : null
      if (current.state.kind === 'carrying' && target?.closest('button, input, select, summary, dialog') &&
        !target.closest('.enemy, .board')) cancel()
    }
    const click = (event: MouseEvent) => {
      if (!clickSuppressed.current) return
      clickSuppressed.current = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') { cancel(); return }
      if (event.key !== 'Escape' || !live.current || document.querySelector('.card-inspection[open]') ||
        ['submitted', 'resolving'].includes(live.current.state.kind)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    const pointerCancel = (event: PointerEvent) => {
      if (live.current?.pointerId === event.pointerId) cancel()
    }
    const lostCapture = (event: PointerEvent) => {
      if (live.current?.captured && live.current.pointerId === event.pointerId) cancel()
    }
    const contextMenu = (event: MouseEvent) => {
      if (live.current) { event.preventDefault(); cancel() }
    }
    const blur = () => cancel()
    const resize = () => { retiring.current = []; clear(true) }
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointercancel', pointerCancel, true)
    document.addEventListener('lostpointercapture', lostCapture, true)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('contextmenu', contextMenu, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointercancel', pointerCancel, true)
      document.removeEventListener('lostpointercapture', lostCapture, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('contextmenu', contextMenu, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', resize)
      if (live.current) {
        releaseCapture(live.current)
        liftFromHand(live.current.element, false, true)
      }
      clearTimeout(clickTimer.current)
    }
  }, [])

  const animating = Boolean(session || flights.length)
  useLayoutEffect(() => {
    if (!animating) return
    let frame = 0
    let previous = performance.now()
    const finish = (current: Session) => {
      if (live.current === current) clear()
      else { retiring.current = retiring.current.filter((item) => item !== current); publish() }
    }
    const animate = (current: Session, now: number, dt: number) => {
      const element = cardElements.current.get(current.id)
      if (!element) return
      const elapsed = now - current.stageStarted
      const stage = cardInputStage(current.state)
      const { gesture } = current.state
      let target: CardPose = {
        x: gesture.pointer.x, y: gesture.pointer.y - (current.touch ? current.height * 0.4 : 0),
        angle: 0, scale: 1.08,
      }
      if (stage === 'aiming' && current.aimWithArrow || stage === 'submitted') {
        target = { x: innerWidth / 2, y: innerHeight - current.height * 0.55, scale: 0.85, angle: 0 }
      }
      if (stage === 'returning') {
        if (!current.returnPose) {
          const rect = current.element.getBoundingClientRect()
          const transform = new DOMMatrixReadOnly(getComputedStyle(current.element).transform)
          current.returnPose = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
            scale: Math.hypot(transform.a, transform.b), angle: Math.atan2(transform.b, transform.a) * 180 / Math.PI }
        }
        const weight = latest.current.reducedMotion ? 1 : 1 - (1 - Math.min(1, elapsed / 220)) ** 3
        const from = current.flightStart!
        const to = current.returnPose
        current.pose = { x: from.x + (to.x - from.x) * weight, y: from.y + (to.y - from.y) * weight,
          scale: from.scale + (to.scale - from.scale) * weight, angle: from.angle + (to.angle - from.angle) * weight }
        if (weight === 1) { finish(current); return }
      } else if (stage === 'submitted' && elapsed > 150 && !latest.current.awaitingReply()) {
        // A refusal leaves the physical card in hand. Accepted cards are handed off in layout.
        current.state = transitionCardInput(current.state, { type: 'refused' }).state
        returnToHand(current)
      } else if (stage === 'resolving' && current.flightStart) {
        const duration = latest.current.reducedMotion ? 1 : 620
        const progress = Math.min(1, elapsed / duration)
        const start = current.flightStart
        const center = { x: innerWidth / 2, y: innerHeight * 0.43 }
        const end = current.flightEnd ?? center
        if (progress < 0.35) {
          const weight = 1 - (1 - progress / 0.35) ** 3
          current.pose = { x: start.x + (center.x - start.x) * weight, y: start.y + (center.y - start.y) * weight,
            scale: start.scale + (1 - start.scale) * weight, angle: start.angle * (1 - weight) }
        } else {
          const weight = ((progress - 0.35) / 0.65) ** 2
          current.pose = {
            x: center.x + (end.x - center.x) * weight,
            y: center.y + (end.y - center.y) * weight - Math.sin(Math.PI * weight) * 90,
            scale: 1 - weight * 0.85, angle: weight * 18,
          }
        }
        element.style.opacity = String(1 - Math.max(0, progress - 0.8) * 5)
        if (progress === 1) {
          if (current.destination) latest.current.onLand(current.destination)
          finish(current)
          return
        }
      } else if (!latest.current.canUse(current.card, current.source)) { cancel() }
      if (current.state.kind !== 'resolving' && current.state.kind !== 'returning') {
        current.pose = latest.current.reducedMotion ? target : followPose(current.pose, target, dt)
      }
      const pose = current.pose
      element.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) translate(-50%, -50%) rotate(${pose.angle}deg) scale(${pose.scale})`
      if (current === live.current) {
        const pointer = current.state.gesture.pointer
        arrowElement.current?.setAttribute('d', `M ${pose.x} ${pose.y - current.height * pose.scale / 2} Q ${pose.x} ${pointer.y - 90} ${pointer.x} ${pointer.y}`)
      }
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - previous) / 1000)
      previous = now
      for (const current of [...retiring.current, ...(live.current ? [live.current] : [])]) animate(current, now, dt)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animating])

  return { session, flights, cardElements, arrowElement, begin, accept,
    ownsCard: (uid: string) => live.current?.card.uid === uid }
}
