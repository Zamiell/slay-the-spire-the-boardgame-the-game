import { chosenDieRelicAbilities, relicDef } from '../../../src/game/relics.ts'
import { reachesEnemy } from '../../../src/game/combat/queries.ts'

// Shared by the authoritative settlement and the viewer's trigger projection.
export function deterministicDieRelicChoiceContext(combat, choice) {
  const owner = combat?.players.find((player) => player.id === choice.playerId)
  const ability = owner && chosenDieRelicAbilities(relicDef(choice.relicDefId))[choice.abilityIndex]
  if (!owner || !ability) return null
  const privateEffect = ability.effects.find((effect) =>
    effect.kind === 'discard' || effect.kind === 'exhaustFromHand')
  const required = privateEffect ? Math.min(privateEffect.amount, owner.hand.length) : 0
  if (privateEffect && (ability.optional ? required > 0 : required > 1 || required === 1 && owner.hand.length !== 1)) {
    return null
  }
  const selected = privateEffect && !ability.optional ? owner.hand.slice(0, required).map((card) => card.uid) : []
  const skipped = ability.optional && selected.length === 0
  const needsEnemy = !skipped && ability.effects.some((effect) => reachesEnemy(effect, owner))
  const living = combat.enemies.filter((enemy) => !enemy.dead)
  const enemyUid = living.some((enemy) => enemy.uid === choice.enemyUid)
    ? choice.enemyUid : living.length === 1 ? living[0].uid : null
  if (needsEnemy && !enemyUid) return null
  return {
    choiceId: choice.id,
    enemyUid,
    ...(privateEffect?.kind === 'discard' ? { discardUids: selected } : {}),
    ...(privateEffect?.kind === 'exhaustFromHand' ? { exhaustUids: selected } : {}),
  }
}

export function dieRelicChoiceNeedsInput(combat, choice) {
  return deterministicDieRelicChoiceContext(combat, choice) === null
}

export function prioritizePendingTrigger(combat, predicate) {
  const index = combat?.pendingTriggers?.findIndex(predicate) ?? -1
  if (index < 0) return undefined
  if (index === 0) return combat
  return {
    ...combat,
    pendingTriggers: [combat.pendingTriggers[index], ...combat.pendingTriggers.filter((_trigger, candidate) => candidate !== index)],
  }
}
