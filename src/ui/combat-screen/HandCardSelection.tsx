import { useState } from 'react'
import type { ComponentProps } from 'react'
import { HandSelectionScreen } from './HandSelectionScreen.tsx'

type Props = Omit<ComponentProps<typeof HandSelectionScreen>, 'selectedUids' | 'onSelect' | 'onConfirm' | 'action'> & {
  action?: string
  initialSelected?: readonly string[]
  onConfirm: (uids: string[]) => void
}

export function HandCardSelection({ initialSelected = [], action = 'Exhaust', onConfirm, ...props }: Props) {
  const [picked, setPicked] = useState(initialSelected)
  const selected = picked.filter(uid => props.cards.some(card => card.uid === uid)).slice(0, props.maximum)
  return <HandSelectionScreen {...props} action={action} selectedUids={selected}
    onSelect={card => setPicked(selected.includes(card.uid)
      ? selected.filter(uid => uid !== card.uid)
      : [...selected, card.uid].slice(-props.maximum))}
    onConfirm={() => onConfirm(selected)} />
}
