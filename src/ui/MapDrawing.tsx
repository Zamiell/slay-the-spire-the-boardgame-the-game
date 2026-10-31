import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import './styles/map-drawing.css'

type Point = readonly [number, number]
type Stroke = readonly Point[]
type Erasure = { erase: true; points: Stroke }
type Mark = Stroke | Erasure
type Mode = 'draw' | 'erase' | null
type Notes = Record<string, readonly Mark[]>
const MAX_STROKES = 128
const MAX_POINTS = 4096
const EMPTY: readonly Mark[] = []
const DrawingContext = createContext<{
  notes: Notes
  mode: Mode
  setMode: (mode: Mode) => void
  reset: number
  clear: (act: number) => void
  change: (act: number, strokes: readonly Mark[]) => void
  message: string
  setMessage: (message: string) => void
} | null>(null)

function validStroke(value: unknown): value is Stroke {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_POINTS && value.every(point =>
    Array.isArray(point) && point.length === 2 &&
    point.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate) <= 1000))
}

function isErasure(mark: Mark): mark is Erasure { return !Array.isArray(mark) }

function validNotes(value: unknown): value is Notes {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([act, strokes]) => /^[1-4]$/.test(act) &&
      Array.isArray(strokes) && strokes.length <= MAX_STROKES && strokes.every(mark =>
        validStroke(mark) || typeof mark === 'object' && mark !== null &&
          'erase' in mark && mark.erase === true && 'points' in mark && validStroke(mark.points)))
}

function loadNotes(key: string): { notes: Notes; message: string } {
  try {
    const saved = localStorage.getItem(key)
    if (saved === null) return { notes: {}, message: '' }
    const parsed: unknown = JSON.parse(saved)
    if (!validNotes(parsed)) throw new Error('Invalid map drawing data')
    return { notes: parsed, message: '' }
  } catch (error) {
    console.warn('Could not restore map drawings.', error)
    return { notes: {}, message: 'Saved map drawings could not be restored.' }
  }
}

export function MapDrawingProvider({ runId, children }: { runId: string; children: ReactNode }) {
  const key = `sts-map-drawings:${runId}`
  const [loaded] = useState(() => loadNotes(key))
  const [notes, setNotes] = useState(loaded.notes)
  const [message, setMessage] = useState('')
  const [storageMessage, setStorageMessage] = useState(loaded.message)
  const [mode, setMode] = useState<Mode>(null)
  const [reset, setReset] = useState(0)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) return
    try {
      localStorage.setItem(key, JSON.stringify(notes))
      setStorageMessage('')
    } catch (error) {
      console.warn('Could not save map drawings.', error)
      setStorageMessage('Drawings are available for this session, but could not be saved.')
    }
  }, [key, notes])
  return <DrawingContext.Provider value={{
    notes, mode, setMode, reset, message: storageMessage || message, setMessage,
    clear: act => {
      dirty.current = true
      setNotes(current => ({ ...current, [act]: EMPTY }))
      setMode(null)
      setReset(current => current + 1)
      setMessage('')
    },
    change: (act, strokes) => {
      dirty.current = true
      setNotes(current => ({ ...current, [act]: strokes }))
    },
  }}>{children}</DrawingContext.Provider>
}

function useDrawing() {
  const context = useContext(DrawingContext)
  if (!context) throw new Error('Map drawings require MapDrawingProvider')
  return context
}

export function MapDrawingTools({ act }: { act: number }) {
  const { mode, setMode, clear, message } = useDrawing()
  const tools = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const [tip, setTip] = useState<keyof typeof TOOLS | null>(null)
  useLayoutEffect(() => {
    const element = tools.current
    const map = element?.closest('.map')
    if (!element || !map) return
    const measure = () => {
      const box = map.getBoundingClientRect()
      if (!box.width || !box.height) { setMode(null); return }
      // Keep the reference proportions without shrinking phone targets below 45px.
      const unit = Math.max(0.75, Math.min(innerWidth / 1920, innerHeight / 1080, 1))
      element.style.setProperty('--map-tool-unit', `${unit}px`)
      element.style.left = `${Math.max(0, box.left) + 56 * unit}px`
      element.style.top = `${Math.min(innerHeight, box.bottom) - 108 * unit}px`
    }
    const observer = new ResizeObserver(measure)
    observer.observe(map)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [setMode])
  return <div ref={tools} className="map-drawing__tools" role="group" aria-label="Map drawing tools" data-run-log-control>
    {(['draw', 'erase', 'clear'] as const).map(tool => <button key={tool} type="button"
      className="map-drawing__button" data-tool={tool} aria-label={TOOLS[tool].label}
      aria-pressed={tool === 'clear' ? undefined : mode === tool}
      aria-describedby={tip === tool ? tooltipId : undefined}
      onMouseEnter={() => setTip(tool)} onMouseLeave={() => setTip(null)}
      onFocus={() => setTip(tool)} onBlur={() => setTip(null)}
      onClick={() => {
        setTip(null)
        if (tool === 'clear') clear(act)
        else setMode(mode === tool ? null : tool)
      }}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d={TOOLS[tool].path} /></svg>
    </button>)}
    {tip ? <div id={tooltipId} className="map-drawing__tip relic-tip" role="tooltip">
      <strong className="relic-tip__name">{TOOLS[tip].title}</strong>
      <span className="relic-tip__text">{TOOLS[tip].description}</span>
    </div> : null}
    {message ? <span className="map-drawing__message" role="status">{message}</span> : null}
  </div>
}

const TOOLS = {
  draw: {
    label: 'Draw', title: 'Map Drawing (Right-Click)', description: 'Draw on the map. Select the quill to draw with left-drag or touch.',
    path: 'M10 56C19 36 27 16 54 8C54 31 42 43 23 43M10 56L40 25M20 39V30M27 32H38',
  },
  erase: {
    label: 'Erase', title: 'Map Erasing (Middle-Click)', description: 'Erase your drawings. Select the eraser to erase with left-drag or touch.',
    path: 'M11 39L35 13Q38 10 41 13L55 26Q58 29 55 32L30 57H24ZM22 27L44 46M40 57H56',
  },
  clear: {
    label: 'Clear drawings', title: 'Clear Drawings', description: 'Remove all your drawings from this act.',
    path: 'M38 27L52 9Q54 7 57 10L59 12Q61 14 59 16L44 33M15 30L34 23L47 36L31 55Q19 50 10 38ZM15 35L29 32M20 42L35 37M26 48L41 42M13 9L15 14L20 16L15 18L13 23L11 18L6 16L11 14Z',
  },
}

function toolCursor(mode: Exclude<Mode, null>, pressed = false): string {
  const tilt = pressed ? `rotate(-10 ${mode === 'draw' ? 10 : 24} 56)` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 64 64"><g transform="${tilt}"><path d="${TOOLS[mode].path}" fill="none" stroke="#151515" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="${TOOLS[mode].path}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${mode === 'draw' ? '5 28' : '12 28'}, crosshair`
}

type Drawing = { pointerId: number; buttons: number; erase: boolean; points: Point[] }
function asMark(points: Stroke, erase: boolean): Mark { return erase ? { erase: true, points } : points }
function pathData(points: Stroke) {
  return `M${points.map(([x, y]) => `${x},${y}`).join(' L')}${points.length === 1 ? ' l0,0' : ''}`
}

export function MapDrawing({ act, surfaceRef, frameRef }: {
  act: number
  surfaceRef: RefObject<HTMLDivElement | null>
  frameRef: RefObject<HTMLDivElement | null>
}) {
  const context = useDrawing()
  const latest = useRef({ ...context, act })
  latest.current = { ...context, act }
  const draft = useRef<Drawing | null>(null)
  const [live, setLive] = useState<Mark | null>(null)
  const maskId = useId()
  const [geometry, setGeometry] = useState<{ width: number; step: number } | null>(null)
  useEffect(() => {
    const surface = surfaceRef.current
    const frame = frameRef.current
    if (!surface || !frame) return
    setLive(null)
    for (const mode of ['draw', 'erase'] as const) {
      surface.style.setProperty(`--map-${mode}-cursor`, toolCursor(mode))
      surface.style.setProperty(`--map-${mode}-cursor-active`, toolCursor(mode, true))
    }
    let paint = 0
    const layout = () => {
      const row = frame.querySelector<HTMLElement>('.map__row:not(:first-child)')
      const node = row?.querySelector<HTMLElement>('.room')
      if (!row || !node || !frame.offsetWidth) return null
      const box = frame.getBoundingClientRect()
      const scale = box.width / frame.offsetWidth
      // Horizontal marks use room-spacing units, not screen percentages, so
      // a circle stays around its room in both the map and the narrower peek.
      const step = (node.offsetWidth + parseFloat(getComputedStyle(row).columnGap)) * scale
      return step > 0 && box.height > 0 ? { box, step } : null
    }
    const measure = () => {
      const measured = layout()
      if (measured) setGeometry({ width: surface.getBoundingClientRect().width, step: measured.step })
    }
    const point = (event: PointerEvent): Point | null => {
      const measured = layout()
      if (!measured) return null
      const { box, step } = measured
      return [Math.round((event.clientX - box.left - box.width / 2) / step * 1000) / 1000,
        Math.round((event.clientY - box.top) / box.height * 100000) / 100000]
    }
    const finish = (save: boolean) => {
      const drawing = draft.current
      if (!drawing) return
      draft.current = null
      cancelAnimationFrame(paint)
      paint = 0
      setLive(null)
      delete surface.dataset.drawing
      if (surface.hasPointerCapture(drawing.pointerId)) surface.releasePointerCapture(drawing.pointerId)
      if (save) {
        const { notes, change, act } = latest.current
        change(act, [...(notes[act] ?? EMPTY), asMark(drawing.points, drawing.erase)])
      }
    }
    const down = (event: PointerEvent) => {
      if (latest.current.mode && (event.button === 1 || event.button === 2)) {
        event.preventDefault()
        event.stopPropagation()
        finish(true)
        latest.current.setMode(null)
        return
      }
      if (draft.current || event.button !== 2 && event.button !== 1 && !(latest.current.mode && event.button === 0)) return
      if (surface.closest('.map--entering')) return
      const start = point(event)
      if (!start) return
      event.preventDefault()
      event.stopPropagation()
      if ((latest.current.notes[latest.current.act]?.length ?? 0) >= MAX_STROKES) {
        latest.current.setMessage('Clear drawings before adding more marks.')
        return
      }
      latest.current.setMessage('')
      const erase = event.button === 1 || event.button === 0 && latest.current.mode === 'erase'
      draft.current = { pointerId: event.pointerId, buttons: event.button === 2 ? 2 : event.button === 1 ? 4 : 1,
        erase, points: [start] }
      surface.setPointerCapture(event.pointerId)
      surface.dataset.drawing = erase ? 'erase' : 'draw'
      setLive(asMark([start], erase))
    }
    const move = (event: PointerEvent) => {
      const drawing = draft.current
      if (!drawing || drawing.pointerId !== event.pointerId) return
      if (!(event.buttons & drawing.buttons)) return finish(true)
      event.preventDefault()
      event.stopPropagation()
      const next = point(event)
      if (!next) return
      const previous = drawing.points.at(-1)!
      const box = frame.getBoundingClientRect()
      if (Math.hypot((next[0] - previous[0]) * 100, (next[1] - previous[1]) * box.height) < 1.5) return
      if (drawing.points.length >= MAX_POINTS) {
        latest.current.setMessage('Stroke limit reached. Release the pointer to start another stroke.')
        return finish(true)
      }
      drawing.points.push(next)
      if (!paint) paint = requestAnimationFrame(() => {
        paint = 0
        setLive(draft.current ? asMark([...draft.current.points], draft.current.erase) : null)
      })
    }
    const up = (event: PointerEvent) => {
      if (draft.current?.pointerId !== event.pointerId) return
      if (event.buttons & draft.current.buttons) return
      move(event)
      event.preventDefault()
      event.stopPropagation()
      finish(true)
    }
    const cancel = () => finish(false)
    const lost = () => finish(true)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !draft.current && !latest.current.mode) return
      event.preventDefault()
      event.stopPropagation()
      cancel()
      latest.current.setMode(null)
    }
    const click = (event: MouseEvent) => {
      if (event.type === 'contextmenu' || event.button !== 0 || latest.current.mode && event.detail > 0) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    measure()
    surface.addEventListener('pointerdown', down, true)
    surface.addEventListener('pointermove', move, true)
    surface.addEventListener('pointerup', up, true)
    surface.addEventListener('pointercancel', cancel)
    surface.addEventListener('lostpointercapture', lost)
    surface.addEventListener('click', click, true)
    surface.addEventListener('contextmenu', click)
    surface.addEventListener('auxclick', click)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('blur', lost)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(paint)
      observer.disconnect()
      const drawing = draft.current
      draft.current = null
      delete surface.dataset.drawing
      if (drawing && surface.hasPointerCapture(drawing.pointerId)) surface.releasePointerCapture(drawing.pointerId)
      surface.removeEventListener('pointerdown', down, true)
      surface.removeEventListener('pointermove', move, true)
      surface.removeEventListener('pointerup', up, true)
      surface.removeEventListener('pointercancel', cancel)
      surface.removeEventListener('lostpointercapture', lost)
      surface.removeEventListener('click', click, true)
      surface.removeEventListener('contextmenu', click)
      surface.removeEventListener('auxclick', click)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', lost)
      window.removeEventListener('resize', measure)
    }
  }, [frameRef, surfaceRef, context.mode, context.reset])
  useEffect(() => () => latest.current.setMode(null), [])
  const width = geometry ? geometry.width / geometry.step : 1
  const masks: ReactNode[] = []
  let ink: ReactNode[] = []
  if (geometry) for (const [index, mark] of [...(context.notes[act] ?? EMPTY), ...(live ? [live] : [])].entries()) {
    const drawing = index === (context.notes[act]?.length ?? 0) && live ? '' : undefined
    if (isErasure(mark)) {
      const id = `${maskId}-${index}`
      masks.push(<mask key={id} id={id} maskUnits="userSpaceOnUse" x={-width / 2} y={0} width={width} height={1}>
        <rect x={-width / 2} y={0} width={width} height={1} fill="white" />
        <path className="map-drawing__eraser" d={pathData(mark.points)} vectorEffect="non-scaling-stroke" />
      </mask>)
      // Erasures affect earlier ink only; later strokes can draw over them.
      ink = [<g key={id} mask={`url(#${id})`} data-erasure={drawing === undefined ? '' : undefined}
        data-draft={drawing}>{ink}</g>]
    } else ink.push(<path key={index} className="map-drawing__ink" data-draft={drawing}
      d={pathData(mark)} vectorEffect="non-scaling-stroke" />)
  }
  return <svg className="map-drawing" viewBox={`${-width / 2} 0 ${width} 1`}
    preserveAspectRatio="none" aria-hidden="true">
    <defs>{masks}</defs>
    {ink}
  </svg>
}

export function useMapDrawMode() { return useDrawing().mode }
