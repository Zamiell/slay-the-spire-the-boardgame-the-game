import type { CSSProperties, ReactNode } from 'react'
import { assetPath } from '../game/assets.ts'

const TREASURE_ART = { width: 1509, height: 260, titleX: 754.5, titleY: 80 }

/** The writing area is distinct from decorative tails and transparent image padding. */
export function RoomBanner({ title, titleId, eyebrow, artwork, children }: {
  title: ReactNode
  titleId?: string
  eyebrow?: ReactNode
  artwork?: 'treasure'
  children?: ReactNode
}) {
  const art = artwork === 'treasure' ? TREASURE_ART : undefined
  const surface: CSSProperties | undefined = art ? {
    aspectRatio: `${art.width} / ${art.height}`,
    background: `url('${assetPath('noncombat/treasure/banner.webp')}') center / 100% 100% no-repeat`,
  } : undefined
  const writing: CSSProperties | undefined = art ? {
    position: 'absolute', left: `${art.titleX / art.width * 100}%`, top: `${art.titleY / art.height * 100}%`,
    transform: 'translate(-50%, -50%)', margin: 0, lineHeight: 1, whiteSpace: 'nowrap',
  } : undefined
  return <div className="room-banner" style={surface}>
    {eyebrow === undefined ? null : <span>{eyebrow}</span>}
    <h2 id={titleId} style={writing}>{title}</h2>
    {children}
  </div>
}
