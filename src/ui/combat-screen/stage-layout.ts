import { STAGE_GAP_REM, stageScaleFor } from '../board-signals.ts'

export type StageLayoutInput = {
  actors: number
  enemies: number
  width: number
  height: number
  rem: number
  compact: boolean
  hasSlimes: boolean
  hasOrbs: boolean
  hasTallEnemy: boolean
}

/** Painted actors scale; readable status and intent bands retain their gutters. */
export function fitStageScale({ actors, enemies, width, height, rem, compact, hasSlimes, hasOrbs, hasTallEnemy }: StageLayoutInput) {
  const widthScale = stageScaleFor(actors, width, rem, enemies)
  const heightRem = height / rem
  const heroGutter = compact ? (hasSlimes ? 12.5 : 7.5) : (hasSlimes ? 4.5 : 2.75)
  const heroFloor = hasSlimes ? (compact ? 1.25 : 7.1) : 4.1
  const heroFit = (heightRem - heroGutter - (hasOrbs ? 7 : 0)) / ((STAGE_GAP_REM - 1) * 1.2 + heroFloor)
  // Landscape CSS raises portraits above the hand by 4.75rem.
  const enemyFit = hasTallEnemy ? (heightRem - 6.6 - (compact ? 4.75 : 0)) / ((STAGE_GAP_REM - 1) * 1.6 + 5.3) : 1
  return Math.min(widthScale, Math.max(compact ? .25 : .3, Math.min(heroFit, enemyFit)))
}
