import { useEffect, useRef, useState } from 'react'
import { assetPath } from '../game/assets.ts'
import type { SpireMap } from '../game/map.ts'
import { MapScreen } from './MapScreen.tsx'
import { useButtonShortcut } from './useButtonShortcut.ts'

type MapOverlayProps = {
  map: SpireMap
  act: number
  /** This act's boss, rolled at setup and public to the table. */
  bossDefId?: string | null
}

/**
 * The map, read-only, over whatever screen the party is on.
 *
 * Deck-building decisions are made mid-fight — which reward to take, whether to
 * spend gold on removal — and every one of them is a decision about what is
 * still ahead. Making the party finish the fight before they could look was the
 * one piece of public information the game was withholding for no reason.
 *
 * A sibling of the screen it covers rather than a prop threaded into it: both
 * shells already have the run in scope here, and `CombatScreen` deliberately
 * takes combat state and nothing else.
 */
export function MapOverlay({ map, act, bossDefId }: MapOverlayProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const suppressedCloses = useRef(0)
  useButtonShortcut(triggerRef, 'm', !open)
  useButtonShortcut(closeRef, 'm', open)

  // Imperative `showModal`, matching every other dialog in the app: the `open`
  // attribute alone renders a non-modal dialog with no backdrop and no focus
  // trap, and Escape would not close it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) { if (!dialog.open) dialog.showModal() } else if (dialog.open) {
      suppressedCloses.current += 1
      dialog.close()
    }
  }, [open])

  return (
    <>
      <button ref={triggerRef} className="map-peek__open" type="button" aria-label="Map"
        aria-keyshortcuts="M" title="Map (M)" onClick={() => setOpen(true)}>
        <img src={assetPath('menu/map-scroll.png')} alt="" />
      </button>
      <dialog className="map-peek" ref={dialogRef}
        onClose={() => { if (suppressedCloses.current > 0) suppressedCloses.current -= 1; else setOpen(false) }}
        aria-label={`Act ${act} map`}>
        <div className="map-peek__panel">
          <header>
            <h2>Act {act}</h2>
            <button ref={closeRef} className="map-peek__close" type="button" aria-keyshortcuts="M"
              title="Close map (M)" onClick={() => setOpen(false)}>Close</button>
          </header>
          {/* `readOnly`, not `blocked`: `blocked` marks the map `inert`, which
              would kill the hover the party opened this to use. With no
              choices nothing is reachable, so nothing can be entered anyway. */}
          {open ? (
            <MapScreen map={map} choices={[]} readOnly bossDefId={bossDefId} onEnter={() => {}} />
          ) : null}
        </div>
      </dialog>
    </>
  )
}
