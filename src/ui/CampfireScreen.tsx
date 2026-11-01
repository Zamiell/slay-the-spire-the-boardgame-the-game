import { useEffect, useState } from 'react'
import { assetPath } from '../game/assets.ts'
import { campfireNeedsDecision } from '../game/run.ts'
import type { CampfireDecision } from '../game/run.ts'
import { rulesetForCharacters } from '../game/meta.ts'
import type { RuleSet } from '../game/meta.ts'
import type { Player } from '../game/types.ts'
import { CampfireCardPicker } from './CampfireCardPicker.tsx'
import { campfireChoiceLabel, campfireOptions } from './campfire-choice.ts'
import type { CampfirePicker } from './campfire-choice.ts'
import { Icon } from './Icon.tsx'
import { CampfireScene } from './CampfireScene.tsx'
import { playerVisualId } from '../game/skins.ts'

type CampfireScreenProps = {
  players: Player[]
  onResolve: (choices: Record<string, CampfireDecision>) => void
  rubyAvailable?: boolean
  restAllowed?: boolean
  ruleset?: RuleSet
}

type Decision = CampfireDecision

/**
 * Each player picks Rest or Smith independently (p.9). Nobody moves on until
 * every living player has decided, which mirrors the table: you all leave the
 * campfire together.
 */
export function CampfireScreen({ players, onResolve, rubyAvailable = false, restAllowed = true,
  ruleset: requestedRuleset = 'base' }: CampfireScreenProps) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() => new Set())
  const [picker, setPicker] = useState<CampfirePicker | null>(null)
  const living = players.filter((player) => !player.dead)
  const ruleset = rulesetForCharacters(players.map((seat) => seat.character), requestedRuleset)
  const [focusedId, setFocusedId] = useState(living[0]?.id ?? '')
  const player = living.find((candidate) => candidate.id === focusedId) ?? living[0]
  const focusedIndex = Math.max(0, living.findIndex((candidate) => candidate.id === player?.id))
  const decision = player ? decisions[player.id] : undefined
  const confirmed = player ? confirmedIds.has(player.id) : false
  const options = player ? campfireOptions(player, rubyAvailable, restAllowed, ruleset) : null
  const requiredIds = living.filter((seat) => campfireNeedsDecision(seat, rubyAvailable, restAllowed, ruleset))
    .map((seat) => seat.id)
  useEffect(() => {
    if (requiredIds.length === 0) onResolve({})
  }, [requiredIds.length])
  const clearDecision = () => {
    if (!player) return
    setDecisions((current) => {
      const next = { ...current }
      delete next[player.id]
      return next
    })
    setConfirmedIds((current) => {
      const next = new Set(current)
      next.delete(player.id)
      return next
    })
  }
  const confirmDecision = (nextDecision: Decision) => {
    if (!player) return
    const next = { ...decisions, [player.id]: nextDecision }
    setPicker(null)
    if (requiredIds.every((id) => next[id] && (id === player.id || confirmedIds.has(id)))) {
      onResolve(next)
      return
    }
    setDecisions(next)
    setConfirmedIds((current) => new Set(current).add(player.id))
  }

  return (
    <section className="campfire" data-party-size={living.length}>
      <CampfireScene visuals={living.map(playerVisualId)} />
      <div className="campfire__prompt">
        <h2><Icon name="burn" size={26} /> Campfire <small>Rest Site</small></h2>
        {player && options ? <div className="campfire__player" role="group" aria-label={`${player.name}, ${player.hp} of ${player.maxHp} HP`}>
          <div className="campfire__name-row">
            <span className="campfire__name">{player.name} · {player.hp}/{player.maxHp} HP</span>
            {living.length > 1 ? <span className="campfire__turn-nav">
              <button type="button" aria-label={`Previous campfire player: ${living[(focusedIndex - 1 + living.length) % living.length]!.name}`}
                onClick={() => setFocusedId(living[(focusedIndex - 1 + living.length) % living.length]!.id)}>‹</button>
              <button type="button" aria-label={`Next campfire player: ${living[(focusedIndex + 1) % living.length]!.name}`}
                onClick={() => setFocusedId(living[(focusedIndex + 1) % living.length]!.id)}>›</button>
            </span> : null}
          </div>
          <div className="campfire__choices">
                {confirmed && decision ? <p className="campfire__choice-status" role="status">
                  {player.name} chose to {campfireChoiceLabel(decision.choice)}.
                </p> : <>
                {!options.needsDecision ? <p className="campfire__choice-status" role="status">No Campfire action to resolve.</p> : null}
                <button
                  type="button"
                  className={decision?.choice === 'rest' ? 'is-chosen' : ''}
                  disabled={!options.restAvailable}
                  onClick={() => {
                    const next: Decision = { choice: 'rest' }
                    if (options.peacePipe || options.straightRazor) {
                      setDecisions((current) => ({ ...current, [player.id]: next }))
                      setPicker(options.peacePipe ? 'remove' : 'transform')
                    } else confirmDecision(next)
                  }}
                >
                  <img src={assetPath('noncombat/campfire/rest.webp')} alt="" />
                  <strong>Rest</strong>
                  <span className="muted"> +{options.restHeal} HP{options.peacePipe ? ' · may remove a card (Peace Pipe)' : ''}{!restAllowed ? ' · blocked by Night Terrors' : options.coffee ? ' · blocked by Coffee Dripper' : ''}</span>
                </button>
                {rubyAvailable ? <button
                  type="button"
                  className={decision?.choice === 'ruby' ? 'is-chosen' : ''}
                  onClick={() => confirmDecision({ choice: 'ruby' })}
                >◆ Ruby Key <span className="muted">skip campfire</span></button> : null}
                {options.rubyDeclineOnly ? <button type="button" className={decision?.choice === 'leave' ? 'is-chosen' : ''}
                  onClick={() => confirmDecision({ choice: 'leave' })}>
                  Leave <span className="muted">decline Ruby Key</span>
                </button> : null}
                <button
                  type="button"
                  className={decision?.choice === 'smith' ? 'is-chosen' : ''}
                  disabled={options.hammer || options.upgradable.length === 0}
                  onClick={() => {
                    setDecisions((current) => ({ ...current, [player.id]: { choice: 'smith' } }))
                    setPicker('upgrade')
                  }}
                >
                  <img src={assetPath('noncombat/campfire/smith.webp')} alt="" />
                  <strong>Smith</strong>
                  <span className="muted"> upgrade</span>
                </button>
                </>}
          </div>
        </div> : null}
      </div>

      {player && options && decision && picker ? <CampfireCardPicker
        deck={player.deck} decision={decision} picker={picker} straightRazor={options.straightRazor}
        onDecision={next => setDecisions(current => ({ ...current, [player.id]: next }))}
        onPicker={setPicker}
        onBack={() => { setPicker(null); clearDecision() }}
        onConfirm={confirmDecision}
      /> : null}
    </section>
  )
}
