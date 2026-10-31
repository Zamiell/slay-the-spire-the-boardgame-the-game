import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import './styles/map-drawing.css'

type Point = readonly [number, number]
type Stroke = readonly Point[]
type Notes = Record<string, readonly Stroke[]>
const MAX_STROKES = 128
const MAX_POINTS = 4096
const EMPTY: readonly Stroke[] = []
const DrawingContext = createContext<{
  notes: Notes
  drawMode: boolean
  setDrawMode: (enabled: boolean) => void
  change: (act: number, strokes: readonly Stroke[]) => void
  message: string
  setMessage: (message: string) => void
} | null>(null)

function validNotes(value: unknown): value is Notes {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([act, strokes]) => /^[1-4]$/.test(act) &&
      Array.isArray(strokes) && strokes.length <= MAX_STROKES && strokes.every(stroke =>
        Array.isArray(stroke) && stroke.length > 0 && stroke.length <= MAX_POINTS && stroke.every(point =>
          Array.isArray(point) && point.length === 2 &&
          point.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate) <= 1000))))
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
  const [drawMode, setDrawMode] = useState(false)
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
    notes, drawMode, setDrawMode, message: storageMessage || message, setMessage,
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
  const { notes, change, drawMode, setDrawMode, message, setMessage } = useDrawing()
  const strokes = notes[act] ?? EMPTY
  return <div className="map-drawing__tools" data-run-log-control>
    <span>Right-drag to draw. Personal notes.</span>
    <button type="button" className="map-drawing__button" aria-pressed={drawMode}
      title="Draw with the left mouse button or touch instead of selecting rooms"
      onClick={() => setDrawMode(!drawMode)}>Draw</button>
    <button type="button" className="map-drawing__button" disabled={!strokes.length}
      onClick={() => { change(act, strokes.slice(0, -1)); setMessage('') }}>Undo drawing</button>
    <button type="button" className="map-drawing__button" disabled={!strokes.length}
      onClick={() => { change(act, EMPTY); setMessage('') }}>Clear drawings</button>
    {message ? <span role="status">{message}</span> : null}
  </div>
}

type Drawing = { pointerId: number; buttons: number; points: Point[] }

export function MapDrawing({ act, surfaceRef, frameRef }: {
  act: number
  surfaceRef: RefObject<HTMLDivElement | null>
  frameRef: RefObject<HTMLDivElement | null>
}) {
  const context = useDrawing()
  const latest = useRef({ ...context, act })
  latest.current = { ...context, act }
  const draft = useRef<Drawing | null>(null)
  const [live, setLive] = useState<Stroke | null>(null)
  const [geometry, setGeometry] = useState<{ width: number; step: number } | null>(null)
  useEffect(() => {
    const surface = surfaceRef.current
    const frame = frameRef.current
    if (!surface || !frame) return
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
        change(act, [...(notes[act] ?? EMPTY), drawing.points])
      }
    }
    const down = (event: PointerEvent) => {
      if (draft.current || event.button !== 2 && !(latest.current.drawMode && event.button === 0)) return
      if (surface.closest('.map--entering')) return
      const start = point(event)
      if (!start) return
      event.preventDefault()
      event.stopPropagation()
      if ((latest.current.notes[latest.current.act]?.length ?? 0) >= MAX_STROKES) {
        latest.current.setMessage('Undo or clear a drawing before adding more.')
        return
      }
      latest.current.setMessage('')
      draft.current = { pointerId: event.pointerId, buttons: event.button === 2 ? 2 : 1, points: [start] }
      surface.setPointerCapture(event.pointerId)
      surface.dataset.drawing = ''
      setLive([start])
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
      if (!paint) paint = requestAnimationFrame(() => { paint = 0; setLive(draft.current ? [...draft.current.points] : null) })
    }
    const up = (event: PointerEvent) => {
      if (draft.current?.pointerId !== event.pointerId) return
      move(event)
      event.preventDefault()
      event.stopPropagation()
      finish(true)
    }
    const cancel = () => finish(false)
    const lost = () => finish(true)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !draft.current) return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || latest.current.drawMode && event.detail > 0) {
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
  }, [frameRef, surfaceRef])
  const width = geometry ? geometry.width / geometry.step : 1
  return <svg className="map-drawing" viewBox={`${-width / 2} 0 ${width} 1`}
    preserveAspectRatio="none" aria-hidden="true">
    {geometry && [...(context.notes[act] ?? EMPTY), ...(live ? [live] : [])].map((stroke, index) =>
      <path key={index} data-draft={index === (context.notes[act]?.length ?? 0) && live ? '' : undefined}
        d={`M${stroke.map(([x, y]) => `${x},${y}`).join(' L')}${stroke.length === 1 ? ' l0,0' : ''}`}
        vectorEffect="non-scaling-stroke" />)}
  </svg>
}

export function useMapDrawMode() { return useDrawing().drawMode }
