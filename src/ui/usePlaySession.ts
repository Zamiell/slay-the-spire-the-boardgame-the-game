import { useEffect, useRef, useState } from 'react'
import type { RunState } from '../game/run.ts'
import type { CharacterId } from '../game/types.ts'
import { playRunLog, type RunLog } from './run-log.ts'
import { ReplaySession } from './run-replay.ts'
import { parkedLiveRun, playSessionPolicy, type ParkedRun, type PlaySession } from './play-session.ts'

type Options = ParkedRun & {
  active: boolean
  open: boolean
  reducedMotion: boolean
  setRun: (run: RunState) => void
  setViewer: (viewer: string) => void
  onOpen: () => void
  onClose: () => void
  closeMenus: () => void
  pause: () => void
  report: (message: string | null) => void
}
type Runner = { log: RunLog; controller: AbortController; removeCursor?: () => void; stop?: number }

export function usePlaySession(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const [session, setSession] = useState<PlaySession>({ kind: 'live' })
  const current = useRef(session)
  const runner = useRef<Runner | null>(null)
  const [replayEpoch, setReplayEpoch] = useState(0)
  const transition = (next: PlaySession) => { current.current = next; setSession(next) }
  const stop = () => {
    const active = runner.current
    runner.current = null
    if (!active) return
    clearTimeout(active.stop)
    active.controller.abort()
    active.removeCursor?.()
  }
  const restore = () => {
    const previous = current.current
    stop()
    transition({ kind: 'live' })
    if (previous.kind !== 'live') {
      latest.current.setRun(previous.returnTo.run)
      latest.current.setViewer(previous.returnTo.viewerId)
    }
  }
  const launch = (log: RunLog, replay: ReplaySession, start?: { position: number; state: RunState }) => {
    const started: Runner = { log, controller: new AbortController() }
    runner.current = started
    replay.update({ finished: false })
    void playRunLog(log, {
      setRun: next => latest.current.setRun(next),
      setViewer: viewer => latest.current.setViewer(viewer),
      reducedMotion: latest.current.reducedMotion,
      signal: started.controller.signal,
      pause: () => latest.current.pause(),
      pace: replay, start,
      onPosition: position => replay.update({ position }),
    }).then(removeCursor => {
      if (started.controller.signal.aborted) return removeCursor()
      started.removeCursor = removeCursor
      replay.update({ finished: true, paused: false, position: replay.timeline.total })
      if (current.current.kind === 'replay' && current.current.replay === replay)
        transition({ ...current.current, finished: true })
    }).catch((error: unknown) => {
      if (started.controller.signal.aborted) return
      replay.update({ finished: true })
      latest.current.report(error instanceof Error ? error.message : 'Replay stopped.')
    })
  }
  const replayLog = session.kind === 'replay' ? session.log : null
  const replaySession = session.kind === 'replay' ? session.replay : null
  useEffect(() => {
    if (!replayLog || !replaySession || !options.active || !options.open) return
    if (runner.current?.log === replayLog) clearTimeout(runner.current.stop)
    else {
      stop()
      latest.current.report(null)
      const position = replaySession.position
      let start: { position: number; state: RunState } | undefined
      try {
        if (position > 0) start = { position, state: replaySession.timeline.stateAt(position) }
      } catch (error) {
        latest.current.report(error instanceof Error ? error.message : 'Replay position could not be restored.')
        return
      }
      launch(replayLog, replaySession, start)
    }
    return () => {
      const active = runner.current
      if (active) active.stop = window.setTimeout(() => { if (runner.current === active) stop() })
    }
  }, [options.active, options.open, replayLog, replaySession])
  useEffect(() => {
    replaySession?.timeline.index()
    return () => replaySession?.timeline.stopIndexing()
  }, [replaySession])
  return {
    ...playSessionPolicy(session, options.run.consoleModified),
    replayLog, replaySession, replayEpoch,
    replayFinished: session.kind === 'replay' && session.finished,
    tutorial: session.kind === 'tutorial' ? session.tutorial : null,
    reset() { stop(); transition({ kind: 'live' }) },
    enterTutorial(character: CharacterId, seed: string, run: RunState) {
      const previous = current.current
      const returnTo = parkedLiveRun(previous, latest.current)
      stop()
      transition({ kind: 'tutorial', returnTo, tutorial: {
        character, seed, attempt: previous.kind === 'tutorial' ? previous.tutorial.attempt + 1 : 1,
      } })
      latest.current.closeMenus()
      latest.current.setRun(run)
      latest.current.setViewer(run.players[0]!.id)
      latest.current.onOpen()
    },
    exitTutorial() { restore(); latest.current.closeMenus(); latest.current.onClose() },
    leaveReplay() { restore(); latest.current.report(null) },
    startReplay(log: RunLog) {
      const returnTo = structuredClone(parkedLiveRun(current.current, latest.current))
      stop()
      transition({ kind: 'replay', returnTo, log, replay: new ReplaySession(log), finished: false })
      latest.current.report(null)
      latest.current.closeMenus()
      latest.current.setRun(structuredClone(log.initial))
      latest.current.setViewer(log.initial.players[0]!.id)
      latest.current.onOpen()
    },
    seekReplay(position: number) {
      const currentSession = current.current
      if (currentSession.kind !== 'replay' || !runner.current) return
      const target = Math.min(Math.max(Math.trunc(position), 0), currentSession.replay.timeline.total)
      let state: RunState
      try { state = currentSession.replay.timeline.stateAt(target) } catch (error) {
        latest.current.report(error instanceof Error ? error.message : 'Replay stopped.')
        return
      }
      stop()
      transition({ ...currentSession, finished: false })
      latest.current.report(null)
      latest.current.closeMenus()
      setReplayEpoch(epoch => epoch + 1)
      launch(currentSession.log, currentSession.replay, { position: target, state })
    },
  }
}
