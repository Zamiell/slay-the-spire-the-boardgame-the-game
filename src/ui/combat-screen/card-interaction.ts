import { cardDef, faceOf } from '../../game/cards.ts'
import type { CardInstance } from '../../game/types.ts'

export type CardInteractionMode = 'enemy' | 'self'
export type Point = { x: number; y: number }
export type CardPose = Point & { scale: number; angle: number }
export type Gesture = {
  origin: Point
  pointer: Point
  playY: number
  cancelY: number
  moved: boolean
  enteredPlay: boolean
}

/**
 * First migration slice: fixed-cost, single-target attacks and self-Block skills.
 * Choice-bearing, gem, Chamber, Power and other special cards keep the legacy adapter.
 */
export function simpleCardMode(card: CardInstance, partySize: number): CardInteractionMode | null {
  const def = faceOf(cardDef(card.defId), card.upgraded)
  if (card.attachedGemId || card.playWindowCost !== undefined || card.hermitDeadOn ||
    def.cost === 'X' || def.modes || def.guardian || def.trigger || def.unplayable ||
    def.exhaust || def.toDrawTop || def.supportTarget && partySize > 1) return null
  if (def.type === 'attack' && (!def.target || def.target === 'enemy') &&
    def.effects.length === 1 && def.effects[0]?.kind === 'hit' &&
    typeof def.effects[0].amount === 'number' && !def.effects[0].when) return 'enemy'
  if (def.type === 'skill' && !def.target &&
    def.effects.length === 1 && def.effects[0]?.kind === 'block' &&
    typeof def.effects[0].amount === 'number' && !def.effects[0].when) return 'self'
  return null
}

export function beginGesture(pointer: Point, height: number, unit: number): Gesture {
  const boundary = height * 0.75
  return {
    origin: pointer, pointer, moved: false, enteredPlay: false,
    playY: pointer.y > boundary ? Math.max(boundary, pointer.y - 100 * unit) : Math.min(boundary, pointer.y - 50 * unit),
    cancelY: height * 0.95,
  }
}

export function moveGesture(gesture: Gesture, pointer: Point): Gesture {
  return {
    ...gesture, pointer,
    moved: gesture.moved || Math.hypot(pointer.x - gesture.origin.x, pointer.y - gesture.origin.y) >= 10,
    enteredPlay: gesture.enteredPlay || pointer.y < gesture.playY,
  }
}

export function releaseGesture(gesture: Gesture, mode: CardInteractionMode, target: string | null, clickToTarget: boolean) {
  if (!gesture.moved && !clickToTarget) return 'aim'
  if (gesture.pointer.y >= gesture.playY) return 'cancel'
  if (mode === 'enemy' && !target) return clickToTarget ? 'cancel' : 'aim'
  return 'submit'
}

/** Frame-rate-independent following; finite tweens are reserved for committed flights. */
export function followPose(current: CardPose, target: CardPose, seconds: number): CardPose {
  const position = 1 - Math.exp(-18 * seconds)
  const rotation = 1 - Math.exp(-14 * seconds)
  const scale = 1 - Math.exp(-12 * seconds)
  return {
    x: current.x + (target.x - current.x) * position,
    y: current.y + (target.y - current.y) * position,
    angle: current.angle + (target.angle - current.angle) * rotation,
    scale: current.scale + (target.scale - current.scale) * scale,
  }
}
