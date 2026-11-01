import type { ReactNode } from 'react'
import type { CardInstance, Player } from '../game/types.ts'
import type { SpireMap } from '../game/map.ts'
import { assetPath } from '../game/assets.ts'
import { PlayerTitle } from './PlayerTitle.tsx'
import { IconValue } from './Icon.tsx'
import { RelicBar } from './RelicChip.tsx'
import { CardCollectionOverlay } from './CardCollectionOverlay.tsx'
import { MapOverlay } from './MapOverlay.tsx'

type HeaderPlayer = Pick<Player, 'name' | 'character' | 'hp' | 'maxHp' | 'gold' | 'relics' | 'exhaust' | 'drawLocked'>

/** Presentation only. Null/undefined deck means unknown, not an empty deck. */
export function RunHeader({ player, act, ascension, combat, die, deck, map, bossDefId,
  stanceChangedThisTurn, sharedDrawLocked, statusBefore, inventory, controls, onSettings }: {
  player?: HeaderPlayer
  act: number
  ascension: number
  combat: boolean
  die?: number
  deck?: CardInstance[] | null
  map?: SpireMap
  bossDefId?: string | null
  stanceChangedThisTurn?: boolean
  sharedDrawLocked?: boolean
  statusBefore?: ReactNode
  inventory?: ReactNode
  controls?: ReactNode
  onSettings: () => void
}) {
  return <header className="app-shell__header">
    <PlayerTitle character={player?.character} />
    <div className="run-status">
      {statusBefore}
      <span className="pip">Act {act}</span>
      {ascension > 0 ? <span className="pip">Ascension {ascension}</span> : null}
      {player ? <>
        <span className="pip pip--hp" role="img" aria-label={`Health ${player.hp} of ${player.maxHp}`}>
          {player.hp}/{player.maxHp}
        </span>
        <span className="pip" data-resource="gold"><IconValue name="gold" value={player.gold} size={20} /></span>
      </> : null}
      {inventory}
      {player ? <RelicBar relics={player.relics} label={`${player.name}'s relics`}
        exhaustCount={combat ? player.exhaust.length : undefined} die={combat ? die : undefined} /> : null}
    </div>
    {controls}
    {deck ? <CardCollectionOverlay cards={deck} label="Current deck" triggerClassName="deck-peek__open" shortcut="d" inspectable
      stanceChangedThisTurn={stanceChangedThisTurn} drawLocked={combat && player?.drawLocked}
      sharedDrawLocked={sharedDrawLocked}>
      <img src={assetPath('menu/current-deck.webp')} alt="" />
      <span aria-hidden="true">{deck.length}</span>
    </CardCollectionOverlay> : null}
    {map ? <MapOverlay map={map} act={act} bossDefId={bossDefId} /> : null}
    <button type="button" className="game-settings game-settings__summary" aria-label="Settings" onClick={onSettings}>
      <img src={assetPath('menu/settings-cog.png')} alt="" />
    </button>
  </header>
}
