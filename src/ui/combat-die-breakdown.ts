import { cardDef, faceOf } from '../game/cards.ts'
import type { Effect, TargetScope } from '../game/cards.ts'
import type { CombatState } from '../game/combat.ts'
import { dieRelicEffectsForParty } from '../game/combat/effects.ts'
import { effectiveCombatCardDef } from '../game/combat/queries.ts'
import { enemyLabel } from '../game/combat/board.ts'
import { actionsForEnemy, enemyAbilities, enemyDef } from '../game/enemies.ts'
import type { EnemyAction } from '../game/enemies.ts'
import { chosenDieRelicAbilities, manualDieRelicFaces, relicDef } from '../game/relics.ts'
import { DIE_FACES } from './die-outcomes.ts'
import type { DieFace } from './die-outcomes.ts'

export type DieBreakdownEntry = {
  id: string
  kind: 'relic' | 'power' | 'card' | 'enemy'
  name: string
  owner?: string
  relicId?: string
  effects?: readonly Effect[]
  actions?: readonly EnemyAction[]
  text?: string
  alternative?: string
  optional?: boolean
  used?: boolean
  target?: TargetScope
  supportTarget?: TargetScope
}

function dependsOnDie(effects: readonly Effect[]): boolean {
  return effects.some(effect => effect.when?.kind === 'dieShows' ||
    effect.kind === 'roulette' || effect.kind === 'channelDieOrb' ||
    (effect.kind === 'sequence' || effect.kind === 'deadOnEffects') && dependsOnDie(effect.effects) ||
    effect.kind === 'branch' && (effect.condition.kind === 'dieShows' ||
      dependsOnDie(effect.effects) || dependsOnDie(effect.otherwise)))
}

/** Resolve only die conditions; keep other conditions and target-dependent amounts as rules text. */
export function effectsForDie(effects: readonly Effect[], face: DieFace): Effect[] {
  return effects.flatMap(effect => {
    if (effect.when?.kind === 'dieShows' && !effect.when.faces.includes(face)) return []
    const active = effect.when?.kind === 'dieShows' ? { ...effect, when: undefined } : effect
    if (active.kind === 'roulette') return effectsForDie(active.byRoll[face] ?? [], face)
    if (active.kind === 'channelDieOrb') return [{
      kind: 'channel' as const, orb: face <= 2 ? 'lightning' as const : face <= 4 ? 'frost' as const : 'dark' as const,
      amount: 1, when: active.when,
    }]
    if (active.kind === 'branch') {
      if (active.condition.kind === 'dieShows') {
        return effectsForDie(active.condition.faces.includes(face) ? active.effects : active.otherwise, face)
      }
      return [{ ...active, effects: effectsForDie(active.effects, face), otherwise: effectsForDie(active.otherwise, face) }]
    }
    if (active.kind === 'sequence' || active.kind === 'deadOnEffects') {
      return [{ ...active, effects: effectsForDie(active.effects, face) }]
    }
    return [active]
  })
}

/** A public rules reference, not a simulated turn: no RNG, effects, or private piles are consumed. */
export function combatDieBreakdown(state: CombatState, viewerId: string): { face: DieFace; entries: DieBreakdownEntry[] }[] {
  const living = state.players.filter(player => !player.dead)
  const enemies = state.enemies.filter(enemy => !enemy.dead)
  const variableEnemies = enemies.filter(enemy =>
    new Set(DIE_FACES.map(face => JSON.stringify(actionsForEnemy(enemy, face)))).size > 1)
  return DIE_FACES.map(face => {
    const entries: DieBreakdownEntry[] = []
    for (const owner of living) {
      owner.relics.forEach((held, relicIndex) => {
        const def = relicDef(held.defId)
        const baseId = held.defId.replace(/^downfall_/, '')
        const manualFace = manualDieRelicFaces(held.defId)?.includes(face)
        chosenDieRelicAbilities(def).forEach((ability, index) => {
          if (ability.trigger.kind !== 'dieRelic' || !ability.trigger.faces.includes(face)) return
          entries.push({
            id: `${owner.id}/relic:${relicIndex}:${index}`, kind: 'relic', name: def.name,
            owner: owner.name, relicId: held.defId,
            effects: effectsForDie(dieRelicEffectsForParty(held.defId, ability.effects, state.players.length), face),
            target: ability.target, supportTarget: ability.supportTarget,
            optional: ability.optional, used: held.spent,
            alternative: baseId === 'loaded_die' && manualFace ? def.rule : undefined,
          })
        })
        if (manualFace && (baseId === 'dollys_mirror' || baseId === 'nilrys_codex')) {
          entries.push({
            id: `${owner.id}/relic:${relicIndex}:manual`, kind: 'relic', name: def.name,
            owner: owner.name, relicId: held.defId,
            text: baseId === 'nilrys_codex'
              ? "Trigger another relic's die-2 ability; its owner gains the effect."
              : 'Trigger a die relic ability; its owner gains the effect.',
            optional: true, used: held.spent,
          })
        }
      })
      for (const power of owner.powers) {
        const def = effectiveCombatCardDef(faceOf(cardDef(power.defId), power.upgraded), owner.guardianMode)
        const abilities = [...def.trigger ? [{ trigger: def.trigger, effects: def.effects }] : [], ...def.additionalTriggers ?? []]
        abilities.forEach((ability, index) => {
          if (ability.trigger.kind !== 'dieRelic' || !ability.trigger.faces.includes(face)) return
          entries.push({
            id: `${owner.id}/power:${power.uid}:${index}`, kind: 'power', name: def.name, owner: owner.name,
            effects: effectsForDie(ability.effects, face), target: def.target, supportTarget: def.supportTarget,
          })
        })
      }
    }
    const viewer = living.find(player => player.id === viewerId)
    const shownCards = new Set<string>()
    for (const card of viewer?.hand ?? []) {
      const def = effectiveCombatCardDef(faceOf(cardDef(card.defId), card.upgraded), viewer!.guardianMode)
      if (!dependsOnDie(def.effects) || shownCards.has(def.name)) continue
      shownCards.add(def.name)
      entries.push({
        id: `card:${card.uid}`, kind: 'card', name: def.name,
        effects: effectsForDie(def.effects, face), target: def.target, supportTarget: def.supportTarget,
      })
    }
    for (const enemy of variableEnemies) {
      entries.push({ id: `enemy:${enemy.uid}`, kind: 'enemy', name: enemyLabel(state.enemies, enemy),
        actions: actionsForEnemy(enemy, face) })
    }
    for (const enemy of enemies) {
      for (const ability of enemyAbilities(enemyDef(enemy.defId, enemy.ascension))) {
        if (ability.kind !== 'confusion') continue
        const affected = living.filter(player => player.row === enemy.row)
        if (affected.length === 0) continue
        const cost = ability.byRoll[face]
        entries.push({
          id: `confusion:${enemy.uid}`, kind: 'enemy', name: `${enemyLabel(state.enemies, enemy)}: Confusion`,
          text: cost === undefined ? 'No next-card cost override.'
            : `${affected.map(player => player.name).join(', ')}: next card costs ${cost} Energy.`,
        })
      }
    }
    return { face, entries }
  })
}
