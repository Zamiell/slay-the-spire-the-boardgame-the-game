import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ALL_CHARACTER_IDS } from '../game/types.ts'
import type { SkinChoices } from '../skin-preference.ts'
import { SkinProvider } from './skin-context.tsx'
import { CardInspectionContext } from './card-inspection-context.ts'
import type { CardInspectionRequest } from './card-inspection-context.ts'
import { CardInspectionDialog } from './CardInspectionDialog.tsx'

export function CardInspectionProvider({ children }: { children: ReactNode }) {
  const [inspection, setInspection] = useState<(CardInspectionRequest & { skins: SkinChoices }) | null>(null)
  const open = useCallback((request: CardInspectionRequest & { skins: SkinChoices }) => setInspection(request), [])
  return <CardInspectionContext.Provider value={open}>
    {children}
    {inspection ? createPortal(<SkinProvider seats={ALL_CHARACTER_IDS.map(character => ({
      character, skin: inspection.skins[character],
    }))}>
      <CardInspectionDialog {...inspection} viewAllUpgraded={inspection.viewAllUpgraded ?? false}
        onClose={() => setInspection(null)} />
    </SkinProvider>, document.body) : null}
  </CardInspectionContext.Provider>
}
