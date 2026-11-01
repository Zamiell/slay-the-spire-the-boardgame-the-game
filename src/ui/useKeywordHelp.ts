import { useEffect } from 'react'
import { cardTooltipPosition } from './card-tooltip-position.ts'
import { autoUpdate, positionTooltip } from './useTooltipPosition.ts'

export function useKeywordHelp() {
  useEffect(() => {
    let shiftHeld = false
    let preferFocus = false
    let pointerActive = false
    let active: HTMLElement | null = null
    let pinned: HTMLElement | null = null
    let dismissed: HTMLElement | null = null
    let repositionFrame = 0
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    let stopPositioning: (() => void) | undefined
    let placementGeneration = 0
    const cardOf = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>('[data-keyword-help-id]') : null
    const tooltipOf = (card: HTMLElement) => document.getElementById(card.dataset.keywordHelpId ?? '')
    const helpAvailable = (card: HTMLElement) => {
      const modal = document.activeElement?.closest('dialog:modal') ??
        [...document.querySelectorAll('dialog:modal')].at(-1) ??
        [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1)
      return card.isConnected && card.getClientRects().length > 0 && (!modal || modal.contains(card))
    }
    const cardForTooltip = (target: EventTarget | null) => {
      const tooltip = target instanceof Element ? target.closest<HTMLElement>('.card-keyword-tips') : null
      return tooltip?.id
        ? document.querySelector<HTMLElement>(`[data-keyword-help-id="${CSS.escape(tooltip.id)}"]`)
        : null
    }
    const hoverableTooltipOwner = (target: EventTarget | null) => {
      const card = cardForTooltip(target)
      return card && !card.classList.contains('card') ? card : null
    }
    const place = (card: HTMLElement, tooltip: HTMLElement) => {
      tooltip.setAttribute('data-open', '')
      if (!card.classList.contains('card') && !tooltip.classList.contains('card-keyword-tips--image')) {
        const generation = ++placementGeneration
        void positionTooltip(card, tooltip).then(({ x, y }) => {
          if (generation !== placementGeneration || active !== card || !tooltip.isConnected) return
          tooltip.style.left = `${x}px`
          tooltip.style.top = `${y}px`
          tooltip.removeAttribute('data-overlaps-card')
        })
        return
      }
      const cardBox = (card.querySelector('.enemy__hit-area') ?? card).getBoundingClientRect()
      const width = tooltip.offsetWidth
      const height = tooltip.offsetHeight
      const gap = 9
      const margin = 8
      const right = cardBox.right + gap
      const left = cardBox.left - width - gap
      const centered = cardBox.left + (cardBox.width - width) / 2
      const attached = card.classList.contains('card') && !tooltip.classList.contains('card-keyword-tips--image')
      const side = attached ? cardTooltipPosition(cardBox, { width, height },
        { width: window.innerWidth, height: window.innerHeight }) : null
      const candidates: [number, number][] = side ? [[side.x, side.y]] : window.innerWidth <= 700
        ? [[centered, cardBox.top - height - gap], [centered, cardBox.bottom + gap]]
        : [[right, cardBox.bottom - height], [left, cardBox.bottom - height],
            [right, cardBox.top - height - gap], [left, cardBox.top - height - gap],
            [centered, cardBox.top - height - gap], [centered, cardBox.bottom + gap]]
      if (!attached) for (const x of [margin, (window.innerWidth - width) / 2, window.innerWidth - width - margin]) {
        for (const y of [margin, (window.innerHeight - height) / 2, window.innerHeight - height - margin]) {
          candidates.push([x, y])
        }
      }
      const anchors = [...document.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [role="button"]',
      )]
        // Controls inside a closed <details> keep layout boxes that nobody can see.
        .filter((element) => !element.closest('details:not([open])') || element.closest('summary'))
        .map((element) => (element.querySelector('.enemy__hit-area') ?? element).getBoundingClientRect())
        .filter((box) => box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight)
      const powerZoom = document.querySelector<HTMLElement>('.power__zoom')?.getBoundingClientRect()
      const enemyTargets = tooltip.classList.contains('card-keyword-tips--image')
        ? [...document.querySelectorAll<HTMLElement>('.enemy:not(.enemy--dead)')]
          .map(enemy => ({ row: enemy.dataset.row, box: (enemy.querySelector('.enemy__hit-area') ?? enemy).getBoundingClientRect() }))
        : []
      const enemies = enemyTargets.filter(enemy => enemy.row === card.dataset.row).map(enemy => enemy.box)
      const groupLeft = Math.min(cardBox.left, ...enemies.map(box => box.left))
      const groupRight = Math.max(cardBox.right, ...enemies.map(box => box.right))
      if (tooltip.classList.contains('card-keyword-tips--image')) {
        for (const x of [groupRight + gap, groupLeft - width - gap]) {
          for (const y of [(window.innerHeight - height) / 2, cardBox.bottom - height, margin]) {
            candidates.unshift([x, y])
          }
        }
      }
      const positioned = candidates.map(([candidateLeft, candidateTop]) => {
        const x = Math.max(margin, Math.min(candidateLeft, window.innerWidth - width - margin))
        const y = Math.max(margin, Math.min(candidateTop, window.innerHeight - height - margin))
        const area = (box: DOMRect) =>
          Math.max(0, Math.min(x + width, box.right) - Math.max(x, box.left)) *
          Math.max(0, Math.min(y + height, box.bottom) - Math.max(y, box.top))
        const overlap = anchors.reduce((total, box) => total + area(box), 0)
        const powerOverlap = powerZoom ? area(powerZoom) : 0
        const enemyOverlap = enemyTargets.reduce((total, enemy) => total + area(enemy.box), 0)
        const groupGap = enemyTargets.length ? Math.max(0, groupLeft - (x + width), x - groupRight) : 0
        return { x, y, overlap, powerOverlap, enemyOverlap, groupGap }
      }).sort((a, b) => a.enemyOverlap - b.enemyOverlap || a.powerOverlap - b.powerOverlap ||
        a.groupGap - b.groupGap || a.overlap - b.overlap)[0]!
      tooltip.style.left = `${positioned.x}px`
      tooltip.style.top = `${positioned.y}px`
      tooltip.toggleAttribute('data-overlaps-card', positioned.overlap > 0)
      if (attached && (card.closest('.hand[data-hand-moving]') ||
        card.getAnimations().some(animation => animation instanceof CSSTransition &&
          animation.transitionProperty === 'transform' && animation.playState === 'running'))) reposition()
    }
    const hide = () => {
      placementGeneration++
      clearTimeout(closeTimer)
      stopPositioning?.()
      stopPositioning = undefined
      if (active) tooltipOf(active)?.removeAttribute('data-open')
      active = null
    }
    const show = (card: HTMLElement | null) => {
      if ((!shiftHeld && !card?.hasAttribute('data-help-on-hover')) || pointerActive) return hide()
      if (!card) {
        dismissed = null
        return hide()
      }
      if (!helpAvailable(card)) return hide()
      if (card === dismissed) return hide()
      dismissed = null
      if (active !== card) hide()
      active = card
      const tooltip = tooltipOf(card)
      if (!tooltip) {
        (card as HTMLElement & { mountKeywordHelp?: () => void }).mountKeywordHelp?.()
        return
      }
      place(card, tooltip)
      stopPositioning ??= autoUpdate(card, tooltip, () => place(card, tooltip))
      if (pinned === card) tooltip.setAttribute('data-pinned', '')
    }
    const current = () => {
      const focusCandidate = document.querySelector<HTMLElement>(':focus-visible[data-keyword-help-id]')
      const hoverCandidate = hoverableTooltipOwner(document.querySelector('.card-keyword-tips[data-open]:hover')) ??
        [...document.querySelectorAll<HTMLElement>(':hover[data-keyword-help-id]')].at(-1)
      const focus = focusCandidate && helpAvailable(focusCandidate) ? focusCandidate : null
      const hover = hoverCandidate && helpAvailable(hoverCandidate) ? hoverCandidate : null
      return preferFocus ? focus ?? hover : hover
    }
    const unpin = () => {
      if (pinned) tooltipOf(pinned)?.removeAttribute('data-pinned')
      pinned?.removeAttribute('data-keyword-help')
      pinned = null
    }
    const pin = (target: EventTarget | null) => {
      const card = cardOf(target)
      if (!card) return
      clearTimeout(closeTimer)
      if (card === pinned) return show(card)
      unpin()
      pinned = card
      pinned.setAttribute('data-keyword-help', '')
      show(card)
      tooltipOf(card)?.setAttribute('data-pinned', '')
    }
    const keydown = (event: KeyboardEvent) => {
      if (active && !helpAvailable(active)) hide()
      if (active && (!active.isConnected || !tooltipOf(active)?.hasAttribute('data-open'))) active = null
      if (event.key === 'Escape' && active) {
        const dismissOnlyHelp = pinned === active || !active.closest('dialog:modal')
        dismissed = active
        hide()
        if (dismissOnlyHelp) event.preventDefault()
        return
      }
      dismissed = null
      preferFocus = true
      if (event.key !== 'Shift') {
        if (!shiftHeld || !pinned) return
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
        const tooltip = tooltipOf(pinned)
        if (!tooltip) return
        const amount = event.key === 'ArrowDown' ? 40 : event.key === 'ArrowUp' ? -40
          : event.key === 'PageDown' ? tooltip.clientHeight * 0.8
            : event.key === 'PageUp' ? tooltip.clientHeight * -0.8 : null
        if (amount !== null) tooltip.scrollBy({ top: amount })
        else if (event.key === 'Home') tooltip.scrollTop = 0
        else if (event.key === 'End') tooltip.scrollTop = tooltip.scrollHeight
        else return
        event.preventDefault()
        return
      }
      shiftHeld = true
      pin(current())
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return
      shiftHeld = false
      unpin()
      show(current())
    }
    const pointerover = (event: PointerEvent) => {
      const card = cardOf(event.target) ?? hoverableTooltipOwner(event.target)
      if (event.pointerType !== 'touch' && card !== dismissed) dismissed = null
      preferFocus = false
      if (!card) return
      clearTimeout(closeTimer)
      if (card === active && tooltipOf(card)?.hasAttribute('data-open')) return
      if (shiftHeld) pin(card)
      else show(card)
    }
    const pointerdown = (event: PointerEvent) => {
      if (!cardOf(event.target)) {
        if (active?.hasAttribute('data-help-on-hover') && !cardForTooltip(event.target)) hide()
        return
      }
      pointerActive = true
      hide()
    }
    const pointerend = (event: PointerEvent) => {
      if (!pointerActive) return
      pointerActive = false
      if (event.pointerType === 'touch') {
        const card = cardOf(event.target)
        if (card?.hasAttribute('data-help-on-hover')) {
          dismissed = null
          return show(card)
        }
        dismissed = card
        return hide()
      }
      queueMicrotask(() => show(pinned ?? current()))
    }
    const pointerout = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const card = cardOf(event.target) ?? hoverableTooltipOwner(event.target)
      const next = cardOf(event.relatedTarget) ?? hoverableTooltipOwner(event.relatedTarget)
      if (card && active === card && next !== card && pinned !== card) {
        if (card.classList.contains('card')) return hide()
        clearTimeout(closeTimer)
        // Let the pointer cross the gap between a control and its help panel.
        closeTimer = setTimeout(() => show(current()), 150)
      }
    }
    const ready = (event: Event) => {
      const card = cardOf(event.target)
      if (card && (card === active || card === pinned || card === current())) show(card)
    }
    const focusin = (event: FocusEvent) => {
      if (active && !helpAvailable(active)) hide()
      const card = cardOf(event.target)
      if (!card) return
      clearTimeout(closeTimer)
      if (shiftHeld) pin(card)
      else show(card)
    }
    const focusout = () => {
      queueMicrotask(() => pinned ? show(pinned) : show(current()))
    }
    const reset = () => {
      shiftHeld = false
      preferFocus = false
      pointerActive = false
      dismissed = null
      unpin()
      hide()
    }
    const reposition = () => {
      if (!active || repositionFrame) return
      repositionFrame = requestAnimationFrame(() => {
        repositionFrame = 0
        if (active) show(active)
      })
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('keyup', keyup)
    document.addEventListener('pointerover', pointerover)
    document.addEventListener('pointerdown', pointerdown)
    document.addEventListener('pointerup', pointerend)
    document.addEventListener('pointercancel', pointerend)
    document.addEventListener('pointerout', pointerout)
    document.addEventListener('card-keyword-help-ready', ready)
    document.addEventListener('card-keyword-help-reposition', reposition)
    document.addEventListener('focusin', focusin)
    document.addEventListener('focusout', focusout)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('blur', reset)
    return () => {
      cancelAnimationFrame(repositionFrame)
      reset()
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('keyup', keyup)
      document.removeEventListener('pointerover', pointerover)
      document.removeEventListener('pointerdown', pointerdown)
      document.removeEventListener('pointerup', pointerend)
      document.removeEventListener('pointercancel', pointerend)
      document.removeEventListener('pointerout', pointerout)
      document.removeEventListener('card-keyword-help-ready', ready)
      document.removeEventListener('card-keyword-help-reposition', reposition)
      document.removeEventListener('focusin', focusin)
      document.removeEventListener('focusout', focusout)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('blur', reset)
    }
  }, [])
}
