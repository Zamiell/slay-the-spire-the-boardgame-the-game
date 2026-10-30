import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CardInstance } from '../../game/types.ts'
import type { CombatState } from '../../game/combat.ts'
import { beginGesture, followPose, moveGesture, releaseGesture } from './card-interaction.ts'
import type { CardInteractionMode, CardPose, Gesture, Point } from './card-interaction.ts'
import { liftFromHand } from './hand-motion.ts'

type Stage = 'dragging' | 'aiming' | 'scrolling' | 'submitted' | 'returning' | 'resolving'
type Destination = 'draw' | 'discard' | 'exhaust' | 'stage'
type Session = {
  id: number
  card: CardInstance
  mode: CardInteractionMode
  handoff: boolean
  stage: Stage
  gesture: Gesture
  pointerId: number
  captured: boolean
  touch: boolean
  clickToTarget: boolean
  source: HTMLButtonElement
  scrollLeft: number
  width: number
  height: number
  pose: CardPose
  targetUid: string | null
  stageStarted: number
  flightStart?: CardPose
  flightEnd?: Point
  returnPose?: CardPose
  destination?: Destination
}

type Options = {
  context: string
  combat: CombatState
  reducedMotion: boolean
  canUse: (card: CardInstance) => boolean
  targetAt: (point: Point, card: CardInstance) => string | null
  submit: (card: CardInstance, targetUid: string | null, handoff: boolean, point: Point) => void
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
  const [session, setSession] = useState<Session | null>(null)
  const [flights, setFlights] = useState<Session[]>([])
  const cardElements = useRef(new Map<number, HTMLDivElement>())
  const arrowElement = useRef<SVGPathElement | null>(null)
  const clickSuppressed = useRef(false)
  const cancelledPointer = useRef<number | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const publish = () => {
    setSession(live.current ? { ...live.current } : null)
    setFlights([...retiring.current])
  }
  const releaseCapture = (current: Session) => {
    current.captured = false
    if (current.source.hasPointerCapture(current.pointerId)) current.source.releasePointerCapture(current.pointerId)
  }
  const clear = (interrupt = false) => {
    const current = live.current
    live.current = null
    if (current) {
      if (interrupt && current.captured) cancelledPointer.current = current.pointerId
      releaseCapture(current)
      liftFromHand(current.source, false, latest.current.reducedMotion)
    }
    publish()
  }
  const returnToHand = (current: Session) => {
    if (current.captured) cancelledPointer.current = current.pointerId
    current.stage = 'returning'
    current.stageStarted = performance.now()
    current.flightStart = { ...current.pose }
    current.targetUid = null
    liftFromHand(current.source, false, latest.current.reducedMotion)
    releaseCapture(current)
    current.source.blur()
    publish()
  }
  const cancel = () => {
    const current = live.current
    if (!current || ['returning', 'submitted', 'resolving'].includes(current.stage)) return
    returnToHand(current)
  }
  const suppressClick = () => {
    clickSuppressed.current = true
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { clickSuppressed.current = false }, 0)
  }
  const begin = (card: CardInstance, mode: CardInteractionMode, event: ReactPointerEvent<HTMLButtonElement>, handoff = false) => {
    if (event.button !== 0 || !latest.current.canUse(card)) return false
    cancelledPointer.current = null
    if (live.current?.stage === 'returning') clear()
    if (live.current?.stage === 'resolving') {
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
      card, mode, handoff, source, width, height,
      stage: 'dragging', gesture: beginGesture(pointer, innerHeight, width / 180),
      pointerId: event.pointerId, captured: true, touch: event.pointerType !== 'mouse', clickToTarget: false,
      scrollLeft: source.closest('.hand-scroll')?.scrollLeft ?? 0,
      pose: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
        angle: Math.atan2(transform.b, transform.a) * 180 / Math.PI,
        scale: Math.hypot(transform.a, transform.b) },
      targetUid: null, stageStarted: performance.now(),
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
    if (!current || current.card.uid !== uid || current.stage !== 'submitted') return false
    current.stage = 'resolving'
    current.stageStarted = performance.now()
    current.flightStart = { ...current.pose }
    current.destination = destination
    const pile = current.source.closest('.combat')?.querySelector(`[data-pile="${destination}"]`)?.getBoundingClientRect()
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
    if (!current || !['dragging', 'aiming'].includes(current.stage)) return
    if (!current.source.isConnected) { clear(true); return }
    if (!latest.current.canUse(current.card)) { cancel(); return }
    const target = current.mode === 'enemy' && current.gesture.pointer.y < current.gesture.playY
      ? latest.current.targetAt(current.gesture.pointer, current.card) : null
    if (target !== current.targetUid) {
      current.targetUid = target
      publish()
    }
  }, [options.combat])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = live.current
      if (!current || !['dragging', 'aiming', 'scrolling'].includes(current.stage) ||
        (!current.clickToTarget && event.pointerId !== current.pointerId)) return
      const point = { x: event.clientX, y: event.clientY }
      const next = moveGesture(current.gesture, point)
      const dx = point.x - next.origin.x
      const dy = point.y - next.origin.y
      const firstLift = current.touch && !current.gesture.moved
      if (current.touch && (firstLift || current.stage === 'scrolling')) {
        if (current.stage === 'scrolling' || Math.abs(dx) >= 10 && Math.abs(dx) > Math.abs(dy)) {
          current.stage = 'scrolling'
          const scroll = current.source.closest('.hand-scroll')
          if (scroll) scroll.scrollLeft = current.scrollLeft - dx
          return
        }
        if (dy >= -10) return
      }
      const oldStage = current.stage
      const oldTarget = current.targetUid
      if (firstLift) {
        liftFromHand(current.source, true, latest.current.reducedMotion)
        latest.current.onPickup()
      }
      current.gesture = next
      if (next.enteredPlay && point.y > next.cancelY) { cancel(); return }
      current.stage = next.enteredPlay ? 'aiming' : 'dragging'
      current.targetUid = current.mode === 'enemy' && point.y < next.playY
        ? latest.current.targetAt(point, current.card) : null
      if (oldStage !== current.stage || oldTarget !== current.targetUid || firstLift) publish()
    }
    const up = (event: PointerEvent) => {
      if (cancelledPointer.current === event.pointerId) {
        cancelledPointer.current = null
        suppressClick()
        event.preventDefault()
        return
      }
      const current = live.current
      if (current?.stage === 'scrolling' && current.pointerId === event.pointerId) { suppressClick(); clear(); return }
      if (!current || event.button !== 0 || !['dragging', 'aiming'].includes(current.stage)) return
      if (!current.clickToTarget && event.pointerId !== current.pointerId) return
      if (current.touch && !current.gesture.moved) { clear(); return }
      current.gesture = moveGesture(current.gesture, { x: event.clientX, y: event.clientY })
      const target = current.mode === 'enemy' ? latest.current.targetAt(current.gesture.pointer, current.card) : null
      const result = releaseGesture(current.gesture, current.mode, target, current.clickToTarget)
      suppressClick()
      event.preventDefault()
      releaseCapture(current)
      if (result === 'cancel') { cancel(); return }
      if (result === 'aim') {
        current.clickToTarget = true
        publish()
        return
      }
      if (!latest.current.canUse(current.card)) { cancel(); return }
      if (current.handoff) {
        // Enter the existing choice/preview flow only after the pickup is confirmed.
        clear()
        latest.current.submit(current.card, target, true, current.gesture.pointer)
        return
      }
      current.stage = 'submitted'
      current.stageStarted = performance.now()
      current.targetUid = target
      publish()
      latest.current.submit(current.card, target, false, current.gesture.pointer)
    }
    const down = (event: PointerEvent) => {
      const current = live.current
      if (!current || current.stage === 'returning' || current.stage === 'resolving') return
      if (event.button === 2) { event.preventDefault(); cancel(); return }
      const target = event.target instanceof Element ? event.target : null
      if (current.clickToTarget && target?.closest('button, input, select, summary, dialog') &&
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
      if (event.key !== 'Escape' || !live.current ||
        ['submitted', 'resolving'].includes(live.current.stage)) return
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
        liftFromHand(live.current.source, false, true)
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
      let target: CardPose = {
        x: current.gesture.pointer.x, y: current.gesture.pointer.y - (current.touch ? current.height * 0.4 : 0),
        angle: 0, scale: 1.08,
      }
      if (current.stage === 'aiming' && current.mode === 'enemy' || current.stage === 'submitted') {
        target = { x: innerWidth / 2, y: innerHeight - current.height * 0.55, scale: 0.85, angle: 0 }
      }
      if (current.stage === 'returning') {
        if (!current.returnPose) {
          const rect = current.source.getBoundingClientRect()
          const transform = new DOMMatrixReadOnly(getComputedStyle(current.source).transform)
          current.returnPose = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
            scale: Math.hypot(transform.a, transform.b), angle: Math.atan2(transform.b, transform.a) * 180 / Math.PI }
        }
        const weight = latest.current.reducedMotion ? 1 : 1 - (1 - Math.min(1, elapsed / 220)) ** 3
        const from = current.flightStart!
        const to = current.returnPose
        current.pose = { x: from.x + (to.x - from.x) * weight, y: from.y + (to.y - from.y) * weight,
          scale: from.scale + (to.scale - from.scale) * weight, angle: from.angle + (to.angle - from.angle) * weight }
        if (weight === 1) { finish(current); return }
      } else if (current.stage === 'submitted' && elapsed > 150 && !latest.current.awaitingReply()) {
        // A refusal leaves the physical card in hand. Accepted cards are handed off in layout.
        returnToHand(current)
      } else if (current.stage === 'resolving' && current.flightStart) {
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
      } else if (!latest.current.canUse(current.card)) { cancel() }
      if (current.stage !== 'resolving' && current.stage !== 'returning') {
        current.pose = latest.current.reducedMotion ? target : followPose(current.pose, target, dt)
      }
      const pose = current.pose
      element.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) translate(-50%, -50%) rotate(${pose.angle}deg) scale(${pose.scale})`
      if (current === live.current) {
        const pointer = current.gesture.pointer
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
