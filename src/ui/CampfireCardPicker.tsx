import type { CampfireDecision } from '../game/run.ts'
import type { CardInstance } from '../game/types.ts'
import { CardPicker } from './CardPicker.tsx'
import { campfireCards, campfireSelection, selectCampfireCard } from './campfire-choice.ts'
import type { CampfirePicker } from './campfire-choice.ts'

export function CampfireCardPicker({ deck, decision, picker, straightRazor, onDecision, onPicker, onBack, onConfirm }: {
  deck: readonly CardInstance[]
  decision: CampfireDecision
  picker: CampfirePicker
  straightRazor: boolean
  onDecision: (decision: CampfireDecision) => void
  onPicker: (picker: CampfirePicker) => void
  onBack: () => void
  onConfirm: (decision: CampfireDecision) => void
}) {
  const selected = campfireSelection(decision, picker)
  return <CardPicker
    cards={campfireCards(deck, picker, decision)}
    verb={picker === 'upgrade' ? 'Upgrade' : picker === 'remove' ? 'Remove' : 'Transform'}
    selectedCardUids={selected ? [selected] : []}
    onSelect={uid => onDecision(selectCampfireCard(decision, picker, uid))}
    onClear={() => onDecision(selectCampfireCard(decision, picker))}
    onBack={onBack}
    onConfirm={() => {
      if (picker === 'remove' && straightRazor) onPicker('transform')
      else onConfirm(decision)
    }}
    selectionRequired={picker === 'upgrade'}
  />
}
