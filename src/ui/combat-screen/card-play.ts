import type { CombatActor, CombatView } from '../../game/combat/view.ts'
import type { CardDef } from '../../game/cards.ts'
import { cardDef, faceOf } from '../../game/cards.ts'

import {
  cardNeedsChoicePreview, cardNeedsEnemy, cardShivChoiceCount, chosenEvokeOrbs,
  effectiveCombatCardDef, evokeTargetProgress, livingEnemies, nextEvokeChoice,
  lightningRowTarget,
  overflowShivCount, playCost, previewCardChoice, previewCardCopyChoice,
  previewCardShivTargets, previewHermitChamberCardChoice,
  slimeChoiceIsAvailable,
} from '../../game/combat.ts'
import type { CardInstance, Enemy } from '../../game/types.ts'
import type { CardInteractionMode } from './card-interaction.ts'
import { cardShivsOnPlay, pendingFor } from './card-play-requirements.ts'
import type { CombatScreenProps, Pending } from './types.ts'
import { combatActor, localCombat } from '../../game/combat/view.ts'
import type { CombatState } from '../../game/combat.ts'
import type { CombatTargetProgress } from '../../game/combat/preview-queries.ts'

import { stageChamberCard as stageHermitChamberViewer } from '../../game/combat/queries.ts'
export { stageHermitChamberViewer }

function chargedCardEnergy(def: CardDef, player: CombatActor, card: CardInstance): number | undefined {
  const cost = playCost(def, player, card)
  return typeof cost === 'number' ? cost : undefined
}
export type CardPlayResult = 'submitted' | 'choosing' | 'cancelled'
export type CardSource = 'hand' | 'chamber'
export type CardPickup = { mode: CardInteractionMode; source: CardSource; hitsRow: boolean; displayedCard: CardInstance; cost: number | 'X' }

export function singleRequiredHandCard(pending: Pending | null, viewer: CombatActor | undefined): CardInstance | undefined {
  const choice = pending?.choice
  if (!pending || !viewer || !choice ||
    (choice.kind !== 'discard' && choice.kind !== 'exhaust' && choice.kind !== 'exhaustAny')) return undefined
  const minimum = choice.kind === 'exhaustAny' ? choice.minimum ?? 0 : choice.amount
  if (minimum === 0) return undefined
  const cards = pending.choiceCards ?? viewer.hand.filter(card => !pending.cardInHand || card.uid !== pending.card.uid)
  return cards.length === 1 ? cards[0] : undefined
}

export function automaticEnemyOption(state: CombatView, options: readonly { uid: string }[]): string | undefined {
  if (options.length === 1) return options[0]!.uid
  const enemies = livingEnemies(state)
  const only = enemies.length === 1 ? enemies[0] : undefined
  return only ? options.find(option => option.uid === only.uid || option.uid === lightningRowTarget(only.row))?.uid
    : undefined
}

export function describeCardPickup(state: CombatView, viewer: CombatActor, card: CardInstance, source: CardSource): CardPickup {
  const required = state.pendingHermitChamberPlays?.[0]
  const staged = source === 'chamber' ? stageHermitChamberViewer(viewer, card,
    required?.playerId === viewer.id && required.cardUids[0] === card.uid && required.free) : { card, player: viewer }
  const next = pendingFor(staged.card, null, state, staged.player, source === 'hand', undefined, true)
  const def = effectiveCombatCardDef(faceOf(cardDef(card.defId), card.upgraded), staged.player.guardianMode)
  const enemy = cardNeedsEnemy(def, staged.player, false, next.effectEnergy ?? undefined, false,
    next.card.attachedGemId, card.uid, next.energyCharged ?? undefined, staged.card.hermitDeadOn === true) ||
    next.enemyChoices > 0 || next.spentShivs + next.overflowShivs > 0
  return {
    source, hitsRow: next.hitsRow, displayedCard: next.card, cost: next.energyCharged ?? 'X',
    mode: enemy ? 'enemy' : next.needsAlly || next.playerIds.length < next.playerChoices ? 'player' : 'self',
  }
}

type TargetQuery = (kind: 'evoke' | 'shivs', next: Pending) =>
  CombatTargetProgress | null | Promise<CombatTargetProgress | null>

type Options = {
  viewer: CombatActor
  pending: Pending | null
  miracleOnCard: boolean
  blocked: boolean
  survivorDiscard: boolean
  stateRef: { current: CombatView }
  cardActionPending: { current: boolean }
  targetQueryPending?: { current: object | null }
  setQueryBusy?: (busy: boolean) => void
  onQueryError?: (error: unknown) => void
  onAction: CombatScreenProps['onAction']
  setUsingCard: (using: boolean) => void
  setPending: (pending: Pending | null) => void
  clearOtherActions: () => void
  withAdjacentChoices: (next: Pending) => Pending
  downfallChoicesReady: (next: Pending) => boolean
  slimeEnemyChoicesRequired: (next: Pending) => number
  hermitEnemyChoicesRequired: (next: Pending) => number
  slayerTargetAffordable: (next: Pending, enemy: Enemy | undefined) => boolean
  cardContext: (next: Pending) => Parameters<typeof previewCardShivTargets>[3]
  commit: (next: Pending) => void
} & ({ state: CombatState; queryTargets?: TargetQuery } | { state: CombatView; queryTargets: TargetQuery })

/** Coordinates confirmed plays and choices; pickup never enters this flow. */
export function createCardPlayCoordinator(options: Options) {
  const { state, viewer, pending, miracleOnCard, blocked, survivorDiscard,
    stateRef, cardActionPending, onAction, setUsingCard, setPending, clearOtherActions,
    withAdjacentChoices, downfallChoicesReady, slimeEnemyChoicesRequired, hermitEnemyChoicesRequired,
    slayerTargetAffordable, cardContext, commit } = options
  const viewerId = viewer.id
  const targetQueryPending = options.targetQueryPending ?? { current: null }
  const queryTargets: TargetQuery = options.queryTargets ?? ((kind, next) => {
    if (kind === 'shivs') return previewCardShivTargets(localCombat(state), viewerId, next.card.uid, cardContext(next),
      next.chamberPlay ? 'chamber' : next.cardInHand ? 'hand' : 'copy')
    return evokeTargetProgress(faceOf(cardDef(next.card.defId), next.card.upgraded),
      localCombat(state), viewer, next.evokeSlots, next.evokeEnemyUids, next.mode ?? undefined, next.effectEnergy ?? 0)
  })

  function cancel(): CardPlayResult {
    if (targetQueryPending.current) return 'choosing'
    const forced = state.startTurnProgress?.forcedCard
    if (pending && forced?.playerId === viewerId && forced.cardUid === pending.card.uid) return 'choosing'
    if (pending?.choiceCards && pending.choice?.kind !== 'recover' && pending.choice?.kind !== 'recoverExhaust') return 'choosing'
    setPending(null)
    return 'cancelled'
  }

  function submitHermitChamber(
    card: CardInstance,
    enemyUid: string | null = null,
    targetPlayerId: string | null = null,
  ) {
    const def = faceOf(cardDef(card.defId), card.upgraded)
    const required = state.pendingHermitChamberPlays?.[0]
    const staged = stageHermitChamberViewer(viewer!, card,
      required?.playerId === viewerId && required.cardUids[0] === card.uid && required.free)
    const next = {
      ...pendingFor(staged.card, null, state, staged.player, false, undefined, true),
      chamberPlay: true,
      enemyUid,
    }
    if (cardNeedsChoicePreview(def, state, staged.player) && next.needsEnemy) {
      const pending = { ...next, choice: null, choiceCards: null }
      if (enemyUid === null) {
        setPending({ ...pending, choicePreviewPending: true })
        return 'choosing'
      }
      return stageOrCommit(pending)
    }
    return stageOrCommit(targetPlayerId
      ? next.playerChoices > 0
        ? { ...next, playerIds: [targetPlayerId] }
        : { ...next, playerId: targetPlayerId }
      : next)
  }

  function withEvokeSlot(next: Pending, slot: number): Pending {
    const def = faceOf(cardDef(next.card.defId), next.card.upgraded)
    const evokeSlots = [...next.evokeSlots, slot]
    const orbs = chosenEvokeOrbs(def, viewer!, evokeSlots, state.die,
      next.mode ?? undefined, next.effectEnergy ?? 0)
    return {
      ...next,
      evokeSlots,
      evokeEnemyUids: [...next.evokeEnemyUids, ...orbs.slice(next.evokeEnemyUids.length)
        .map((orb) => orb === 'frost' ? null : undefined)],
    }
  }

  // Local choices stay synchronous; only a room-owned calculation suspends this plan.
  function stageOrCommit(next: Pending): CardPlayResult {
    if (targetQueryPending.current) return 'choosing'
    const plan = stagePlan(next)
    let request: object | null = null
    const release = () => {
      if (!request || targetQueryPending.current !== request) return
      targetQueryPending.current = null
      options.setQueryBusy?.(false)
    }
    type Step = CombatTargetProgress | null
    const advance = (value: Step = null): CardPlayResult | Promise<CardPlayResult> => {
      for (;;) {
        const step = plan.next(value)
        if (step.done) { release(); return step.value }
        if (step.value instanceof Promise) return step.value.then(result => {
          if (stateRef.current !== state) return 'cancelled'
          return advance(result)
        })
        value = step.value
      }
    }
    const result = advance()
    if (!(result instanceof Promise)) return result
    request = {}
    targetQueryPending.current = request
    setPending(next)
    options.setQueryBusy?.(true)
    void result.catch((error: unknown) => {
      if (options.onQueryError) options.onQueryError(error)
      else if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('Could not calculate card targets.', error)
    }).finally(release)
    return 'choosing'
  }

  function* stagePlan(next: Pending): Generator<ReturnType<TargetQuery>, CardPlayResult, CombatTargetProgress | null> {
    next = withAdjacentChoices(next)
    const onlyHandCard = singleRequiredHandCard(next, viewer)
    if (onlyHandCard) next = { ...next, picked: [onlyHandCard.uid], choiceConfirmed: true }
    if (next.choiceCards?.length === 0 &&
      (next.choice?.kind === 'scry' || next.choice?.kind === 'scryToHand')) {
      next = { ...next, choiceConfirmed: true }
    }
    const def = effectiveCombatCardDef(
      faceOf(cardDef(next.card.defId), next.card.upgraded), next.corruptedShardMode ?? viewer!.guardianMode,
    )
    const selectedDef = def.modes && next.mode !== null
      ? { ...def, modes: undefined, effects: def.modes[next.mode]!.effects } : def
    const enemies = livingEnemies(state)
    const soleEnemy = enemies.length === 1 ? enemies[0] : undefined
    if (soleEnemy && (!def.modes || next.mode !== null)) {
      if (next.enemyUid === null && cardNeedsEnemy(selectedDef, viewer, false,
        next.effectEnergy ?? undefined, false, next.card.attachedGemId, next.card.uid,
        next.energyCharged ?? undefined, next.card.hermitDeadOn === true) &&
        slayerTargetAffordable(next, soleEnemy)) {
        next = withAdjacentChoices({ ...next, enemyUid: soleEnemy.uid })
      }
      if (next.enemyUids.length < next.enemyChoices &&
        !selectedDef.effects.some(effect => effect.kind === 'hitChoices' && effect.distinct && next.enemyChoices > 1)) {
        next = { ...next, enemyUids: Array<string>(next.enemyChoices).fill(soleEnemy.uid) }
      }
      const loaded = hermitEnemyChoicesRequired(next)
      if (next.hermitEnemyUids.length < loaded) next = { ...next, hermitEnemyUids: Array<string>(loaded).fill(soleEnemy.uid) }
      if (next.soulburnEnemyUids.length < next.soulburnChoices) {
        next = { ...next, soulburnEnemyUids: Array<string>(next.soulburnChoices).fill(soleEnemy.uid) }
      }
    }
    const onlySlime = viewer.slimes.length === 1 ? viewer.slimes[0] : undefined
    if (onlySlime && !next.slimeChoiceConfirmed && next.slimeChoice?.minimum === 1 &&
      next.slimeChoice.amount === 1 && (def.cost !== 'X' || next.energySpent !== null) &&
      (!def.modes || next.mode !== null) &&
      (!next.cardInHand && !next.chamberPlay ||
        state.startTurnProgress?.forcedCard?.playerId === viewerId && state.startTurnProgress.forcedCard.cardUid === next.card.uid ||
        slimeChoiceIsAvailable(def, state, viewer, onlySlime.card.uid, next.effectEnergy ?? 0))) {
      next = { ...next, slimeUids: [onlySlime.card.uid], slimeChoiceConfirmed: true }
    }
    const commandEnemies = enemies
    if (commandEnemies.length === 1 && (!next.slimeChoice || next.slimeChoiceConfirmed)) {
      const count = slimeEnemyChoicesRequired(next)
      next = { ...next, slimeEnemyUids: Array<string>(count).fill(commandEnemies[0]!.uid) }
    }
    let evokeChoice = nextEvokeChoice(def, viewer!, next.evokeSlots, state.die, next.mode ?? undefined, next.effectEnergy ?? 0)
    while (evokeChoice?.options.length === 1) {
      next = withEvokeSlot(next, evokeChoice.options[0]!.slot)
      evokeChoice = nextEvokeChoice(def, viewer!, next.evokeSlots, state.die, next.mode ?? undefined, next.effectEnergy ?? 0)
    }
    let evokeProgress = yield queryTargets('evoke', next)
    while (evokeProgress && !evokeProgress.complete && next.evokeEnemyUids[evokeProgress.index] === undefined) {
      const target = automaticEnemyOption(state, evokeProgress.options)
      if (!target) break
      const targets = [...next.evokeEnemyUids]
      targets[evokeProgress.index] = target
      next = { ...next, evokeEnemyUids: targets }
      evokeProgress = yield queryTargets('evoke', next)
    }
    if (evokeProgress?.complete && next.evokeEnemyUids.length > evokeProgress.index) {
      next = { ...next, evokeEnemyUids: next.evokeEnemyUids.slice(0, evokeProgress.index) }
    }
    const overflowShivs = overflowShivCount(state,
      cardShivsOnPlay(def, next.choice?.kind === 'discardAny' ? next.picked.length : 0))
    const spentShivs = cardShivChoiceCount(def, viewer!)
    if (overflowShivs !== next.overflowShivs || spentShivs !== next.spentShivs) {
      next = {
        ...next,
        overflowShivs,
        spentShivs,
        needsEnemy: cardNeedsEnemy(def, viewer!, false, next.effectEnergy ?? undefined, false,
          next.card.attachedGemId, next.card.uid,
          next.energyCharged ?? undefined, next.card.hermitDeadOn === true) || spentShivs > 0 ||
          overflowShivs > 0 || next.enemyChoices > 0,
        shivEnemyUids: [],
      }
      setPending(next)
    }
    while (next.shivEnemyUids.length < next.spentShivs) {
      const progress = yield queryTargets('shivs', next)
      if (!progress || progress.complete || progress.options.length !== 1) break
      next = { ...next, shivEnemyUids: [...next.shivEnemyUids, progress.options[0]!.uid] }
    }
    if (next.shivEnemyUids.length < next.spentShivs + next.overflowShivs) {
      const progress = yield queryTargets('shivs', next)
      const unusedTarget = next.shivEnemyUids.at(-1) ?? next.enemyUid ?? livingEnemies(state)[0]?.uid
      if (progress?.complete && unusedTarget) {
        next = {
          ...next, shivEnemyUids: [...next.shivEnemyUids,
          ...Array<string>(next.spentShivs + next.overflowShivs - next.shivEnemyUids.length).fill(unusedTarget)]
        }
      }
    }
    const poolSize = next.choiceCards?.length ?? Math.max(0, viewer!.hand.length - Number(next.cardInHand))
    const minimumPaid = next.picked.length >= Math.min(next.choice?.minimum ?? 0, poolSize)
    const owed = next.choice && next.choice.kind !== 'scry' &&
      next.choice.kind !== 'discardAny' && next.choice.kind !== 'exhaustAny' && next.choice.kind !== 'loadAny' &&
      next.choice.kind !== 'bottomdeck'
      ? Math.min(next.choice.amount, poolSize)
      : 0
    const selectionReady = next.choice?.kind === 'scry' || next.choice?.kind === 'scryToHand' || next.choice?.kind === 'discardAny' ||
      next.choice?.kind === 'exhaustAny' || next.choice?.kind === 'loadAny' || next.choice?.kind === 'bottomdeck' ||
      next.choice?.kind === 'recoverExhaust' && next.choice.minimum === 0 ||
      next.picked.length === owed
    const ready = selectionReady && minimumPaid && (!next.choiceCards || next.choiceConfirmed) &&
      (next.choice?.kind !== 'discardAny' && next.choice?.kind !== 'exhaustAny' && next.choice?.kind !== 'loadAny' &&
        next.choice?.kind !== 'bottomdeck' || next.choiceConfirmed) && downfallChoicesReady(next) &&
      (!def.modes || next.mode !== null) &&
      !nextEvokeChoice(def, viewer!, next.evokeSlots, state.die, next.mode ?? undefined, next.effectEnergy ?? 0) &&
      !next.evokeEnemyUids.some((target) => target === undefined) &&
      (def.cost !== 'X' || next.energySpent !== null) &&
      (def.id !== 'slayer_metamorphosis' || next.metamorphosisPowerUid !== undefined) &&
      (!cardNeedsEnemy(def.modes ? { ...def, modes: undefined, effects: def.modes[next.mode!]!.effects } : def,
        viewer!, false, next.effectEnergy ?? undefined, false,
        next.card.attachedGemId, next.card.uid,
        next.energyCharged ?? undefined, next.card.hermitDeadOn === true) || next.enemyUid !== null) &&
      next.enemyUids.length >= next.enemyChoices &&
      next.shivEnemyUids.length >= next.spentShivs + next.overflowShivs &&
      next.playerIds.length >= next.playerChoices &&
      (!next.needsAlly || next.playerId !== null) &&
      (!next.needsSwitch || next.switchChoiceDone)
    if (ready && !next.choiceCards && cardNeedsChoicePreview(def, state, viewer!)) {
      if (next.chamberPlay) requestChamberChoicePreview(next.card, next.enemyUid, next)
      else if (next.cardInHand) requestChoicePreview(next.card, next.enemyUid, next)
      else requestCopyChoicePreview(next.enemyUid, next)
    } else if (ready) {
      commit(next)
      return 'submitted'
    } else setPending(next)
    return 'choosing'
  }

  function preserveRevealedSelection(next: Pending, previous?: Pending) {
    const unchanged = previous?.choiceCards && next.choice?.kind === previous.choice?.kind &&
      next.choiceCards?.length === previous.choiceCards.length &&
      next.choiceCards.every((card, index) => card.uid === previous.choiceCards?.[index]?.uid)
    return unchanged ? {
      ...next,
      picked: previous.picked,
      choiceConfirmed: previous.choiceConfirmed,
      scryToHandUid: previous.scryToHandUid,
    } : next
  }

  function requestChoicePreview(card: CardInstance, enemyUid: string | null = null,
    selections?: Pending) {
    if (cardActionPending.current) return
    if (!onAction) {
      const preview = previewCardChoice(localCombat(state), viewer!.id, card.uid)
      if (!preview) return
      const next = preserveRevealedSelection({
        ...pendingFor(card, preview.cards, state, viewer!), enemyUid,
        slimeUids: selections?.slimeUids ?? [], slimeEnemyUids: selections?.slimeEnemyUids ?? []
      }, selections)
      if (next.choice?.kind === preview.kind) stageOrCommit(next)
      return
    }

    cardActionPending.current = true
    setUsingCard(true)
    Promise.resolve(onAction({
      kind: 'previewCard', cardUid: card.uid, spendMiracle: miracleOnCard, enemyUid,
      slimeUids: selections?.slimeUids, slimeEnemyUids: selections?.slimeEnemyUids,
    })).then((outcome) => {
      cardActionPending.current = false
      setUsingCard(false)
      const preview = outcome?.snapshot?.cardPreview
      const current = stateRef.current
      const player = combatActor(current, viewerId)
      const held = player?.hand.find((candidate) => candidate.uid === card.uid)
      if (outcome?.status !== 'accepted' || !preview || preview.cardUid !== card.uid || !player || !held) return
      const next = preserveRevealedSelection({
        ...pendingFor(held, preview.cards, current, player), enemyUid: preview.enemyUid,
        slimeUids: preview.slimeUids ?? [], slimeEnemyUids: preview.slimeEnemyUids ?? []
      }, selections)
      if (next.choice?.kind === preview.kind) stageOrCommit(next)
    }, () => {
      cardActionPending.current = false
      setUsingCard(false)
    })
  }

  function requestCopyChoicePreview(enemyUid: string | null = null,
    selections?: Pending) {
    if (cardActionPending.current || !viewer) return
    const copy = state.pendingCardCopy
    if (!copy || copy.playerId !== viewer.id) return
    if (!onAction) {
      const preview = previewCardCopyChoice(localCombat(state), viewer.id)
      if (!preview) return
      const next = preserveRevealedSelection({
        ...pendingFor(copy.card, preview.cards, state, viewer, false, copy.energySpent), enemyUid,
        slimeUids: selections?.slimeUids ?? [], slimeEnemyUids: selections?.slimeEnemyUids ?? []
      }, selections)
      if (next.choice?.kind === preview.kind) stageOrCommit(next)
      return
    }
    cardActionPending.current = true
    setUsingCard(true)
    Promise.resolve(onAction({
      kind: 'previewCardCopy', cardUid: copy.card.uid,
      copyId: copy.id, enemyUid,
      slimeUids: selections?.slimeUids, slimeEnemyUids: selections?.slimeEnemyUids
    })).then((outcome) => {
      cardActionPending.current = false
      setUsingCard(false)
      const current = stateRef.current
      const currentCopy = current.pendingCardCopy
      const player = combatActor(current, viewerId)
      const preview = outcome?.snapshot?.cardPreview
      if (outcome?.status !== 'accepted' || !preview?.copy || !currentCopy || !player) return
      const next = preserveRevealedSelection({
        ...pendingFor(currentCopy.card, preview.cards, current, player, false,
          currentCopy.energySpent), enemyUid: preview.enemyUid,
        slimeUids: preview.slimeUids ?? [], slimeEnemyUids: preview.slimeEnemyUids ?? []
      }, selections)
      if (next.choice?.kind === preview.kind) stageOrCommit(next)
    }, () => {
      cardActionPending.current = false
      setUsingCard(false)
    })
  }

  function requestChamberChoicePreview(card: CardInstance, enemyUid: string | null = null,
    selections?: Pending) {
    if (cardActionPending.current || !viewer) return
    if (!onAction) {
      const preview = previewHermitChamberCardChoice(localCombat(state), viewer.id, card.uid)
      if (!preview) return
      const required = state.pendingHermitChamberPlays?.[0]
      const staged = stageHermitChamberViewer(viewer, card,
        required?.playerId === viewer.id && required.cardUids[0] === card.uid && required.free)
      const next = preserveRevealedSelection({
        ...pendingFor(staged.card, preview.cards, state, staged.player, false, undefined, true),
        chamberPlay: true, enemyUid,
        ...(selections?.energySpent === null || selections?.energySpent === undefined ? {} : {
          energySpent: selections.energySpent, effectEnergy: selections.energySpent,
          energyCharged: selections.energySpent,
        }),
        slimeUids: selections?.slimeUids ?? [], slimeEnemyUids: selections?.slimeEnemyUids ?? []
      }, selections)
      if (next.choice?.kind === preview.kind) stageOrCommit(next)
      return
    }
    cardActionPending.current = true
    setUsingCard(true)
    Promise.resolve(onAction({
      kind: 'previewHermitChamberCard', cardUid: card.uid, enemyUid,
      energySpent: selections?.energySpent ?? undefined,
      slimeUids: selections?.slimeUids, slimeEnemyUids: selections?.slimeEnemyUids
    })).then((outcome) => {
      cardActionPending.current = false
      setUsingCard(false)
      const current = stateRef.current
      const player = combatActor(current, viewerId)
      const preview = outcome?.snapshot?.cardPreview
      const held = player?.chamber.find((candidate) => candidate.uid === card.uid)
      if (outcome?.status !== 'accepted' || !preview?.chamber || !player || !held) return
      const required = current.pendingHermitChamberPlays?.[0]
      const staged = stageHermitChamberViewer(player, held,
        required?.playerId === player.id && required.cardUids[0] === held.uid && required.free)
      const next = preserveRevealedSelection({
        ...pendingFor(staged.card, preview.cards, current, staged.player, false, undefined, true), chamberPlay: true,
        enemyUid: preview.enemyUid,
        ...(preview.energySpent === undefined ? {} : {
          energySpent: preview.energySpent,
          effectEnergy: preview.energySpent, energyCharged: preview.energySpent
        }),
        slimeUids: preview.slimeUids ?? [], slimeEnemyUids: preview.slimeEnemyUids ?? []
      }, selections)
      if (next.choice?.kind === preview.kind) stageOrCommit(next)
    }, () => {
      cardActionPending.current = false
      setUsingCard(false)
    })
  }

  function onCardClick(
    card: CardInstance,
    draggedEnemyUid: string | null = null,
    draggedPlayerId: string | null = null,
  ): CardPlayResult {
    if (cardActionPending.current || blocked) return 'cancelled'
    clearOtherActions()
    // While a card is waiting on a choice, clicks in hand pick cards for it.
    if (pending?.choice && !pending.choiceCards && card.uid !== pending.card.uid) {
      const already = pending.picked.includes(card.uid)
      const any = pending.choice.kind === 'discardAny' || pending.choice.kind === 'exhaustAny' ||
        pending.choice.kind === 'bottomdeck'
      const handChoices = Math.max(0, viewer!.hand.length - Number(pending.cardInHand))
      const need = pending.choice.kind === 'discardAny'
        ? handChoices
        : Math.min(pending.choice.amount, handChoices)
      const picked = already
        ? pending.picked.filter((uid) => uid !== card.uid)
        : [...pending.picked, card.uid].slice(-need)
      const next = { ...pending, picked, choiceConfirmed: false, chamberChoiceConfirmed: false }
      setPending(next)
      // The card may already have been dragged onto its target. Let the shared
      // readiness check commit as soon as its fixed hand cost is satisfied.
      if (!any && picked.length === need && !survivorDiscard) return stageOrCommit(next)
      return 'choosing'
    }

    // A normal staged card can be cancelled. A card that already revealed
    // hidden information is committed and must be finished.
    if (pending?.card.uid === card.uid) {
      const forced = state.startTurnProgress?.forcedCard
      if (draggedEnemyUid && forced?.playerId === viewerId && forced.cardUid === card.uid) {
        return stageOrCommit({ ...pending, enemyUid: draggedEnemyUid })
      }
      return cancel()
    }

    if (pending?.choiceCards) return 'choosing'

    // Retargeting the hand replaces an unfinished target choice; it never
    // commits the previously selected card.
    if (pending && pending.card.uid !== card.uid) setPending(null)

    const def = faceOf(cardDef(card.defId), card.upgraded)
    let next = pendingFor(card, null, state, viewer!)
    const directEnemy = cardNeedsEnemy(
      effectiveCombatCardDef(def, viewer!.guardianMode), viewer!, false, next.effectEnergy ?? undefined,
      false, next.card.attachedGemId, card.uid, chargedCardEnergy(def, viewer!, card), card.hermitDeadOn === true,
    )
    if (cardNeedsChoicePreview(def, state, viewer!)) {
      if (directEnemy || next.slimeChoice || slimeEnemyChoicesRequired(next) > 0) {
        if (draggedEnemyUid) {
          if (directEnemy) next = { ...next, enemyUid: draggedEnemyUid }
          else next = { ...next, slimeEnemyUids: [draggedEnemyUid] }
        }
        return stageOrCommit({ ...next, choice: null, choiceCards: null })
      }
      requestChoicePreview(card)
      return 'choosing'
    }
    if (draggedEnemyUid) {
      if (directEnemy) {
        if (slayerTargetAffordable(next, state.enemies.find((enemy) => enemy.uid === draggedEnemyUid))) {
          next = { ...next, enemyUid: draggedEnemyUid }
        }
      }
      else if (next.enemyChoices > 0 || def.modes) next = { ...next, enemyUids: [draggedEnemyUid] }
      else if (next.spentShivs + next.overflowShivs > 0) next = { ...next, shivEnemyUids: [draggedEnemyUid] }
    }
    if (draggedPlayerId) {
      if (next.playerChoices > 0) next = { ...next, playerIds: [draggedPlayerId] }
      else if (next.needsAlly) next = { ...next, playerId: draggedPlayerId }
    }
    return stageOrCommit(next)
  }
  return {
    withEvokeSlot, choose: stageOrCommit, requestChoicePreview, requestCopyChoicePreview, requestChamberChoicePreview,
    cancel,
    confirm: (card: CardInstance, source: CardSource, enemyUid: string | null = null, playerId: string | null = null): CardPlayResult =>
      source === 'chamber' ? submitHermitChamber(card, enemyUid, playerId) : onCardClick(card, enemyUid, playerId),
  }
}
