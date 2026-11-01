import { useMemo, useState } from 'react'
import { clearEventChoice, createEventDraft, initializeEventItems, reconcileEventDraft, updateEventField } from './event-draft.ts'
import type { EventDraft, EventDraftScopes, EventDraftSizes, EventFieldUpdate } from './event-draft.ts'

/** Reconcile owner/stage changes before paint; replayed UI effects cannot erase a draft. */
export function useEventDraft(scopes: EventDraftScopes, sizes: EventDraftSizes) {
  const [stored, setStored] = useState(() => createEventDraft(scopes, sizes))
  const current = reconcileEventDraft(stored, scopes, sizes)
  if (current !== stored) setStored(current)
  const scopeKey = JSON.stringify(scopes)
  const actions = useMemo(() => {
    const setter = <Key extends keyof EventDraft>(field: Key) => (update: EventFieldUpdate<Key>) =>
      setStored(previous => updateEventField(previous, scopes, field, update))
    return {
      setters: {
        cards: setter('cards'), pickerCardUids: setter('pickerCardUids'), tradeCardUid: setter('tradeCardUid'),
        relicId: setter('relicId'), potionIndexes: setter('potionIndexes'), goldPaymentSelected: setter('goldPaymentSelected'),
        potionRecipientIds: setter('potionRecipientIds'), potionReplacementIds: setter('potionReplacementIds'),
        rewardItemChoices: setter('rewardItemChoices'), targetPlayerId: setter('targetPlayerId'), roomId: setter('roomId'),
        selectedOptions: setter('selectedOptions'), rewardSources: setter('rewardSources'), rareRewardSources: setter('rareRewardSources'),
        guardianGemIds: setter('guardianGemIds'), preparedScryOrder: setter('preparedScryOrder'),
        preparedScryPicked: setter('preparedScryPicked'), rewardIndexes: setter('rewardIndexes'),
      },
      initializeItems: (choices: EventDraft['rewardItemChoices']) =>
        setStored(previous => initializeEventItems(previous, scopes, choices)),
      clearChoice: () => setStored(previous => clearEventChoice(previous, scopes)),
    }
  }, [scopeKey])
  return {
    field<Key extends keyof EventDraft>(key: Key) {
      return [current.value[key], actions.setters[key]] as const
    },
    initializeItems: actions.initializeItems,
    clearChoice: actions.clearChoice,
  }
}
