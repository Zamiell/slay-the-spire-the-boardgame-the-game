import type { RunState } from '../game/run.ts'
import type { CharacterId } from '../game/types.ts'
import type { RunLog } from './run-log.ts'
import type { ReplaySession } from './run-replay.ts'

export type ParkedRun = { run: RunState; viewerId: string }
export type TutorialSession = { character: CharacterId; seed: string; attempt: number }
export type PlaySession =
  | { kind: 'live' }
  | { kind: 'tutorial'; tutorial: TutorialSession; returnTo: ParkedRun }
  | { kind: 'replay'; log: RunLog; replay: ReplaySession; finished: boolean; returnTo: ParkedRun }

export function parkedLiveRun(session: PlaySession, current: ParkedRun): ParkedRun {
  return session.kind === 'live' ? { run: current.run, viewerId: current.viewerId } : session.returnTo
}

export function playSessionPolicy(session: PlaySession, consoleModified: boolean | undefined) {
  const persistent = session.kind === 'live'
  return { persistent, rewardsAllowed: persistent && !consoleModified }
}
