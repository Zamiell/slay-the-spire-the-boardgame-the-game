import type { CSSProperties } from 'react'
import { assetPath } from '../game/assets.ts'
import type { VisualId } from '../game/skins.ts'
import { SEATING } from './campfire-seats.ts'

/**
 * The one camp painting with each hero's seated sprite placed on its logs. The scene covers the screen like
 * `background-size: cover`, and the sprites are positioned inside it, so they stay on the logs at every aspect ratio.
 */
export function CampfireScene({ visuals }: { visuals: readonly VisualId[] }) {
  const seats = SEATING[visuals.length] ?? []
  return (
    <div className="campfire__scene" aria-hidden="true">
      <img className="campfire__camp" src={assetPath('noncombat/campfire/camp.webp')} alt="" />
      {seats.map((spot, index) => (
        <img key={index} className="campfire__sitter" data-visual={visuals[index]} data-facing={spot.facing} alt=""
          src={assetPath(`noncombat/campfire/sitters/${visuals[index]}.webp`)}
          style={{ left: `${spot.x}%`, top: `${spot.y}%`, zIndex: Math.round(spot.y), '--seat-scale': spot.scale } as CSSProperties} />
      ))}
    </div>
  )
}
