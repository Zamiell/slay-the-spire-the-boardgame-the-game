import type { QuickSetupState } from '../../game/meta.ts'

export function setupStepKey(setup: Pick<QuickSetupState, 'rowIndex' | 'repeatIndex' | 'playerIndex' | 'die'> | null | undefined) {
  return setup ? `${setup.rowIndex}/${setup.repeatIndex}/${setup.playerIndex}/${setup.die?.value ?? ''}/${setup.die?.effectIndex ?? ''}` : ''
}
