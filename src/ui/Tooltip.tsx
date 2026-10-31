import type { ComponentProps } from 'react'
import { CardKeywordHelp } from './Card.tsx'

/** Shared help without inserting a wrapper into the control's layout. */
export function Tooltip({ name, text = '', children }: {
  name: string
  text?: string
  children: ComponentProps<typeof CardKeywordHelp>['children']
}) {
  return <CardKeywordHelp hover extraTips={[{ name, text }]}>{children}</CardKeywordHelp>
}
