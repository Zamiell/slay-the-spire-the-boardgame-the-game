import { createContext, useCallback, useContext } from 'react'
import type { MouseEvent } from 'react'
import type { CardInstance } from '../game/types.ts'
import type { SkinChoices } from '../skin-preference.ts'
import { useCardSkins } from './skin-context.tsx'

export type CardInspectionRequest = {
  cards: readonly CardInstance[]
  initialCardUid: string
  viewAllUpgraded?: boolean
  drawLocked?: boolean
  sharedDrawLocked?: boolean
  stanceChangedThisTurn?: boolean
}

export const CardInspectionContext = createContext<(request: CardInspectionRequest & { skins: SkinChoices }) => void>(
  () => { throw new Error('Card inspection requires CardInspectionProvider') },
)

export function useInspectCard() {
  const open = useContext(CardInspectionContext)
  const skins = useCardSkins()
  return useCallback((event: Pick<MouseEvent<HTMLElement>, 'preventDefault' | 'stopPropagation' | 'currentTarget'>,
    request: CardInspectionRequest) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.closest('.card-inspection')) return
    event.currentTarget.focus({ preventScroll: true })
    open({ ...request, skins })
  }, [open, skins])
}
