import { cardShivsOnPlay } from './card-play-requirements.ts'
import { combatRows } from '../../game/combat/board.ts'
import type { Pending } from './types.ts'
import { cardDef, faceOf } from '../../game/cards.ts'
import { cardEnemyChoiceCount, cardNeedsEnemy, cardPlayConditionMet, cardPlayerChoiceCount, cardShivChoiceCount, effectiveCombatCardDef, guardianPowerBeamCards, lightningRowFromTarget, lightningTargetsRows, nextEvokeChoice, overflowShivCount } from '../../game/combat.ts'
import { type CombatActor, type CombatView } from '../../game/combat/view.ts'
export function reconcileCardDraft(current: Pending | null, state: CombatView, viewer: CombatActor, drawCount?: number): Pending | null {
  const alive = new Set(state.enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.uid))
  const livingPlayers = new Set(state.players.filter((player) => !player.dead).map((player) => player.id))
  if (!current) return current
  if (current.chamberPlay
    ? !viewer.chamber.some((card) => card.uid === current.card.uid)
    : current.cardInHand
      ? !viewer.hand.some((card) => card.uid === current.card.uid)
      : state.pendingCardCopy?.playerId !== viewer.id || state.pendingCardCopy.card.uid !== current.card.uid) return null
  const def = effectiveCombatCardDef(
    faceOf(cardDef(current.card.defId), current.card.upgraded), current.corruptedShardMode ?? viewer.guardianMode,
  )
  if (current.cardInHand && !cardPlayConditionMet(def, state, viewer, drawCount)) return null
  const recover = def.effects.find((effect) => effect.kind === 'recoverDiscard')
  const recoverExhaust = def.effects.find((effect) => effect.kind === 'recoverExhaust' ||
    effect.kind === 'recoverExhaustToDraw' || effect.kind === 'recoverExhaustToDiscard')
  const recoveryCards = recover ? viewer.discard : recoverExhaust ? viewer.exhaust : null
  const choice = recover
    ? viewer.discard.length > 0 ? { kind: 'recover' as const, amount: recover.amount } : null
    : recoverExhaust
      ? viewer.exhaust.length > 0
        ? {
          kind: 'recoverExhaust' as const, amount: recoverExhaust.amount,
          minimum: recoverExhaust.kind === 'recoverExhaustToDraw' ? 0 : undefined
        }
        : null
      : current.choice
  const choiceCards = recoveryCards ? (recoveryCards.length > 0 ? recoveryCards : null) : current.choiceCards
  const choiceCardsChanged = choiceCards?.length !== current.choiceCards?.length ||
    choiceCards?.some((card, index) => card.uid !== current.choiceCards?.[index]?.uid) === true
  const overflowShivs = overflowShivCount(state,
    cardShivsOnPlay(def, current.choice?.kind === 'discardAny' ? current.picked.length : 0))
  const overflowChanged = overflowShivs !== current.overflowShivs
  const spentShivs = cardShivChoiceCount(def, viewer)
  const spentChanged = spentShivs !== current.spentShivs
  const selectedMode = current.mode == null ? undefined : def.modes?.[current.mode]
  const selectedEnemyChoices = cardEnemyChoiceCount(def, current.mode ?? undefined, state, viewer)
  const mode = selectedMode?.effects.some((effect) => effect.kind === 'hitChoices' && effect.distinct) &&
    selectedEnemyChoices > alive.size ? null : current.mode
  const enemyChoices = cardEnemyChoiceCount(def, mode ?? undefined, state, viewer)
  const playerChoices = cardPlayerChoiceCount(def, mode ?? undefined)
  const enemyUid = current.enemyUid && alive.has(current.enemyUid) ? current.enemyUid : null
  const enemyUids = mode === current.mode ? current.enemyUids.filter((uid) => alive.has(uid)) : []
  const playerIds = current.playerIds.filter((id) => livingPlayers.has(id))
  const picked = choiceCards
    ? recover || recoverExhaust
      ? current.picked.filter((uid) => choiceCards.some((card) => card.uid === uid))
      : current.picked
    : current.picked.filter((uid) => viewer.hand.some((card) => card.uid === uid))
  const pickedChanged = picked.length !== current.picked.length
  const powerBeamCards = guardianPowerBeamCards(viewer, current.card.uid)
  const guardianPowerCardUid = current.guardianPowerCardUid &&
    powerBeamCards.some((card) => card.uid === current.guardianPowerCardUid)
    ? current.guardianPowerCardUid : null
  const minimumUnpaid = (current.choice?.kind === 'exhaustAny' || current.choice?.kind === 'bottomdeck') &&
    current.choiceConfirmed &&
    picked.length < Math.min(current.choice.minimum ?? 0,
      Math.max(0, viewer.hand.length - Number(current.cardInHand)))
  const shivEnemyUids = overflowChanged || spentChanged
    ? []
    : current.shivEnemyUids.filter((uid) => alive.has(uid))
  const needsEnemy = cardNeedsEnemy(def, viewer, false, current.effectEnergy ?? undefined,
    false, current.card.attachedGemId, current.card.uid,
    current.energyCharged ?? undefined, current.card.hermitDeadOn === true) || spentShivs > 0 ||
    overflowShivs > 0 || enemyChoices > 0
  const needsSwitch = def.effects.some((effect) => effect.kind === 'switchRows') && livingPlayers.size > 1
  const switchTargetAlive = current.switchPlayerId === null || livingPlayers.has(current.switchPlayerId)
  const switchPlayerId = switchTargetAlive ? current.switchPlayerId : null
  const switchChoiceDone = !needsSwitch || (current.switchChoiceDone && switchTargetAlive)
  const invalidEvokeTarget = current.evokeEnemyUids.some((target) => {
    if (typeof target !== 'string') return false
    const row = lightningRowFromTarget(target)
    return row === null
      ? !alive.has(target)
      : !lightningTargetsRows(viewer, def.id) || !combatRows(state).includes(row)
  })
  const evokeSlots = invalidEvokeTarget ? [] : current.evokeSlots
  const evokeEnemyUids = invalidEvokeTarget ? [] : current.evokeEnemyUids
  if (overflowChanged && !needsEnemy && !current.needsAlly && !needsSwitch && !current.choice &&
    !nextEvokeChoice(def, viewer, evokeSlots, state.die, current.mode ?? undefined, current.effectEnergy ?? 0) &&
    !evokeEnemyUids.some((target) => target === undefined)) return null
  if (
    overflowShivs === current.overflowShivs &&
    spentShivs === current.spentShivs &&
    enemyUid === current.enemyUid &&
    mode === current.mode &&
    enemyUids.length === current.enemyUids.length &&
    playerIds.length === current.playerIds.length &&
    choice?.kind === current.choice?.kind &&
    !choiceCardsChanged &&
    !pickedChanged &&
    guardianPowerCardUid === current.guardianPowerCardUid &&
    !minimumUnpaid &&
    shivEnemyUids.length === current.shivEnemyUids.length &&
    needsSwitch === current.needsSwitch &&
    switchPlayerId === current.switchPlayerId &&
    switchChoiceDone === current.switchChoiceDone &&
    !invalidEvokeTarget
  ) return current
  return {
    ...current,
    overflowShivs,
    spentShivs,
    mode,
    needsEnemy,
    needsSwitch,
    enemyChoices,
    playerChoices,
    enemyUid,
    enemyUids,
    playerIds,
    choice,
    choiceCards,
    picked,
    guardianPowerCardUid,
    switchPlayerId,
    switchChoiceDone,
    shivEnemyUids,
    choiceConfirmed: (pickedChanged || choiceCardsChanged || minimumUnpaid ||
      (overflowChanged && overflowShivs === 0)) &&
      (current.choice?.kind === 'discardAny' || current.choice?.kind === 'exhaustAny' ||
        current.choice?.kind === 'bottomdeck' ||
        current.choice?.kind === 'recover' || current.choice?.kind === 'recoverExhaust')
      ? false
      : current.choiceConfirmed,
    evokeSlots,
    evokeEnemyUids,
  }
}
export function restoreUnknownCardDraft(submitted: Pending, current: CombatActor, authoritative: CombatView): Pending {
  const alive = new Set(authoritative.enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.uid))
  const enemyUid = submitted.enemyUid && alive.has(submitted.enemyUid) ? submitted.enemyUid : null
  const enemyUids = submitted.enemyUids.filter((uid) => alive.has(uid))
  const slimeEnemyUids = submitted.slimeEnemyUids.filter((uid) => alive.has(uid))
  const hermitEnemyUids = submitted.hermitEnemyUids.filter((uid) => alive.has(uid))
  const soulburnEnemyUids = submitted.soulburnEnemyUids.filter((uid) => alive.has(uid))
  const shivEnemyUids = submitted.shivEnemyUids.filter((uid) => alive.has(uid))
  const choicePool = submitted.choiceCards ?? current.hand
  const picked = submitted.picked.filter((uid) => choicePool.some((card) => card.uid === uid))
  const targetChanged = enemyUid !== submitted.enemyUid || enemyUids.length !== submitted.enemyUids.length ||
    slimeEnemyUids.length !== submitted.slimeEnemyUids.length || hermitEnemyUids.length !== submitted.hermitEnemyUids.length ||
    soulburnEnemyUids.length !== submitted.soulburnEnemyUids.length || shivEnemyUids.length !== submitted.shivEnemyUids.length
  return {
    ...submitted,
    enemyUid,
    enemyUids,
    slimeEnemyUids,
    hermitEnemyUids,
    soulburnEnemyUids,
    shivEnemyUids,
    picked,
    choiceConfirmed: submitted.choiceConfirmed && picked.length === submitted.picked.length && targetChanged,
  }
}
export function cardContext(next: Pending, viewer: CombatActor, miracleOnCard: boolean) {
  const pendingDef = faceOf(cardDef(next.card.defId), next.card.upgraded)
  return {
    enemyUid: next.enemyUid,
    enemyUids: next.enemyUids,
    playerId: next.playerId ?? viewer!.id,
    energySpent: next.chamberPlay && faceOf(cardDef(next.card.defId), next.card.upgraded).cost !== 'X'
      ? undefined : next.energySpent ?? undefined,
    playerIds: next.playerIds,
    switchWithPlayerId: next.switchChoiceDone ? next.switchPlayerId : null,
    mode: next.mode ?? undefined,
    corruptedShardMode: next.corruptedShardMode ?? undefined,
    discardUids: next.choice?.kind === 'discard' || next.choice?.kind === 'discardAny'
      ? next.picked
      : undefined,
    exhaustUids: next.choice?.kind === 'exhaust' || next.choice?.kind === 'exhaustAny'
      ? next.picked
      : undefined,
    scryDiscardUids: next.choice?.kind === 'scry' || next.choice?.kind === 'scryToHand' ? next.picked : undefined,
    scryToHandUid: next.choice?.kind === 'scryToHand' ? next.scryToHandUid : undefined,
    topdeckUids: next.choice?.kind === 'topdeck' || next.choice?.kind === 'bottomdeck' ? next.picked : undefined,
    recoverDiscardUids: next.choice?.kind === 'recover' ? next.picked : undefined,
    recoverExhaustUid: next.choice?.kind === 'recoverExhaust' &&
      pendingDef?.effects.some((effect) => effect.kind === 'recoverExhaust') ? next.picked[0] : undefined,
    recoverExhaustUids: next.choice?.kind === 'recoverExhaust' &&
      pendingDef?.effects.some((effect) => effect.kind === 'recoverExhaustToDraw' ||
        effect.kind === 'recoverExhaustToDiscard') ? next.picked : undefined,
    searchDrawUids: next.choice?.kind === 'search' ? next.picked : undefined,
    loadUids: next.choice?.kind === 'load' || next.choice?.kind === 'loadAny' ? next.picked : undefined,
    chamberUids: next.chamberChoice ? next.chamberUids : undefined,
    hermitEnemyUids: next.hermitEnemyUids,
    hermitDieRelics: next.hermitDieRelicChoice ? next.hermitDieRelics : undefined,
    chooseLoadSelf: next.chooseLoadSelf === true,
    slimeUids: next.slimeChoice ? next.slimeUids : undefined,
    slimeEnemyUids: next.slimeEnemyUids,
    soulburnEnemyUids: next.soulburnChoices > 0 ? next.soulburnEnemyUids : undefined,
    spendVigor: next.spendVigor ?? undefined,
    guardianModeShift: next.guardianModeShift === true,
    secondGuardianModeShift: next.secondGuardianModeShift === true,
    guardianBlockSpend: next.guardianBlockSpend ?? undefined,
    guardianPowerCardUid: next.guardianPowerCardUid ?? undefined,
    spendMiracle: miracleOnCard,
    shivEnemyUids: next.shivEnemyUids,
    evokeSlots: next.evokeSlots,
    evokeEnemyUids: next.evokeEnemyUids as (string | null)[],
    metamorphosisPowerUid: next.metamorphosisPowerUid,
  }
}
