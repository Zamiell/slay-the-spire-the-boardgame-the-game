import { cardSubmissionCommitted } from './action-evidence.ts'
import { useActionLifecycle } from '../actions/useActionLifecycle.ts'
import { createCardPlayCoordinator, stageHermitChamberViewer } from './card-play.ts'
import { cardShivsOnPlay, pendingFor } from './card-play-requirements.ts'
import type { CombatScreenProps, Pending, CardSubmission } from './types.ts'
import { cardDef, faceOf } from '../../game/cards.ts'
import { cardEnemyChoiceCount, cardNeedsChoicePreview, cardNeedsEnemy, cardPlayerChoiceCount, cardShivChoiceCount, chosenEvokeOrbs, effectiveCombatCardDef, guardianCardNeedsAlly, livingEnemies, nextEvokeChoice, overflowShivCount, playCard, playCardCopy, playHermitChamberCard, playCost } from '../../game/combat.ts'
import type { CardInstance } from '../../game/types.ts'
import { combatActor, localCombat, type CombatActor, type CombatPlayerView, type CombatView } from '../../game/combat/view.ts'
import { useCombatQueries } from './useCombatQueries.ts'
import type { CombatQuery, CombatQueryResult, CombatTargetProgress } from '../../game/combat/preview-queries.ts'
import type { ActionOutcome } from '../../multiplayer/useRoomSession.ts'
import { shouldDisarmCardFlight } from '../board-signals.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { useScopedSelection } from './useScopedSelection.ts'
import { createCardChoiceRules } from './card-choice-rules.ts'
import { cardContext as buildCardContext, reconcileCardDraft, restoreUnknownCardDraft } from './card-draft.ts'
type Coordinator = ReturnType<typeof createCardPlayCoordinator>
type Options = Pick<CombatScreenProps, 'state' | 'viewerId' | 'onAction' | 'onChange' | 'cardPreview' | 'drawCount' |
  'authoritativeRefresh'> & {
    viewer: CombatActor
    queries: ReturnType<typeof useCombatQueries>
    reconciliation: (outcome: ActionOutcome | void) => { combat: CombatView; player: CombatPlayerView } | null
    interaction: () => { blocked: boolean; survivorDiscard: boolean }
    clearOtherActions: () => void
    presentation: { arm: (card: CardInstance, chamber: boolean) => void; disarm: () => void }
  }

export function useCardController(options: Options) {
  const { state, viewer, viewerId, onAction, onChange, cardPreview, drawCount, queries,
    authoritativeRefresh, reconciliation, presentation } = options
  const scope = `${state.combatId}:${viewerId}`
  const [selection, setSelection] = useScopedSelection<{ pending: Pending | null; miracle: boolean; previewing: boolean }>(
    scope, { pending: null, miracle: false, previewing: false })
  const pending = selection.pending
  const miracleOnCard = selection.miracle
  function setPending(update: SetStateAction<Pending | null>) {
    setSelection(previous => {
      const next = typeof update === 'function' ? update(previous.pending) : update
      return next === previous.pending ? previous : { ...previous, pending: next }
    })
  }
  function setMiracleOnCard(update: SetStateAction<boolean>) {
    setSelection(previous => {
      const next = typeof update === 'function' ? update(previous.miracle) : update
      return next === previous.miracle ? previous : { ...previous, miracle: next }
    })
  }
  function setUsingCard(previewing: boolean) {
    setSelection(previous => previous.previewing === previewing ? previous : { ...previous, previewing })
  }
  const stateRef = useRef(state)
  stateRef.current = state
  const cardActionPending = useMemo(() => ({ current: false }), [scope])
  const targetQueryPending = useRef<object | null>(null)
  const [targetQueryBusy, setTargetQueryBusy] = useState(false)
  useLayoutEffect(() => {
    targetQueryPending.current = null
    setTargetQueryBusy(false)
  }, [queries])
  const automaticCopyChoice = useRef<string | null>(null)
  const rules = createCardChoiceRules(state, viewer, miracleOnCard)
  const cardLifecycle = useActionLifecycle<CardSubmission, CombatView>({
    scope: `${state.combatId}:${viewerId}`, board: state, refresh: authoritativeRefresh,
    lockRef: cardActionPending,
    committed: (card, combat) => cardSubmissionCommitted(card, combat, viewerId),
    reconciled: (card, committed, combat) => {
      if (shouldDisarmCardFlight(card.source !== 'copy', committed)) presentation.disarm()
      const current = combatActor(combat, viewerId)
      if (committed) setPending(null)
      else if (current) restoreUnknownCard(card.pending, current, card.usingMiracle, combat)
    },
  })
  const usingCard = selection.previewing || cardLifecycle.busy || targetQueryBusy
  function restoreUnknownCard(submitted: Pending, current: CombatActor, usingMiracle: boolean, authoritative = stateRef.current) {
    setMiracleOnCard(usingMiracle)
    setPending(restoreUnknownCardDraft(submitted, current, authoritative))
  }
  function cardContext(next: Pending) { return buildCardContext(next, viewer, miracleOnCard) }
  function cardQuery(kind: 'evoke' | 'shivs', next: Pending): Extract<CombatQuery, { kind: 'evoke' | 'shivs' }> {
    return {
      kind, cardUid: next.card.uid, source: next.chamberPlay ? 'chamber' : next.cardInHand ? 'hand' : 'copy',
      context: { ...cardContext(next), ...(kind === 'evoke' ? { energySpent: next.effectEnergy ?? 0 } : {}) },
    }
  }
  function queryCardTargets(kind: 'evoke' | 'shivs', next: Pending): CombatTargetProgress | null | Promise<CombatTargetProgress | null> {
    if (kind === 'evoke' && chosenEvokeOrbs(faceOf(cardDef(next.card.defId), next.card.upgraded),
      viewer, next.evokeSlots, state.die, next.mode ?? undefined, next.effectEnergy ?? 0).length === 0) {
      return { index: 0, options: [], complete: true }
    }
    const result = queries.load(cardQuery(kind, next))
    const progress = (value: CombatQueryResult) => {
      if (value.kind !== 'evoke' && value.kind !== 'shivs') throw new Error('Expected a combat target preview.')
      return value.progress
    }
    return result instanceof Promise ? result.then(progress) : progress(result)
  }
  function coordinator() {
    return createCardPlayCoordinator({
      state, viewer, pending, miracleOnCard, ...options.interaction(), stateRef,
      cardActionPending, onAction, setUsingCard, setPending,
      withAdjacentChoices: rules.withAdjacentChoices, downfallChoicesReady: rules.downfallChoicesReady,
      slimeEnemyChoicesRequired: rules.slimeEnemyChoicesRequired, hermitEnemyChoicesRequired: rules.loadedTargetCount,
      slayerTargetAffordable: rules.slayerTargetAffordable, cardContext, commit,
      queryTargets: queryCardTargets, targetQueryPending, setQueryBusy: setTargetQueryBusy,
      onQueryError: queries.report, clearOtherActions: options.clearOtherActions,
    })
  }
  function stageOrCommit(...args: Parameters<Coordinator['choose']>) { return coordinator().choose(...args) }
  function requestChoicePreview(...args: Parameters<Coordinator['requestChoicePreview']>) { return coordinator().requestChoicePreview(...args) }
  function requestCopyChoicePreview(...args: Parameters<Coordinator['requestCopyChoicePreview']>) { return coordinator().requestCopyChoicePreview(...args) }
  function requestChamberChoicePreview(...args: Parameters<Coordinator['requestChamberChoicePreview']>) { return coordinator().requestChamberChoicePreview(...args) }
  function commit(next: Pending, skipOverflow = false) {
    if (cardActionPending.current) return
    const context = cardContext(next)
    // The online draw pile is not authoritative for action validation. The room
    // has already bound this action to its private preview, so only the engine
    // can validate it.
    const result = onAction
      ? undefined
      : next.chamberPlay
        ? playHermitChamberCard(localCombat(state), viewer!.id, next.card.uid, context)
        : next.cardInHand
          ? playCard(localCombat(state), viewer!.id, next.card.uid, context)
          : playCardCopy(localCombat(state), viewer!.id, context)
    if (result === state) {
      if (next.enemyUids.length > 0 || next.playerIds.length > 0 || next.slimeUids.length > 0 ||
        next.slimeEnemyUids.length > 0 ||
        next.chamberUids.length > 0 || next.hermitEnemyUids.length > 0 || next.soulburnEnemyUids.length > 0 ||
        next.hermitDieRelics.length > 0 || next.shivEnemyUids.length > 0 || next.evokeSlots.length > 0) {
        setPending({
          ...next, enemyUids: [], playerIds: [], slimeUids: [], slimeEnemyUids: [], chamberUids: [],
          chamberChoiceConfirmed: false, hermitEnemyUids: [],
          hermitDieRelics: [], hermitDieRelicChoiceConfirmed: false,
          soulburnEnemyUids: [], shivEnemyUids: [], evokeSlots: [], evokeEnemyUids: []
        })
      }
      return
    }
    if (next.cardInHand || next.chamberPlay) {
      presentation.arm(next.card, next.chamberPlay)
    }
    const action = {
      kind: next.chamberPlay ? 'playHermitChamberCard' : next.cardInHand ? 'playCard' : 'playCardCopy',
      cardUid: next.card.uid,
      copyId: !next.cardInHand && !next.chamberPlay ? state.pendingCardCopy?.id : undefined,
      ...context,
      preflight: true,
      expectedShivOverflow: next.overflowShivs > 0 ? next.overflowShivs : undefined,
      skipOverflow: next.overflowShivs > 0 ? skipOverflow : undefined,
    }
    const submission = {
      cardUid: next.card.uid,
      source: next.chamberPlay ? 'chamber' as const : next.cardInHand ? 'hand' as const : 'copy' as const,
      copyId: action.copyId,
      pending: next,
      usingMiracle: miracleOnCard,
    }
    if (onAction) {
      const usingMiracle = miracleOnCard
      setMiracleOnCard(false)
      setPending(next.choiceCards ? next : null)
      const finish = (outcome: ActionOutcome) => {
        if (outcome?.status !== 'refused' && outcome?.status !== 'reconciled') {
          setPending(null)
          return
        }
        if (outcome?.status === 'refused' || outcome?.status === 'reconciled') {
          const authoritative = reconciliation(outcome)
          if (!authoritative) {
            if (shouldDisarmCardFlight(next.cardInHand || next.chamberPlay, false)) presentation.disarm()
            return
          }
          if (next.chamberPlay
            ? !authoritative.player.chamber?.some((card) => card.uid === next.card.uid)
            : next.cardInHand
              ? !authoritative.player.hand?.some((card) => card.uid === next.card.uid)
              : authoritative.combat.pendingCardCopy?.card.uid !== next.card.uid ||
              authoritative.combat.pendingCardCopy.id !== action.copyId) {
            setPending(null)
            return
          }
          if (next.cardInHand || next.chamberPlay) presentation.disarm()
          const authoritativePlayer = combatActor(authoritative.combat, viewerId)
          if (!authoritativePlayer) {
            setPending(null)
            return
          }
          const chamberCard = next.chamberPlay
            ? authoritativePlayer.chamber.find((card) => card.uid === next.card.uid)
            : undefined
          const staged = chamberCard ? stageHermitChamberViewer(authoritativePlayer, chamberCard) : undefined
          const pendingPlayer = staged?.player ?? authoritativePlayer
          const def = effectiveCombatCardDef(
            faceOf(cardDef(next.card.defId), next.card.upgraded), pendingPlayer.guardianMode,
          )
          if (next.choiceCards &&
            (next.choice?.kind === 'recover' || next.choice?.kind === 'recoverExhaust')) {
            setMiracleOnCard(usingMiracle)
            const cards = next.choice.kind === 'recover'
              ? authoritative.player.discard
              : authoritative.player.exhaust
            if (cards.length === 0) {
              setPending(null)
              return
            }
            setPending({
              ...next,
              choice: cards.length > 0 ? {
                kind: next.choice.kind, amount: next.choice.amount,
                minimum: next.choice.minimum
              } : null,
              choiceCards: cards.length > 0 ? cards : null,
              choiceConfirmed: false,
              picked: [],
              enemyUid: null,
            })
            return
          }
          const reconciledCombat: CombatView = { ...stateRef.current, ...authoritative.combat }
          if (next.choiceCards && !cardNeedsChoicePreview(def, reconciledCombat, pendingPlayer)) {
            setMiracleOnCard(usingMiracle)
            setPending({
              ...pendingFor(staged?.card ?? next.card, null, reconciledCombat, pendingPlayer,
                next.cardInHand, next.cardInHand || next.chamberPlay
                ? undefined : authoritative.combat.pendingCardCopy?.energySpent,
                next.cardInHand || next.chamberPlay),
              chamberPlay: next.chamberPlay,
            })
            return
          }
          if (next.choiceCards) {
            setMiracleOnCard(usingMiracle)
            const preview = outcome?.snapshot?.cardPreview
            const matchingReveal = preview?.cardUid === next.card.uid && preview.kind === next.choice?.kind &&
              (preview.copy === true) === (!next.cardInHand && !next.chamberPlay) &&
              (preview.chamber === true) === next.chamberPlay
            if (matchingReveal) {
              const sameCards = preview.cards.length === next.choiceCards.length &&
                preview.cards.every((card, index) => card.uid === next.choiceCards?.[index]?.uid)
              const needsRetarget = preview.enemyUid !== next.enemyUid ||
                (preview.slimeEnemyUids ?? []).join('\0') !== next.slimeEnemyUids.join('\0')
              setPending({
                ...next,
                choiceCards: preview.cards,
                picked: sameCards ? next.picked : [],
                choiceConfirmed: sameCards && needsRetarget && next.choiceConfirmed,
                chamberUids: [],
                chamberChoiceConfirmed: false,
                hermitEnemyUids: [],
                scryToHandUid: sameCards ? next.scryToHandUid : undefined,
                enemyUid: preview.enemyUid,
                slimeUids: preview.slimeUids ?? [],
                slimeEnemyUids: preview.slimeEnemyUids ?? [],
              })
              return
            }
            if (next.chamberPlay) requestChamberChoicePreview(next.card, next.enemyUid, next)
            else if (next.cardInHand) requestChoicePreview(next.card, next.enemyUid, next)
            else requestCopyChoicePreview(next.enemyUid, next)
            return
          }
          const overflowShivs = overflowShivCount(authoritative.combat,
            cardShivsOnPlay(def, next.choice?.kind === 'discardAny' ? next.picked.length : 0))
          const spentShivs = cardShivChoiceCount(def, pendingPlayer)
          const enemyChoices = cardEnemyChoiceCount(def, undefined, state, viewer!)
          const playerChoices = cardPlayerChoiceCount(def)
          const physicalCard = next.cardInHand || next.chamberPlay
          const cost = physicalCard ? playCost(def, pendingPlayer, next.card) : 0
          const energySpent = physicalCard ? cost === 'X' ? null : 0
            : authoritative.combat.pendingCardCopy?.energySpent ?? 0
          const effectEnergy = physicalCard && def.cost === 'X' && cost !== 'X' ? cost : energySpent
          const needsEnemy = cardNeedsEnemy(def, pendingPlayer, false, effectEnergy ?? undefined,
            false, next.card.attachedGemId, next.card.uid,
            physicalCard && typeof cost === 'number' ? cost : undefined, next.card.hermitDeadOn === true) || spentShivs > 0 ||
            overflowShivs > 0 || enemyChoices > 0
          const needsAlly = (def.supportTarget === 'anyPlayer' ||
            guardianCardNeedsAlly(def, pendingPlayer, next.card.attachedGemId)) &&
            authoritative.combat.players.filter((player) => !player.dead).length > 1
          const needsSwitch = def.effects.some((effect) => effect.kind === 'switchRows') &&
            authoritative.combat.players.filter((player) => !player.dead).length > 1
          setMiracleOnCard(usingMiracle)
          if (needsEnemy || needsAlly || playerChoices > 0 || needsSwitch || def.modes || next.choice ||
            nextEvokeChoice(def, pendingPlayer, [], authoritative.combat.die, undefined, effectEnergy ?? 0)) {
            setPending({
              ...next,
              energySpent,
              effectEnergy,
              needsEnemy,
              needsAlly,
              needsSwitch,
              overflowShivs,
              spentShivs,
              enemyChoices,
              playerChoices,
              enemyUid: null,
              enemyUids: [],
              playerId: null,
              playerIds: authoritative.combat.players.filter((player) => !player.dead).length === 1
                ? Array(playerChoices).fill(authoritative.player.id)
                : [],
              picked: next.picked.filter((uid) =>
                authoritative.player.hand?.some((card) => card.uid === uid) === true),
              choiceConfirmed: overflowShivs === 0 &&
                (next.choice?.kind === 'discardAny' || next.choice?.kind === 'exhaustAny' || next.choice?.kind === 'bottomdeck')
                ? false
                : next.choiceConfirmed,
              switchPlayerId: null,
              switchChoiceDone: false,
              shivEnemyUids: [],
              evokeSlots: [],
              evokeEnemyUids: [],
              mode: null,
            })
          }
        }
      }
      cardLifecycle.submit(submission, () => onAction(action), true, finish)
      return
    }
    setMiracleOnCard(false)
    if (result) cardLifecycle.submit(submission, () => onChange?.(result), false)
    setPending(null)
  }
  const cardPreviewKey = cardPreview
    ? `${cardPreview.cardUid}\0${cardPreview.copy === true}\0${cardPreview.chamber === true}\0${cardPreview.kind}\0${cardPreview.spendMiracle}\0${cardPreview.enemyUid ?? ''}\0${cardPreview.slimeUids?.join('\0') ?? ''}\0${cardPreview.slimeEnemyUids?.join('\0') ?? ''}\0${cardPreview.cards.map((card) => card.uid).join('\0')}`
    : ''
  useEffect(() => {
    if (!cardPreview || !viewer) {
      if (onAction) setPending((current) => current?.choiceCards &&
        current.choice?.kind !== 'recover' && current.choice?.kind !== 'recoverExhaust' &&
        current.choice?.kind !== 'load' && current.choice?.kind !== 'loadAny' ? null : current)
      return
    }
    if (usingCard) return
    const copied = cardPreview.copy === true && state.pendingCardCopy?.playerId === viewer.id
    const chamber = cardPreview.chamber === true
    const card = copied
      ? state.pendingCardCopy!.card
      : (chamber ? viewer.chamber : viewer.hand).find((held) => held.uid === cardPreview.cardUid)
    if (!card) {
      if (onAction) setPending((current) => current?.choiceCards &&
        current.choice?.kind !== 'recover' && current.choice?.kind !== 'recoverExhaust' &&
        current.choice?.kind !== 'load' && current.choice?.kind !== 'loadAny' ? null : current)
      return
    }
    const requiredChamber = state.pendingHermitChamberPlays?.[0]
    const staged = chamber ? stageHermitChamberViewer(viewer, card,
      requiredChamber?.playerId === viewer.id && requiredChamber.cardUids[0] === card.uid &&
      requiredChamber.free === true) : null
    const next = {
      ...pendingFor(staged?.card ?? card, cardPreview.cards, state, staged?.player ?? viewer,
        staged ? false : !copied, copied ? state.pendingCardCopy?.energySpent : undefined, staged ? true : undefined)
      , chamberPlay: chamber
    }
    if (next.choice?.kind !== cardPreview.kind) return
    setMiracleOnCard(cardPreview.spendMiracle)
    const restored = {
      ...next, enemyUid: cardPreview.enemyUid,
      ...(cardPreview.energySpent === undefined ? {} : {
        energySpent: cardPreview.energySpent,
        effectEnergy: cardPreview.energySpent,
        energyCharged: copied ? 0 : cardPreview.energySpent,
      }),
      slimeUids: cardPreview.slimeUids ?? [], slimeEnemyUids: cardPreview.slimeEnemyUids ?? []
    }
    setPending((current) => current?.card.uid === card.uid &&
      current.choice?.kind === cardPreview.kind &&
      current.slimeUids.join('\0') === (cardPreview.slimeUids ?? []).join('\0') &&
      current.choiceCards?.length === cardPreview.cards.length &&
      current.choiceCards?.every((held, index) => held.uid === cardPreview.cards[index]?.uid)
      ? {
        ...current, enemyUid: cardPreview.enemyUid,
        slimeEnemyUids: cardPreview.slimeEnemyUids ?? []
      }
      : restored)
  }, [cardPreviewKey, viewerId, usingCard, onAction])
  useEffect(() => {
    const copy = state.pendingCardCopy
    if (state.phase !== 'copy' || !copy || copy.playerId !== viewerId || !viewer || cardPreview || usingCard) return
    const key = `${state.combatId}:${copy.id}`
    if (automaticCopyChoice.current === key) return
    automaticCopyChoice.current = key
    const def = faceOf(cardDef(copy.card.defId), copy.card.upgraded)
    if (cardNeedsChoicePreview(def, state, viewer)) {
      if (cardNeedsEnemy(def, viewer, false, copy.energySpent, false, copy.card.attachedGemId, copy.card.uid,
        copy.energySpent, copy.card.hermitDeadOn === true)) {
        setPending({ ...pendingFor(copy.card, null, state, viewer, false, copy.energySpent), choice: null, choiceCards: null })
        if (livingEnemies(state).length === 1) requestCopyChoicePreview(livingEnemies(state)[0]!.uid)
      } else requestCopyChoicePreview()
      return
    }
    const next = pendingFor(copy.card, null, state, viewer, false, copy.energySpent)
    setPending(next)
    stageOrCommit(next)
  }, [state.phase, state.pendingCardCopy?.id,
    viewerId, cardPreviewKey, usingCard])
  useEffect(() => {
    if (!usingCard) setPending(current => reconcileCardDraft(current, state, viewer, drawCount))
  }, [state, viewer, drawCount, usingCard])
  return {
    pending, setPending, miracleOnCard, setMiracleOnCard, usingCard, cardActionPending, stateRef, rules,
    cardQuery, commit, stageOrCommit, requestChoicePreview, requestCopyChoicePreview, requestChamberChoicePreview,
    withEvokeSlot: (...args: Parameters<Coordinator['withEvokeSlot']>) => coordinator().withEvokeSlot(...args),
    confirmCardPlay: (...args: Parameters<Coordinator['confirm']>) => coordinator().confirm(...args),
    cancelCardPlay: () => coordinator().cancel(),
  }
}
