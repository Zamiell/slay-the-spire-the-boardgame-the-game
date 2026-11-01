
import type { ControlRef } from './codec.ts'

export const CONTROL = 'button, input, select, textarea, summary, [role="button"]'

export const INSPECTION = '.map-peek, .map-peek__open, .card-collection, .card-inspection, .compendium, .deck-peek__open, .game-settings, .settings-dialog, [data-pile], .pause-menu, .room:not(.room--reachable), .die-breakdown-trigger, .die-breakdown'

export const OPEN_INSPECTION = '.settings-dialog[open], .map-peek[open], .card-collection[open], .card-inspection[open], .die-breakdown[open], .compendium, .replay-bar__menu'

export const CANCEL_CHOICE = /^(cancel|close|back(?: to (?:choices|run))?)$/i

export type Point = { x: number; y: number }

export function point(element: Element): Point {
  const box = element.getBoundingClientRect()
  const view = element.ownerDocument.defaultView ?? window
  return { x: (box.left + box.width / 2) / view.innerWidth, y: (box.top + box.height / 2) / view.innerHeight }
}

export function selector(element: Element): string {
  for (const attribute of ['data-enemy-id', 'data-player-id', 'data-room', 'data-event-option', 'data-orb-slot']) {
    const value = element.getAttribute(attribute)
    if (value !== null) return `[${attribute}="${CSS.escape(value)}"]`
  }
  const parts: string[] = []
  for (let current: Element | null = element; current && current !== document.documentElement; current = current.parentElement) {
    if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break }
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter((candidate) => candidate.tagName === current!.tagName) : []
    parts.unshift(`${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''}`)
    if (current.matches('.app-shell, dialog')) break
  }
  return parts.join(' > ')
}

export function controlName(element: HTMLElement) {
  const name = element.getAttribute('aria-label')?.trim() || element.textContent?.trim()
  return element.hasAttribute('data-room') ? name?.replace(/, Activate again to enter$/, '') : name
}

export function controlRef(element: HTMLElement): ControlRef {
  const name = controlName(element)
  const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  return {
    selector: selector(element), ...(name ? { name } : {}),
    ...('value' in input ? { value: input.value } : {}),
    ...(input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type) ? { checked: input.checked } : {}),
    ...(element.matches('.hand .card, [data-orb-slot], .end-turn-effect--orb') ? { drag: true as const } : {}),
    ...(element.matches('.hand .card') ? { card: true as const } : {}),
    ...(element.closest('[data-enemy-id], [data-player-id]') ? { target: true as const } : {}),
  }
}

export function replayableControl(element: HTMLElement) {
  return element.matches(CONTROL) && !element.closest('[data-run-log-control], .settings-dialog, ' + INSPECTION)
}

export function gameplayControl(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target.closest<HTMLElement>(CONTROL) : null
  return element && replayableControl(element) ? element : null
}
