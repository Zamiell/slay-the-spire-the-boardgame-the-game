import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CombatState } from '../../game/combat.ts'
import type { Enemy, Player } from '../../game/types.ts'
import { enemyDef } from '../../game/enemies.ts'
import { displayedEnemies } from '../board-signals.ts'
import { fitStageScale } from './stage-layout.ts'

type StageState = {
  combatId: string
  phase: CombatState['phase']
  players: readonly Pick<Player, 'id' | 'character' | 'orbs' | 'slimes'>[]
  enemies: readonly Enemy[]
}

/** Owns the stage camera, DOM measurements, and scroll intent, never gameplay transitions. */
export function useCombatStage({ state, viewerId, falling, attacking: stageAttacksActive,
  reducedMotion: prefersReducedMotion, restoration: authoritativeRestoration }: {
  state: StageState
  viewerId: string
  falling: ReadonlySet<string>
  attacking: boolean
  reducedMotion: boolean
  restoration?: number
}) {
  const [{ scale: stageScale, enemySlots: stageEnemySlots }, setStageLayout] = useState({
    scale: 1, enemySlots: state.enemies.filter(enemy => !enemy.dead).length,
  })
  const [stageMotionReady, setStageMotionReady] = useState(false)
  const fittedStage = useRef<{ combatId: string; restoration: number | undefined } | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const combatBarRef = useRef<HTMLElement | null>(null)
  const viewerRowRef = useRef<HTMLDivElement | null>(null)
  const followViewerRow = useRef(true)
  const programmaticScroll = useRef<{ left: number; top: number } | null>(null)
  const manualBoardScroll = useRef(false)
  const releaseFrame = useRef(0)
  const visibleEnemies = displayedEnemies(state.enemies, prefersReducedMotion ? new Set() : falling)

  function recenterViewerRow() {
    const board = boardRef.current
    revealViewerRow(board, viewerRowRef.current)
    programmaticScroll.current = board ? { left: board.scrollLeft, top: board.scrollTop } : null
  }

  useLayoutEffect(() => {
    // Commit restored positions and scale together before allowing new tweens.
    setStageMotionReady(false)
    const frame = requestAnimationFrame(() => {
      boardRef.current?.getBoundingClientRect()
      setStageMotionReady(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [state.combatId, authoritativeRestoration])
  const stageFormationKey = state.enemies.map((enemy) =>
    `${enemy.uid}:${enemy.defId}:${enemy.row}:${enemy.isBoss}:${enemy.dead}`).join('|')
  useLayoutEffect(() => {
    if (prefersReducedMotion) return
    const busy = stageAttacksActive || falling.size > 0 || state.phase === 'enemy'
    // A new attack can begin midway through a camera tween. Hold native stage
    // transitions before attack offsets are measured, then continue recovery.
    for (const animation of boardRef.current?.closest('.combat')?.getAnimations({ subtree: true }) ?? []) {
      if (!(animation instanceof CSSTransition) || !animation.transitionProperty.startsWith('--stage-')) continue
      if (busy) {
        // pause() alone schedules a pause for the next frame in WebKit.
        // Freeze this frame before measuring attack source/target offsets.
        const time = animation.currentTime
        animation.pause()
        if (time !== null) animation.currentTime = time
      } else if (animation.playState === 'paused') {
        const time = animation.currentTime
        animation.play()
        // WebKit otherwise reuses the transition's original, now-expired start.
        if (typeof time === 'number' && typeof document.timeline.currentTime === 'number') {
          animation.startTime = document.timeline.currentTime - time
        }
      }
    }
  }, [stageAttacksActive, falling.size, state.phase, state.players.length, stageFormationKey,
    stageScale, stageEnemySlots, state.combatId, prefersReducedMotion])

  const stageEnemyCount = visibleEnemies.length
  const stageScaleActors = state.players.length + stageEnemyCount
  // EnemyCard can briefly retain its previous visual during restoration.
  // Fit from encounter data so new tall enemies start at the correct scale.
  const stageHasTallEnemy = visibleEnemies.some(enemy => {
    const def = enemyDef(enemy.defId)
    return enemy.isBoss || def.elite || (def.artId ?? def.id) === 'sentry'
  })
  const stageHasOrbs = state.players.some(player => player.character === 'defect'
    ? player.orbs.length > 0 : player.orbs.some(Boolean))
  const stagePresentationBusy = !prefersReducedMotion && (stageAttacksActive || falling.size > 0 || state.phase === 'enemy')
  const largestSlimeParty = Math.max(0, ...state.players.map(player => player.character === 'slime_boss' ? player.slimes.length : 0))
  const statusPlayerIds = state.players.map(player => player.id).join('\0')

  useLayoutEffect(() => {
    const bar = combatBarRef.current
    const combat = bar?.parentElement
    if (!bar || !combat) return
    const measure = () => {
      combat.style.setProperty('--combat-bar-bottom', `${bar.offsetTop + bar.offsetHeight}px`)
      combat.style.setProperty('--combat-bar-viewport-bottom', `${bar.getBoundingClientRect().bottom}px`)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(bar)
    observer?.observe(combat)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [state.combatId])

  useLayoutEffect(() => {
    const statuses = boardRef.current?.querySelectorAll<HTMLElement>('.seat__meta') ?? []
    // Keep Orbs above wrapped statuses without moving the hero.
    const measure = (element: HTMLElement) => {
      element.closest<HTMLElement>('.seat__interactive')?.style
        .setProperty('--temporary-status-height', `${element.offsetHeight}px`)
    }
    statuses.forEach(measure)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) if (entry.target instanceof HTMLElement) measure(entry.target)
    })
    statuses.forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [state.combatId, statusPlayerIds])

  useLayoutEffect(() => {
    const board = boardRef.current
    if (!board) return
    // Let contact, death and recovery finish before changing the stage camera.
    if (stagePresentationBusy && fittedStage.current?.combatId === state.combatId &&
      fittedStage.current.restoration === authoritativeRestoration) return
    const fit = () => {
      if (board.clientWidth === 0) return
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const scale = fitStageScale({
        actors: stageScaleActors, enemies: stageEnemyCount, width: board.clientWidth, height: board.clientHeight, rem,
        compact: matchMedia('(orientation: landscape) and (max-height: 26.25rem)').matches,
        hasSlimes: largestSlimeParty > 0, hasOrbs: stageHasOrbs, hasTallEnemy: stageHasTallEnemy,
      })
      fittedStage.current = { combatId: state.combatId, restoration: authoritativeRestoration }
      setStageLayout(previous => previous.scale === scale && previous.enemySlots === stageEnemyCount
        ? previous : { scale, enemySlots: stageEnemyCount })
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(board)
    return () => observer.disconnect()
  }, [stagePresentationBusy, stageScaleActors, stageEnemyCount, largestSlimeParty, stageHasTallEnemy, stageHasOrbs, state.combatId, authoritativeRestoration])

  useLayoutEffect(() => {
    const board = boardRef.current
    const stage = board?.querySelector('.row')
    if (!board || !stage) return
    // Transparent animation overscan can create a phantom scroll range even
    // when the entire formation fits. It must never hide the first hero's HP.
    const fitScroll = () => {
      const fits = stage.getBoundingClientRect().width <= board.clientWidth + 1
      board.style.overflow = fits ? 'clip' : 'auto hidden'
      if (fits) board.scrollLeft = 0
      else if (followViewerRow.current && board.querySelector('.slime-party')) recenterViewerRow()
    }
    fitScroll()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fitScroll)
    observer.observe(stage)
    observer.observe(board)
    return () => observer.disconnect()
  }, [state.combatId])

  // When the scale floor or foreground summons still require scrolling, keep
  // the row the player actually controls on screen.
  //
  // A layout effect, not a plain one: this must run before paint, or the board
  // is briefly drawn scrolled to the wrong row and then jumps.
  // Enemy VFX, deaths, and enemy summons must not recenter the board underneath the
  // player. Only a new combat or an explicit seat switch chooses a new view.
  useLayoutEffect(() => {
    followViewerRow.current = true
    recenterViewerRow()
  }, [viewerId, state.combatId])

  // A wider foreground party can move the viewer's seat. Keep following it
  // unless the player has deliberately scrolled to inspect another lane.
  useLayoutEffect(() => {
    if (followViewerRow.current) recenterViewerRow()
  }, [largestSlimeParty])

  useEffect(() => {
    const board = boardRef.current
    if (!board || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followViewerRow.current) recenterViewerRow()
    })
    observer.observe(board)
    return () => observer.disconnect()
  }, [viewerId])

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const inspectElsewhere = () => {
      if (
        programmaticScroll.current !== null &&
        Math.abs(board.scrollLeft - programmaticScroll.current.left) < 1 &&
        Math.abs(board.scrollTop - programmaticScroll.current.top) < 1
      ) {
        programmaticScroll.current = null
        return
      }
      programmaticScroll.current = null
      if (manualBoardScroll.current) {
        manualBoardScroll.current = false
        followViewerRow.current = false
      }
    }
    const armScroll = () => { manualBoardScroll.current = true }
    const armKeyboardScroll = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) armScroll()
    }
    const armScrollbar = (event: PointerEvent) => {
      if (event.target === board) armScroll()
    }
    const releasePointer = () => {
      cancelAnimationFrame(releaseFrame.current)
      releaseFrame.current = requestAnimationFrame(() => { manualBoardScroll.current = false })
    }
    board.addEventListener('wheel', armScroll, { passive: true })
    board.addEventListener('pointerdown', armScrollbar)
    board.addEventListener('pointerup', releasePointer)
    board.addEventListener('keydown', armKeyboardScroll)
    board.addEventListener('scroll', inspectElsewhere, { passive: true })
    return () => {
      cancelAnimationFrame(releaseFrame.current)
      board.removeEventListener('wheel', armScroll)
      board.removeEventListener('pointerdown', armScrollbar)
      board.removeEventListener('pointerup', releasePointer)
      board.removeEventListener('keydown', armKeyboardScroll)
      board.removeEventListener('scroll', inspectElsewhere)
    }
  }, [viewerId])

  // And again whenever the desktop window changes shape. The scroll position
  // is measured in pixels against the old layout.
  useEffect(() => {
    const reveal = () => {
      followViewerRow.current = true
      recenterViewerRow()
    }
    window.addEventListener('resize', reveal)
    return () => window.removeEventListener('resize', reveal)
  }, [])


  return { boardRef, combatBarRef, viewerRowRef, stageScale, stageEnemySlots, stageMotionReady, visibleEnemies, largestSlimeParty }
}


function revealViewerRow(board: HTMLElement | null, row: HTMLElement | null) {
  if (!board || !row) return
  const boardBox = board.getBoundingClientRect()
  const rowBox = row.getBoundingClientRect()
  board.scrollTop += rowBox.top - boardBox.top - (board.clientHeight - rowBox.height) / 2
  const seats = [...row.querySelectorAll<HTMLElement>('.row__seat')]
  const partySeats = [...board.querySelectorAll<HTMLElement>('.row__seat')]
    .filter((seat) => seat.querySelector('.seat'))
  const enemies = [...row.querySelectorAll<HTMLElement>('.enemy')]
  const bosses = [...board.querySelectorAll<HTMLElement>('.board__bosses .enemy:not(.enemy--dead)')]
  let actors = [...seats, ...(enemies.length > 0 ? enemies : bosses)]
  const span = (items: HTMLElement[]): [number, number] => {
    const boxes = items.map((actor) => actor.getBoundingClientRect())
    return [Math.min(...boxes.map((box) => box.left)), Math.max(...boxes.map((box) => box.right))]
  }
  const gutter = 8
  if (actors.length > 0 && seats.length > 0) {
    const [left, right] = span(actors)
    if (right - left > board.clientWidth - gutter * 2) {
      if (partySeats.length > 0) {
        const [partyLeft, partyRight] = span(partySeats)
        actors = partyRight - partyLeft <= board.clientWidth - gutter * 2 ? partySeats : seats
      } else {
        actors = seats
      }
    }
  }
  if (actors.length > 0) {
    const [left, right] = span(actors)
    const target = board.scrollLeft + left - boardBox.left - (board.clientWidth - (right - left)) / 2
    board.scrollLeft = Math.max(0, Math.min(Math.max(0, board.scrollWidth - board.clientWidth), target))
  }
}
