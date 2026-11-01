import type { NeowPlayerState } from '../../game/neow.ts'

type Progress = Pick<NeowPlayerState, 'redRewardPending' | 'redReward' | 'blueOption' | 'pendingEffect' | 'rewardKind' | 'reward' | 'done'>

/** Only owner decision progress is evidence; available supplies can change for teammates. */
export function neowDecisionKey(progress: Progress | null | undefined) {
  if (!progress) return ''
  return JSON.stringify([progress.redRewardPending, progress.redReward, progress.blueOption,
    progress.pendingEffect, progress.rewardKind, progress.reward, progress.done])
}
