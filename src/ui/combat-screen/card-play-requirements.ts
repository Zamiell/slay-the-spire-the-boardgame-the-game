import type { CardDef,Effect } from '../../game/cards.ts'
import { cardDef,faceOf } from '../../game/cards.ts'
import type { CombatState } from '../../game/combat.ts'
import {
activeCardPlayWindow,
amountOf,
cardDefForTarget,
cardEnemyChoiceCount,
cardIsPlayable,
cardNeedsChoicePreview,
cardNeedsEnemy,
cardPlayerChoiceCount,
cardShivChoiceCount,
effectIsActive,
effectiveCombatCardDef,
guardianCardNeedsAlly,
guardianGemForCard,
maximumXEnergy,
overflowShivCount,
playCost,
reachedTimeWarpLimit,
slimeChoiceIsAvailable
} from '../../game/combat.ts'
import type { CardInstance,Player } from '../../game/types.ts'
import type { Pending } from './types.ts'

export function requirementsOf(
  def: CardDef,
  allies: number,
  viewer: Player,
  state: CombatState,
  energySpent?: number,
  cardInHand = true,
  sourceDeadOn = false,
  previewChoiceCount?: number,
  attachedGemId?: string,
  sourceCardUid?: string,
  energyCharged = energySpent,
): Omit<Pending, 'card' | 'cardInHand' | 'chamberPlay' | 'energySpent' | 'effectEnergy' | 'energyCharged' | 'picked' | 'enemyUid' | 'playerId' | 'switchPlayerId' | 'switchChoiceDone' | 'enemyUids' | 'playerIds' | 'shivEnemyUids' | 'evokeSlots' | 'evokeEnemyUids' | 'mode' | 'corruptedShardMode' | 'choiceCards' | 'choiceConfirmed' | 'slimeUids' | 'slimeChoiceConfirmed' | 'slimeEnemyUids' | 'chamberUids' | 'chamberChoiceConfirmed' | 'hermitEnemyUids' | 'hermitDieRelics' | 'hermitDieRelicChoiceConfirmed' | 'soulburnEnemyUids' | 'guardianPowerCardUid'> {
  const onPlayEffects = def.type === 'power' && def.resolvesOnPlay !== true ? [] : def.effects
  const selectableEffects = onPlayEffects.flatMap((effect) => effect.kind === 'deadOnEffects'
    ? sourceDeadOn ? effect.effects : []
    : [effect])
  // The same predicate the engine uses to decide whether to REFUSE the play.
  // Two copies of this list drifted apart once already: the UI would prompt for
  // an enemy and the engine would then throw the choice away. The viewer goes
  // in because a counted attack with nothing to count reaches nobody, and
  // asking where to point it is asking a question with no consequence.
  const cardTarget = cardNeedsEnemy(def, viewer, false, energySpent, false, attachedGemId, sourceCardUid,
    energyCharged, sourceDeadOn)
  const shivsGained = cardShivsOnPlay(def)
  const overflowShivs = overflowShivCount(state, shivsGained)
  const spentShivs = cardShivChoiceCount(def, viewer)
  const enemyChoices = onPlayEffects.length > 0 ? cardEnemyChoiceCount(def, undefined, state, viewer) : 0
  const playerChoices = onPlayEffects.length > 0 ? cardPlayerChoiceCount(def) : 0
  const slimeCommands = selectableEffects.some((effect) => {
    const slime = effect as unknown as { kind: string; commandAfter?: boolean }
    return slime.kind === 'commandSlime' || slime.commandAfter === true
  })
  const needsEnemy = cardTarget || slimeCommands || spentShivs > 0 || overflowShivs > 0 || enemyChoices > 0
  // With one player on the board there is nobody to choose between, so asking
  // "who gets it" is a prompt with a single possible answer.
  const needsAlly = (def.supportTarget === 'anyPlayer' || guardianCardNeedsAlly(def, viewer, attachedGemId)) && allies > 1
  const needsSwitch = onPlayEffects.some((effect) => effect.kind === 'switchRows') && allies > 1
  const discard = selectableEffects.find((effect) => effect.kind === 'discard')
  const discardAny = selectableEffects.some((effect) => effect.kind === 'discardAny')
  const exhaust = selectableEffects.find((effect) => effect.kind === 'exhaustFromHand')
  const exhaustAny = selectableEffects.find((effect) => effect.kind === 'exhaustAny')
  const topdeck = selectableEffects.find((effect) => effect.kind === 'topdeck')
  const recover = selectableEffects.find((effect) => effect.kind === 'recoverDiscard')
  const recoverExhaust = selectableEffects.find((effect) => effect.kind === 'recoverExhaust' ||
    effect.kind === 'recoverExhaustToDraw' || effect.kind === 'recoverExhaustToDiscard')
  const search = selectableEffects.find((effect) =>
    effect.kind === 'searchDraw' || effect.kind === 'searchDrawAndPlayTwice' ||
    ['overexert', 'replicateSlime'].includes((effect as { kind: string }).kind))
  const scried = selectableEffects.find((effect): effect is Extract<Effect, { kind: 'scry' }> =>
    effect.kind === 'scry' && effectIsActive(effect, state, viewer))
  const scryToHand = selectableEffects.find((effect): effect is Extract<Effect, { kind: 'scryToHand' | 'scryAndPlay' }> =>
    (effect.kind === 'scryToHand' || effect.kind === 'scryAndPlay') && effectIsActive(effect, state, viewer))
  // Slayer Pack: Forethought puts hand cards on the bottom of the draw pile.
  const bottomdeck = selectableEffects.find((effect) => effect.kind === 'bottomdeck')
  const load = selectableEffects.find((effect) => effect.kind === 'load')
  const chamberSlots = viewer.chamberSlots + selectableEffects
    .filter((effect) => effect.kind === 'gainChamberSlot')
    .reduce((sum, effect) => sum + effect.amount, 0)
  const loadPool = previewChoiceCount ?? (load?.source === 'discard'
    ? viewer.discard.length
    : Math.max(0, viewer.hand.length - Number(cardInHand)))
  const loadAmount = load ? Math.min(load.amount, loadPool) : 0
  const choice = attachedGemId === 'guardian_jasper'
    ? { kind: 'exhaustAny' as const, amount: Math.min(def.id === 'guardian_bauble_burst' ? 6 : 3,
      Math.max(0, viewer.hand.length - Number(cardInHand))), minimum: 0 }
    : discard
    ? { kind: 'discard' as const, amount: discard.amount }
    : discardAny
      ? { kind: 'discardAny' as const, amount: Math.max(0, viewer.hand.length - Number(cardInHand)) }
    : exhaust
      ? { kind: 'exhaust' as const, amount: exhaust.amount }
    : exhaustAny
      ? { kind: 'exhaustAny' as const, amount: exhaustAny.amount, minimum: exhaustAny.minimum }
      : scryToHand
        ? { kind: 'scryToHand' as const, amount: scryToHand.amount }
      : scried
        ? { kind: 'scry' as const, amount: scried.amount }
        : topdeck
          ? { kind: 'topdeck' as const, amount: topdeck.amount }
        : bottomdeck
          ? bottomdeck.amount === 'any'
            ? { kind: 'bottomdeck' as const, amount: Math.max(0, viewer.hand.length - Number(cardInHand)), minimum: 0 }
            : { kind: 'bottomdeck' as const, amount: bottomdeck.amount, minimum: bottomdeck.amount }
        : recover && viewer.discard.length > 0
          ? { kind: 'recover' as const, amount: recover.amount }
        : recoverExhaust && viewer.exhaust.length > 0
          ? { kind: 'recoverExhaust' as const, amount: recoverExhaust.amount,
            minimum: recoverExhaust.kind === 'recoverExhaustToDraw' ? 0 : undefined }
        : search
          ? { kind: 'search' as const, amount: search.kind === 'searchDraw' ? search.amount : 1 }
        : load
          ? { kind: load.upTo ? 'loadAny' as const : 'load' as const, amount: loadAmount,
            minimum: load.upTo ? 0 : loadAmount }
        : null
  const slimeEffect = selectableEffects.find((effect) => ['growSlime', 'commandSlime', 'gainSlimeVigor', 'tapSlime']
    .includes(effect.kind)) as unknown as {
      kind: 'growSlime' | 'commandSlime' | 'gainSlimeVigor' | 'tapSlime'
      amount: import('../../game/cards.ts').Amount
      upToDifferent?: number
      all?: boolean
      same?: boolean
    } | undefined
  const slimeAmount = !slimeEffect || slimeEffect.kind === 'commandSlime' && slimeEffect.all ? 0
    : slimeEffect.kind === 'commandSlime' && slimeEffect.upToDifferent === 99
      ? Math.min(viewer.slimes?.length ?? 0, amountOf(slimeEffect.amount, state, viewer, undefined,
        { enemyUid: null, playerId: viewer.id, energySpent }))
      : Math.min(viewer.slimes?.length ?? 0, slimeEffect.upToDifferent ?? 1)
  const slimeUpTo = Boolean(slimeEffect?.upToDifferent && slimeEffect.upToDifferent !== 99)
  const dieRelic = selectableEffects.find((effect) => effect.kind === 'triggerDieRelic')
  const chamberEffect = selectableEffects.find((effect) =>
    effect.kind === 'playChamber' || effect.kind === 'discardChamber' || effect.kind === 'discountChamber')
  const chamberEligible = chamberEffect?.kind === 'discardChamber' && chamberEffect.curseOnly
    ? viewer.chamber.filter((card) => faceOf(cardDef(card.defId), card.upgraded).type === 'curse')
    : viewer.chamber
  const chamberRequested = chamberEffect?.kind === 'playChamber' && chamberEffect.amount === 'all'
    ? chamberEligible.length : Number(chamberEffect?.amount ?? 0)
  const chamberAmount = chamberEffect
    ? Math.min(chamberRequested, chamberEligible.length)
    : 0
  const loadSelf = cardInHand && !sourceDeadOn && selectableEffects.some((effect) => effect.kind === 'loadSelf')
  const chamberAfterBase = viewer.chamber.length -
    (chamberEffect?.kind === 'discardChamber' ? chamberAmount : 0)
  const openAfterBase = Math.max(0, chamberSlots - chamberAfterBase)
  const replacementMax = Math.max(0, loadAmount + Number(loadSelf) - openAfterBase)
  const totalChamberChoices = chamberAmount + replacementMax
  const soulburn = selectableEffects.find((effect) => effect.kind === 'useAllSoulburn')
  const soulburnGained = soulburn ? selectableEffects.slice(0, selectableEffects.indexOf(soulburn))
    .reduce((sum, effect) => sum + (effect.kind === 'gainSoulburn' && effectIsActive(effect, state, viewer)
      ? amountOf(effect.amount, state, viewer, undefined,
        { enemyUid: null, playerId: viewer.id, energySpent }) : 0), 0) : 0
  return {
    needsEnemy,
    needsAlly,
    needsSwitch,
    overflowShivs,
    spentShivs,
    enemyChoices,
    playerChoices,
    hitsRow: def.target === 'row' || def.id === 'guardian_prismatic_barrier' && needsEnemy,
    choice,
    slimeChoice: slimeAmount > 0 ? { amount: slimeAmount, minimum: slimeUpTo ? 0 : slimeAmount } : null,
    hermitDieRelicChoice: dieRelic?.kind === 'triggerDieRelic'
      ? { amount: dieRelic.amount, minimum: dieRelic.upTo ? 0 : dieRelic.amount } : null,
    chamberChoice: totalChamberChoices > 0 ? {
      kind: chamberEffect?.kind === 'playChamber' ? 'play' : chamberEffect?.kind === 'discardChamber' ? 'discard'
        : chamberEffect?.kind === 'discountChamber' ? 'discount' : 'replace',
      amount: totalChamberChoices,
      minimum: chamberEffect?.kind === 'discardChamber' && chamberEffect.optional ? 0 : chamberAmount,
      eligibleUids: (replacementMax > 0 ? viewer.chamber : chamberEligible).map((card) => card.uid),
      ...(replacementMax > 0 ? { baseAmount: chamberAmount, openAfterBase, loadSelf } : {}),
    } : null,
    chooseLoadSelf: loadSelf && selectableEffects.some((effect) => effect.kind === 'loadSelf' && effect.optional) ? null : false,
    spendVigor: state.startTurnProgress?.forcedCard?.playerId === viewer.id &&
      viewer.guardianMode !== null && viewer.vigor > 0 &&
      (def.type === 'attack' || def.type === 'skill') ? null : 0,
    guardianModeShift: ['guardian_hack', 'guardian_gear_up', 'guardian_speed_boost'].includes(def.id) ? null : false,
    secondGuardianModeShift: def.id === 'guardian_bauble_burst' && attachedGemId === 'guardian_amethyst' ? null : false,
    guardianBlockSpend: def.id === 'guardian_body_crash' ? null : 0,
    soulburnChoices: soulburn ? Math.min(6, viewer.soulburn + soulburnGained) : 0,
  }
}

export function pendingFor(
  card: CardInstance,
  choiceCards: CardInstance[] | null,
  state: CombatState,
  viewer: Player,
  cardInHand = true,
  copiedEnergySpent?: number,
  sourceInActorHand = cardInHand,
): Pending {
  const def = effectiveCombatCardDef(faceOf(cardDef(card.defId), card.upgraded), viewer.guardianMode)
  const attachedGemId = guardianGemForCard(viewer, card)
  const shownCard = attachedGemId === card.attachedGemId ? card : { ...card, attachedGemId }
  const forced = state.startTurnProgress?.forcedCard?.playerId === viewer.id &&
    state.startTurnProgress.forcedCard.cardUid === card.uid
  const cost = forced ? 0 : playCost(def, viewer, card)
  const energySpent = copiedEnergySpent ?? (cost === 'X' ? null : 0)
  const effectEnergy = copiedEnergySpent ?? (def.cost === 'X' && cost !== 'X' ? cost : energySpent)
  const energyCharged = copiedEnergySpent === undefined
    ? (typeof cost === 'number' ? cost : null)
    : 0
  const requirements = requirementsOf(
    def, state.players.filter((player) => !player.dead).length, viewer, state, effectEnergy ?? undefined, sourceInActorHand,
    card.hermitDeadOn === true, choiceCards?.length, attachedGemId, card.uid,
    energyCharged ?? undefined,
  )
  const needsChoicePreview = choiceCards === null && cardNeedsChoicePreview(def, state, viewer)
  return {
    card: shownCard,
    cardInHand,
    chamberPlay: false,
    energySpent,
    effectEnergy,
    energyCharged,
    ...requirements,
    choice: needsChoicePreview ? null : requirements.choice,
    guardianModeShift: requirements.guardianModeShift === null || attachedGemId === 'guardian_amethyst' ? null : false,
    enemyUid: null,
    playerId: null,
    switchPlayerId: null,
    switchChoiceDone: false,
    enemyUids: [],
    playerIds: state.players.filter((player) => !player.dead).length === 1
      ? Array(requirements.playerChoices).fill(viewer.id)
      : [],
    shivEnemyUids: [],
    evokeSlots: [],
    evokeEnemyUids: [],
    mode: null,
    corruptedShardMode: null,
    choiceCards: choiceCards ?? (needsChoicePreview ? null : requirements.choice?.kind === 'recover'
      ? viewer.discard
      : requirements.choice?.kind === 'recoverExhaust' ? viewer.exhaust
        : requirements.choice?.kind === 'load' || requirements.choice?.kind === 'loadAny'
          ? (def.effects.find((effect) => effect.kind === 'load')?.source === 'discard'
            ? viewer.discard : viewer.hand.filter((held) => held.uid !== card.uid))
          : null),
    choiceConfirmed: false,
    picked: [],
    slimeUids: [],
    slimeChoiceConfirmed: false,
    slimeEnemyUids: [],
    chamberUids: [],
    chamberChoiceConfirmed: false,
    hermitEnemyUids: [],
    hermitDieRelics: [],
    hermitDieRelicChoiceConfirmed: false,
    soulburnEnemyUids: [],
    guardianPowerCardUid: null,
    scryToHandUid: undefined,
  }
}

export function gainedShivs(effects: readonly Effect[], discarded = 0): number {
  return effects.reduce((sum, effect) => sum + (effect.kind === 'gainShiv'
    ? effect.amount
    : effect.kind === 'gainShivPerDiscard' ? discarded + effect.bonus : 0), 0)
}

export function cardShivsOnPlay(def: CardDef, discarded = 0): number {
  return def.type === 'power' && def.trigger && def.resolvesOnPlay !== true
    ? 0
    : gainedShivs(def.effects, discarded)
}

export function canAfford(
  state: CombatState,
  player: Player,
  card: CardInstance,
  spendMiracle = false,
  drawCount = player.draw.length,
  sourceInHand = true,
): boolean {
  const def = effectiveCombatCardDef(faceOf(cardDef(card.defId), card.upgraded), player.guardianMode)
  if (!cardIsPlayable(def, state, player, drawCount, sourceInHand)) return false
  if (reachedTimeWarpLimit(state, player)) return false
  // Slayer Pack: An open card-play window lets its owner play only what it offers.
  // A mandatory Chamber play is the one card no window holds back.
  const playWindow = activeCardPlayWindow(state, player.id)
  if (playWindow && !playWindow.cardUids.includes(card.uid) &&
    state.pendingHermitChamberPlays?.[0]?.cardUids[0] !== card.uid) return false
  // Slayer Pack: with only Bosses left, Pressure Points can only be paid at the Boss price.
  const living = state.enemies.filter((enemy) => !enemy.dead)
  const cost = playCost(living.length > 0 && living.every((enemy) => enemy.isBoss)
    ? cardDefForTarget(def, state, living[0]!.uid) : def, player, card)
  if (spendMiracle && (cost === 'X' || cost === 0)) return false
  if (def.cost === 'X' && cost !== 'X' && cost < (def.minimumX ?? 0)) return false
  const effectEnergy = def.cost === 'X' ? cost === 'X' ? def.minimumX ?? 0 : cost : 0
  const slimeChoice = requirementsOf(
    def, state.players.filter((candidate) => !candidate.dead).length, player, state, effectEnergy,
    sourceInHand, card.hermitDeadOn === true, undefined, guardianGemForCard(player, card), card.uid,
    typeof cost === 'number' ? cost : effectEnergy,
  ).slimeChoice
  if (slimeChoice?.minimum && player.slimes.filter((slime) =>
    slimeChoiceIsAvailable(def, state, player, slime.card.uid, effectEnergy)).length < slimeChoice.minimum) return false
  return cost === 'X'
    ? maximumXEnergy(def, player) >= (def.minimumX ?? 0)
    : cost <= player.energy + (spendMiracle ? 1 : 0)
}
