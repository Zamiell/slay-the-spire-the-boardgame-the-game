import { createPortal } from 'react-dom'
import { Card } from '../Card.tsx'
import type { useCardInteraction } from './useCardInteraction.ts'
import '../styles/card-interaction.css'

export function CardInteractionLayer({ interaction, damage }: {
  interaction: ReturnType<typeof useCardInteraction>
  damage?: { damage: number; baseline: number }
}) {
  const { session, flights, cardElements, arrowElement } = interaction
  return createPortal(<>{[...flights, ...(session ? [session] : [])].map((current) =>
    <div key={current.id} className="card-interaction" data-stage={current.stage}
      data-target={current.targetUid ?? undefined} aria-hidden="true" inert>
    {current.mode !== 'self' && current.stage === 'aiming' ? <svg className="card-interaction__arrow" viewBox={`0 0 ${innerWidth} ${innerHeight}`}>
      <defs><marker id="interaction-arrowhead" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20"
        refX="17" refY="10" orient="auto"><path d="M 0 0 L 20 10 L 0 20 Z" /></marker></defs>
      <path ref={arrowElement} className="card-interaction__path" />
    </svg> : null}
    <div ref={(element) => { if (element) cardElements.current.set(current.id, element); else cardElements.current.delete(current.id) }}
      className="card-interaction__card"
      style={{ width: current.width, transform: `translate3d(${current.pose.x}px, ${current.pose.y}px, 0) translate(-50%, -50%) scale(${current.pose.scale})` }}>
      <Card card={current.displayedCard} playable={false} immediateArt liveDamage={current === session ? damage : undefined} />
    </div>
  </div>)}</>, document.body)
}
