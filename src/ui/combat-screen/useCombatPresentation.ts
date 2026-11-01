import { useMemo } from 'react'
import type { CombatState } from '../../game/combat.ts'
import { cardDef } from '../../game/cards.ts'
import { playerVisualId } from '../../game/skins.ts'
import { cardVfxRecipe, orbVfxRecipe, potionVfxRecipe, shivVfxRecipe, turnEffectVfxRecipe } from '../combat-vfx.ts'
import { usePersonalCombatSoundEffects, usePresentationEvents } from './hooks.ts'
import type { ActiveCombatVfx } from './types.ts'
import { isCharacterAttack, ORB_END_TURN_STAGGER_MS } from './vfx.tsx'

/** Audio and visual recipes consume the same restoration-aware presentation feed. */
export function useCombatPresentation(state: CombatState, restoration?: number, connected?: boolean, reducedMotion = false) {
  const live = usePresentationEvents(state, restoration, connected, reducedMotion)
  usePersonalCombatSoundEffects(state, live.soundEvents, restoration, connected, reducedMotion)
  const activeVfx = useMemo(() => {
    const resolved: ActiveCombatVfx[] = []
    for (const event of live.events) {
      if (event.kind === 'slime' || event.kind === 'card' && cardDef(event.sourceId).cardKind === 'slime') continue
      if (event.kind === 'potion') {
        resolved.push({ event, recipe: potionVfxRecipe(event.sourceId) })
        continue
      }
      const actor = state.players.find(player => player.id === event.actorId)
      if (!actor) continue
      resolved.push({ event, recipe: event.kind === 'orb'
        ? orbVfxRecipe(event.orb, event.sourceId)
        : event.kind === 'turn' ? turnEffectVfxRecipe(event.effect)
          : event.kind === 'shiv' ? shivVfxRecipe()
            : cardVfxRecipe(playerVisualId(actor), event.sourceId, event.mode, event.upgraded, event.resolvedType) })
    }
    return resolved
  }, [live.events, state.players])
  // Several passive Orbs can arrive in one snapshot; reveal them as separate beats.
  const orbEndTurnRevealDelayMs = useMemo(() => {
    const ordered = activeVfx.filter(({ event }) => event.kind === 'orb' && event.sourceId === 'orb-end-turn')
      .sort((a, b) => a.event.seq - b.event.seq)
    return new Map(ordered.map(({ event }, index) => [event.seq, index * ORB_END_TURN_STAGGER_MS]))
  }, [activeVfx])
  const characterAttacksActive = !reducedMotion && (activeVfx.some(isCharacterAttack) || live.slimeCommandsPending)
  const stageAttacksActive = characterAttacksActive ||
    activeVfx.some(({ event }) => event.kind === 'orb' && event.sourceId === 'orb-evoke' && event.orb !== 'frost')
  return { live, activeVfx, orbEndTurnRevealDelayMs, characterAttacksActive, stageAttacksActive }
}
