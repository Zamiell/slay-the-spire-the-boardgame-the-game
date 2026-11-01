import { useEffect, useState } from 'react'
import { assetPath } from '../game/assets.ts'
import { rulesetForCharacters } from '../game/meta.ts'
import type { RuleSet } from '../game/meta.ts'
import type { ActionOutcome, PublicSeat, VisiblePlayer } from '../multiplayer/useRoomSession.ts'
import type { CampfireDecision } from '../game/run.ts'
import { CampfireCardPicker } from './CampfireCardPicker.tsx'
import { campfireChoiceLabel, campfireOptions } from './campfire-choice.ts'
import type { CampfirePicker } from './campfire-choice.ts'
import { useRoomAction } from './actions/useRoomAction.ts'
import type { RoomActionContext } from './actions/useRoomAction.ts'
import { RoomActionStatus } from './actions/RoomActionStatus.tsx'
import type { NoncombatAction } from '../protocol/decisions.ts'
import { Icon } from './Icon.tsx'
import { CampfireScene } from './CampfireScene.tsx'
import { playerVisualId } from '../game/skins.ts'

type Decision = CampfireDecision

type Props = RoomActionContext & {
  player: VisiblePlayer
  saved?: Decision
  decided: string[]
  seats: PublicSeat[]
  onAction: (action: NoncombatAction) => Promise<ActionOutcome>
  rubyAvailable?: boolean
  restAllowed?: boolean
  ruleset?: RuleSet
  transformAvailable?: boolean
}

export function OnlineCampfireScreen({ player, saved, decided, seats, onAction, rubyAvailable = false,
  restAllowed = true, ruleset: requestedRuleset = 'base', transformAvailable = false, snapshot, refresh, onResync }: Props) {
  const [decision, setDecision] = useState<Decision | null>(saved ?? null)
  const [picker, setPicker] = useState<CampfirePicker | null>(null)
  const deck = player.deck ?? []
  const alive = seats.some((seat) => seat.playerId === player.id)
  const seatCharacters = seats.map((seat) => seat.character)
  const ruleset = rulesetForCharacters(seatCharacters, requestedRuleset)
  const locked = decided.includes(player.id)
  const visiblePlayer = { ...player, deck, campfireTransformAvailable: transformAvailable }
  const { restAvailable, needsDecision, rubyDeclineOnly, upgradable, hammer, coffee, peacePipe, straightRazor, restHeal } =
    campfireOptions(visiblePlayer, rubyAvailable, restAllowed, ruleset)
  const delivery = useRoomAction({ snapshot, refresh, onAction, onRestore: () => setDecision(saved ?? null) })
  const actionPending = delivery.busy
  const confirmDecision = (next: Decision) => {
    if (locked || delivery.locked()) return
    setDecision(next)
    setPicker(null)
    delivery.submit([{ kind: 'campfire', choices: { [player.id]: next } }])
  }

  useEffect(() => {
    if (saved) {
      setDecision(saved)
    }
  }, [locked, saved?.cardUid, saved?.choice, saved?.removeCardUid, saved?.transformCardUid])

  useEffect(() => {
    if (!alive || needsDecision || locked || delivery.locked()) return
    const timer = window.setTimeout(() => confirmDecision({ choice: 'leave' }), 250)
    return () => window.clearTimeout(timer)
  }, [actionPending, alive, locked, needsDecision])

  return (
    <section className="campfire" data-party-size={seats.length}>
      <CampfireScene visuals={seats.map(playerVisualId)} />
      <div className="campfire__prompt">
      <h2><Icon name="burn" size={26} /> Campfire <small>Rest Site</small></h2>
      {alive ? <div className="campfire__player">
        <span className="campfire__name">{player.name} · {player.hp}/{player.maxHp}</span>
        {delivery.phase === 'unknown' || delivery.phase === 'accepted'
          ? <RoomActionStatus uncertain={delivery.phase === 'unknown'} onResync={onResync} />
          : <div className="campfire__choices">
          {(locked || actionPending) && decision ? <p className="campfire__choice-status" role="status">
            {player.name} {locked ? 'chose to' : 'is confirming'} {campfireChoiceLabel(decision.choice)}.
          </p> : <>
          {!needsDecision ? <p className="campfire__choice-status" role="status">No Campfire action to resolve.</p> : null}
          <button type="button" disabled={!restAvailable} className={decision?.choice === 'rest' ? 'is-chosen' : ''} onClick={() => {
            const next: Decision = { choice: 'rest' }
            if (peacePipe || straightRazor) {
              setDecision(next)
              setPicker(peacePipe ? 'remove' : 'transform')
            } else confirmDecision(next)
          }}>
            <img src={assetPath('noncombat/campfire/rest.webp')} alt="" /><strong>Rest</strong><span className="muted">+{restHeal} HP{peacePipe ? ' · may remove a card (Peace Pipe)' : ''}{!restAllowed ? ' · blocked by Night Terrors' : coffee ? ' · blocked by Coffee Dripper' : ''}</span>
          </button>
          {rubyAvailable ? <button type="button" className={decision?.choice === 'ruby' ? 'is-chosen' : ''} onClick={() => confirmDecision({ choice: 'ruby' })}>
            ◆ Ruby Key <span className="muted">skip campfire</span>
          </button> : null}
          {rubyDeclineOnly ? <button type="button" className={decision?.choice === 'leave' ? 'is-chosen' : ''}
            onClick={() => confirmDecision({ choice: 'leave' })}>
            Leave <span className="muted">decline Ruby Key</span>
          </button> : null}
          <button type="button" disabled={hammer || upgradable.length === 0} className={decision?.choice === 'smith' ? 'is-chosen' : ''} onClick={() => {
            setDecision({ choice: 'smith' }); setPicker('upgrade')
          }}>
            <img src={assetPath('noncombat/campfire/smith.webp')} alt="" /><strong>Smith</strong><span className="muted">upgrade</span>
          </button>
          </>}
        </div>}
      </div> : <p className="campfire__spectator" role="status">Your climb has ended. You are watching the surviving party choose.</p>}
      </div>
      {alive && !locked && !actionPending && decision && picker ? <CampfireCardPicker
        deck={deck} decision={decision} picker={picker} straightRazor={straightRazor}
        onDecision={setDecision} onPicker={setPicker}
        onBack={() => { setPicker(null); setDecision(saved ?? null) }}
        onConfirm={confirmDecision}
      /> : null}
    </section>
  )
}
