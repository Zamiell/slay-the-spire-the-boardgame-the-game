import { beginGesture, moveGesture, releaseGesture } from './card-interaction.ts'
import type { CardInteractionMode, Gesture, Point } from './card-interaction.ts'

export type CardInputState = { gesture: Gesture } & (
  | { kind: 'pressed'; pointerId: number; pointerType: 'mouse' | 'touch'; lifted: boolean }
  | { kind: 'scrolling'; pointerId: number; pointerType: 'mouse' | 'touch' }
  | { kind: 'carrying' }
  | { kind: 'submitted' }
  | { kind: 'returning' }
  | { kind: 'resolving' }
  | { kind: 'idle' }
)
type Event =
  | { type: 'move' | 'release'; point: Point; pointerId: number; mode: CardInteractionMode; target: string | null }
  | { type: 'cancel' | 'accepted' | 'refused' | 'choose' }
export type CardInputEffect = 'none' | 'lift' | 'scroll' | 'inspect' | 'confirm' | 'return'

export function startCardInput(point: Point, height: number, unit: number,
  pointerId: number, pointerType: 'mouse' | 'touch'): CardInputState {
  return { kind: 'pressed', gesture: beginGesture(point, height, unit),
    pointerId, pointerType, lifted: pointerType === 'mouse' }
}

export function cardInputActive(state: CardInputState) {
  return state.kind === 'pressed' || state.kind === 'scrolling' || state.kind === 'carrying'
}

/** Pure gesture decisions. No DOM access, card effects, previews, or network requests. */
export function transitionCardInput(state: CardInputState, event: Event): { state: CardInputState; effect: CardInputEffect } {
  const stay = { state, effect: 'none' as const }
  if (event.type === 'accepted') return state.kind === 'submitted'
    ? { state: { kind: 'resolving', gesture: state.gesture }, effect: 'none' } : stay
  if (event.type === 'choose') return state.kind === 'submitted'
    ? { state: { kind: 'idle', gesture: state.gesture }, effect: 'none' } : stay
  if (event.type === 'refused' || event.type === 'cancel') {
    if (event.type === 'refused' ? state.kind !== 'submitted' : !cardInputActive(state)) return stay
    if (state.kind === 'scrolling' || state.kind === 'pressed' && !state.lifted) {
      return { state: { kind: 'idle', gesture: state.gesture }, effect: 'none' }
    }
    return { state: { kind: 'returning', gesture: state.gesture }, effect: 'return' }
  }
  if (event.type !== 'move' && event.type !== 'release') return stay
  if (!cardInputActive(state)) return stay
  if ((state.kind === 'pressed' || state.kind === 'scrolling') && event.pointerId !== state.pointerId) return stay
  const gesture = moveGesture(state.gesture, event.point)
  const dx = event.point.x - gesture.origin.x
  const dy = event.point.y - gesture.origin.y
  if (state.kind === 'scrolling' || state.kind === 'pressed' && !state.lifted) {
    const upward = dy < -10 && (-dy >= Math.abs(dx) || Boolean(event.target))
    if (!upward && (state.kind === 'scrolling' || Math.abs(dx) >= 10 && Math.abs(dx) > Math.abs(dy))) {
      return event.type === 'release'
        ? { state: { kind: 'idle', gesture }, effect: 'scroll' }
        : { state: { ...state, kind: 'scrolling', gesture }, effect: 'scroll' }
    }
    if (!upward) return event.type === 'release'
      ? { state: { kind: 'idle', gesture }, effect: 'inspect' } : stay
    if (event.type === 'move') return {
      state: { ...state, kind: 'pressed', lifted: true, gesture }, effect: 'lift',
    }
  }
  if (gesture.enteredPlay && gesture.pointer.y > gesture.cancelY) {
    return { state: { kind: 'returning', gesture }, effect: 'return' }
  }
  if (event.type === 'move') return { state: { ...state, gesture }, effect: 'none' }
  const result = releaseGesture(gesture, event.mode, event.target, state.kind === 'carrying')
  if (result === 'aim') return { state: { kind: 'carrying', gesture }, effect: 'none' }
  if (result === 'cancel') return { state: { kind: 'returning', gesture }, effect: 'return' }
  return { state: { kind: 'submitted', gesture }, effect: 'confirm' }
}

export function cardInputStage(state: CardInputState) {
  if (state.kind === 'pressed' || state.kind === 'carrying') return state.gesture.enteredPlay ? 'aiming' : 'dragging'
  return state.kind
}
