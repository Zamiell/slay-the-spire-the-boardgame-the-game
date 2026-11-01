import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RunState } from '../../game/run.ts'
import { applyRunLogEvent, statePatch, normalizeRunLogChoice, runLogEventChoice,
  type RunLog, type RunLogChoice, type RunLogEvent, type ControlRef } from './codec.ts'
import { appendRunLogEvent, persistedLog, flushRunLog, startRecording, discardRecording } from './storage.ts'
import { setAssistantContext, resetRecordedHistory } from './history.ts'
import { CONTROL, INSPECTION, CANCEL_CHOICE, controlRef, gameplayControl } from './controls.ts'

export function useRunLog(run: RunState, active: boolean, viewerId: string, restoration = 0) {
  const log = useRef<RunLog | null>(null)
  const previous = useRef<RunState | null>(null)
  const pendingChoice = useRef<RunLogChoice | null>(null)
  const queuedEvents = useRef<RunLogEvent[]>([])
  const hydrationRun = useRef<string | null>(null)
  const hydrationRestoration = useRef(restoration)
  const hydrationGeneration = useRef(0)
  const [available, setAvailable] = useState(false)
  const [logReady, setLogReady] = useState(false)

  useLayoutEffect(() => {
    if (!active) return
    const runId = run.campaign.runId
    if (hydrationRun.current === runId && hydrationRestoration.current === restoration) return
    hydrationRun.current = runId
    hydrationRestoration.current = restoration
    const generation = ++hydrationGeneration.current
    const opening = structuredClone(run)
    previous.current = opening
    pendingChoice.current = null
    queuedEvents.current = []
    setLogReady(false)
    void persistedLog(runId).then((current) => {
      if (hydrationGeneration.current !== generation || hydrationRun.current !== runId) return
      log.current = current?.runId === runId ? current : null
      if (restoration > 0 && log.current) {
        // Record a checkpoint rewind before new actions, including after a page reload.
        const last = log.current.events.reduce(applyRunLogEvent, structuredClone(log.current.initial))
        const patch = statePatch(last, opening)
        if (patch.length) queuedEvents.current.unshift({ patch, viewerId })
      }
      setAvailable(Boolean(log.current?.events.length))
      setLogReady(true)
    }).catch((error: unknown) => {
      console.error('Could not restore the run log.', error)
      if (hydrationGeneration.current === generation) setAvailable(false)
    })
  }, [active, run.campaign.runId, restoration])

  useLayoutEffect(() => {
    setAssistantContext({ run, active, ready: logReady && log.current?.runId === run.campaign.runId })
    const before = previous.current ?? structuredClone(run)
    if (before.campaign.runId !== run.campaign.runId) {
      previous.current = structuredClone(run)
      pendingChoice.current = null
      return
    }
    if (!active) { previous.current = structuredClone(run); return }
    if (logReady && log.current?.runId === run.campaign.runId && queuedEvents.current.length) {
      for (const event of queuedEvents.current.splice(0)) {
        appendRunLogEvent(log.current, event)
      }
      setAvailable(log.current.events.length > 0)
    }
    if (run.campaign.finalized) { previous.current = structuredClone(run); return }
    const patch = statePatch(before, run)
    previous.current = structuredClone(run)
    if (!patch.length) return
    const choice = normalizeRunLogChoice(pendingChoice.current)
    const rawEvent = { patch, ...(choice ? { choice } : {}), viewerId }
    const recordedChoice = runLogEventChoice(rawEvent, before)
    const event = { patch, ...(recordedChoice ? { choice: recordedChoice } : {}), viewerId }
    pendingChoice.current = null
    if (!logReady || !log.current || log.current.runId !== run.campaign.runId) {
      queuedEvents.current.push(event)
      setAvailable(false)
      return
    }
    appendRunLogEvent(log.current, event)
    setAvailable(true)
  }, [active, logReady, run, viewerId])

  useLayoutEffect(() => {
    if (!active || run.campaign.finalized) return
    let down: ControlRef | null = null
    const append = (ref: ControlRef) => {
      const current = pendingChoice.current
      if (!current || ref.card) return void (pendingChoice.current = { source: ref })
      const last = current.steps?.at(-1) ?? current.source
      if (last.selector === ref.selector && last.name === ref.name) {
        pendingChoice.current = current.steps?.length
          ? { ...current, steps: [...current.steps.slice(0, -1), ref] } : { ...current, source: ref }
        return
      }
      pendingChoice.current = { source: current.source, steps: [...(current.steps ?? []), ref], ...(current.target ? { target: current.target } : {}) }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(INSPECTION)) { pendingChoice.current = null; down = null; return }
      const rawControl = event.target instanceof Element ? event.target.closest<HTMLElement>(CONTROL) : null
      if (rawControl?.closest('.pause-menu') && rawControl.textContent?.trim() !== 'Give up') { pendingChoice.current = null; down = null; return }
      const control = gameplayControl(event.target)
      down = control ? controlRef(control) : null
      if (down?.card) pendingChoice.current = null
    }
    const onPointerUp = (event: PointerEvent) => {
      const control = gameplayControl(document.elementFromPoint(event.clientX, event.clientY)) ?? gameplayControl(event.target)
      if (!down) return
      const targetRef = control ? controlRef(control) : null
      if (CANCEL_CHOICE.test(targetRef?.name ?? '')) pendingChoice.current = null
      else if (targetRef && targetRef.selector !== down.selector) {
        const staged = pendingChoice.current
        const last = staged?.steps?.at(-1) ?? staged?.source
        pendingChoice.current = last?.selector === down.selector
          ? { source: staged!.source, ...(staged!.steps ? { steps: staged!.steps } : {}), target: targetRef }
          : { source: staged?.source ?? down, ...(staged ? { steps: [...(staged.steps ?? []), down] } : {}), target: targetRef }
      } else append(down)
      down = null
    }
    const onClick = (event: MouseEvent) => {
      if (event.detail > 0 || event.target instanceof Element && event.target.closest(INSPECTION)) return
      const control = gameplayControl(event.target)
      if (!control) return
      const ref = controlRef(control)
      if (CANCEL_CHOICE.test(ref.name ?? '')) pendingChoice.current = null
      else append(ref)
    }
    const onChange = (event: Event) => { const control = gameplayControl(event.target); if (control) append(controlRef(control)) }
    const clear = () => { down = null; pendingChoice.current = null }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') pendingChoice.current = null }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', clear, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('change', onChange, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', clear, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChange, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, run.campaign.finalized, run.campaign.runId])

  const load = useCallback(async () => {
    try { await flushRunLog() } catch { return null }
    const current = log.current ?? await persistedLog(run.campaign.runId)
    return current?.runId === run.campaign.runId ? current : null
  }, [run.campaign.runId])
  const discard = useCallback(() => { discardRunLog(run.campaign.runId); log.current = null; setAvailable(false) }, [run.campaign.runId])
  return { available, discard, load }
}

export function startRunLog(run: RunState) {
  resetRecordedHistory()
  return startRecording(run)
}

export function discardRunLog(runId?: string) {
  if (discardRecording(runId)) resetRecordedHistory()
}
