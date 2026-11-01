// Pure per-viewer projections. Never spread a Player or expose authoritative RNG.
import {
  canRerollDownfallSelfBoss, neowPreview, pendingTriggerAbility,
  startTurnAbilities, startTurnScryAbilities, startTurnScryPreview, visibleMap,
} from '../../../src/game/state.ts'
import { initialEnemySlots } from '../../../src/game/combat.ts'
import { redactPlayer } from '../../../src/server/player-projection.ts'
import { dieRelicChoiceNeedsInput, prioritizePendingTrigger } from './combat-choices.mjs'

export function redactRun(run, viewerId, room) {
  const viewerCharacter = run.players.find((player) => player.id === viewerId)?.character
  const preparedCombat = run.roomState?.kind === 'event' ? run.roomState.preparedCombat : undefined
  const preparedScry = preparedCombat ? startTurnScryPreview(preparedCombat) : undefined
  const roomState = run.roomState?.kind === 'event'
    ? {
        kind: 'event',
        card: structuredClone(run.roomState.card),
        decisions: Object.fromEntries(Object.entries(run.roomState.decisions).map(([playerId, decision]) => [
          playerId,
          playerId === viewerId ? structuredClone(decision) : { optionIds: [...decision.optionIds] },
        ])),
        dieRolls: structuredClone(run.roomState.dieRolls),
        rewardOffers: Object.fromEntries(Object.entries(run.roomState.rewardOffers ?? {}).map(([playerId, offers]) => [
          playerId,
          playerId === viewerId ? structuredClone(offers) : offers.map(() => []),
        ])),
        guardianGemOffers: Object.fromEntries(Object.entries(run.roomState.guardianGemOffers ?? {}).map(([playerId, offers]) => [
          playerId,
          playerId === viewerId ? structuredClone(offers) : offers.map(() => []),
        ])),
        itemOffers: structuredClone(run.roomState.itemOffers ?? {}),
        pendingDecisions: viewerId && run.roomState.pendingDecisions?.[viewerId]
          ? { [viewerId]: structuredClone(run.roomState.pendingDecisions[viewerId]) }
          : {},
        pendingRolls: viewerId && run.roomState.pendingRolls?.[viewerId]
          ? { [viewerId]: structuredClone(run.roomState.pendingRolls[viewerId]) }
          : {},
        revealedCards: structuredClone(run.roomState.revealedCards ?? {}),
        revealedCardDefs: structuredClone(run.roomState.revealedCardDefs ?? {}),
        revealedRelics: structuredClone(run.roomState.revealedRelics ?? {}),
        availableRewardSources: structuredClone(run.roomState.availableRewardSources),
        partyOptionIds: structuredClone(run.roomState.partyOptionIds),
        preparedStartTurnScryAbilities: preparedCombat ? startTurnScryAbilities(preparedCombat) : undefined,
        preparedStartTurnScry: preparedScry ? {
          ...preparedScry,
          cards: preparedScry.playerId === viewerId ? structuredClone(preparedScry.cards) : null,
        } : undefined,
        preparedStartTurnCoordinatorId: preparedCombat
          ? room.seats.find((seat) => seat.connected !== false && preparedCombat.players
              .some((player) => player.id === seat.playerId && !player.dead))?.playerId ?? null
          : undefined,
        preparedCombat: run.roomState.preparedCombat
          ? { players: run.roomState.preparedCombat.players.map((player) => ({
              id: player.id,
              hand: player.id === viewerId ? structuredClone(player.hand) : null,
            })),
            enemies: run.roomState.preparedCombat.enemies.map((enemy) => ({
              uid: enemy.uid,
              defId: enemy.defId,
              row: enemy.row,
              isBoss: enemy.isBoss,
              ascension: enemy.ascension,
              hp: enemy.hp,
              maxHp: enemy.maxHp,
              dead: enemy.dead,
            })),
            ...(run.roomState.preparedCombat.pendingHermitSetupLoads?.length ? {
              pendingHermitSetupLoads: structuredClone(run.roomState.preparedCombat.pendingHermitSetupLoads),
            } : {}),
          }
          : undefined,
        pendingTrade: run.roomState.pendingTrade
          ? viewerId === run.roomState.pendingTrade.actorId || viewerId === run.roomState.pendingTrade.targetId
            ? {
              ...structuredClone(run.roomState.pendingTrade),
              decision: viewerId === run.roomState.pendingTrade.actorId
                ? structuredClone(run.roomState.pendingTrade.decision)
                : { optionIds: [...run.roomState.pendingTrade.decision.optionIds], targetPlayerId: run.roomState.pendingTrade.targetId },
            }
            : {
                actorId: run.roomState.pendingTrade.actorId,
                targetId: run.roomState.pendingTrade.targetId,
                kind: run.roomState.pendingTrade.kind,
                offeredId: '',
                decision: { optionIds: [], targetPlayerId: run.roomState.pendingTrade.targetId },
              }
          : undefined,
        labChoices: Object.fromEntries(Object.keys(run.roomState.labChoices ?? {}).map((playerId) => [playerId, playerId === viewerId ? structuredClone(run.roomState.labChoices[playerId]) : { optionIds: ['resolve'] }])),
      }
    : run.roomState?.kind === 'treasure' || run.roomState?.kind === 'elite'
      ? {
          ...structuredClone(run.roomState),
          decisions: Object.fromEntries(Object.entries(run.roomState.decisions).map(([playerId, decision]) => [
            playerId,
            playerId === viewerId || typeof decision === 'number' ? decision : 'skip',
          ])),
        }
      : run.roomState ? structuredClone(run.roomState) : null
  return {
    ascension: run.ascension,
    chooseYourRelic: run.chooseYourRelic,
    lastStand: run.lastStand,
    meta: structuredClone(run.meta ?? { mode: 'standard', modifierIds: [] }),
    setup: run.setup ? structuredClone(run.setup) : null,
    act: run.act,
    phase: run.phase,
    // Dealt Blessing faces are public; offers and the shuffled deck are not.
    neow: run.neow ? {
      players: Object.fromEntries(Object.keys(run.neow.players).map((playerId) => [
        playerId,
        neowPreview(run, playerId, viewerId),
      ])),
    } : null,
    pendingBossDefId: null,
    pendingGuardianSockets: (run.pendingGuardianSockets ?? [])
      .filter((pending, index) => run.phase === 'reward' ? pending.playerId === viewerId : index === 0)
      .slice(0, 1)
      .map((pending) => pending.playerId === viewerId ? structuredClone(pending) : { playerId: pending.playerId }),
    // The setup boss is public; the pending Ascension 13 second boss is hidden.
    actBossDefId: run.actBossDefId ?? null,
    canRerollDownfallSelfBoss: canRerollDownfallSelfBoss(run),
    map: visibleMap(run),
    log: run.log,
    players: run.players.map((player) => redactPlayer(player, viewerId)),
    combat: run.combat ? redactCombat(run.combat, viewerId) : null,
    // Teammates know a reward exists, never its cards or draw bookkeeping.
    rewards: run.rewards.map((offer) => {
      if (offer.playerId === viewerId) return { ...offer, potionQueue: offer.potionQueue?.map(() => null) }
      const {
        choices, cardSource, prismatic, upgraded, rareChoiceIndices, cardsDrawn, raresDrawn,
        drawsReserved, prismaticSources, prismaticDraws, availableSources, guardianGems, potionQueue,
        ...publicOffer
      } = offer
      return { ...publicOffer, choices: null, potionQueue: potionQueue?.map(() => null) }
    }),
    roomState,
    courier: structuredClone(run.courier),
    campaign: {
      runId: run.campaign.runId,
      bossesDefeated: run.campaign.bossesDefeated,
      highestBossActDefeated: run.campaign.highestBossActDefeated,
      ...(run.campaign.bossCoins ? { bossCoins: structuredClone(run.campaign.bossCoins) } : {}),
      ...(viewerCharacter && run.campaign.joinedAfterBosses?.[viewerCharacter]
        ? { joinedAfterBosses: { [viewerCharacter]: run.campaign.joinedAfterBosses[viewerCharacter] } } : {}),
      keys: structuredClone(run.campaign.keys),
      finalized: run.campaign.finalized,
    },
  }
}

export function redactCombat(combat, viewerId) {
  const progress = combat.startTurnProgress
  const progressOwners = new Map(progress ? startTurnAbilities(combat)
    .map((ability) => [ability.id, ability.playerId]) : [])
  const startChoiceOwner = (choice) => progressOwners.get(choice.id) ?? combat.players.find((player) =>
    choice.id.startsWith(`${player.id}/`) || choice.id.startsWith(`${combat.combatId}/${combat.turn}/${player.id}/`) ||
    choice.id.startsWith(`facing:${player.id}`) || choice.id.startsWith(`guardian:${player.id}/`))?.id
  const redactStartChoice = (choice) => ({
    ...structuredClone(choice),
    exhaustUids: startChoiceOwner(choice) === viewerId
      ? structuredClone(choice.exhaustUids) : undefined,
    trigger: startChoiceOwner(choice) === viewerId
      ? structuredClone(choice.trigger) : undefined,
  })
  const visibleProgressChoices = progress?.choices?.map(redactStartChoice)
  const viewerDieChoice = combat.pendingDieRelicChoices?.some((choice) =>
    choice.playerId === viewerId && dieRelicChoiceNeedsInput(combat, choice))
  const triggerCombat = viewerDieChoice
    ? undefined : prioritizePendingTrigger(combat, (trigger) => trigger.playerId === viewerId)
  const triggerPreview = triggerCombat && pendingTriggerAbility(triggerCombat)
  return {
    combatId: combat.combatId,
    initialEnemyCount: initialEnemySlots(combat),
    turn: combat.turn,
    die: combat.die,
    phase: combat.phase,
    lastStand: combat.lastStand === true,
    potionLimit: combat.potionLimit,
    startTurnStage: combat.startTurnStage,
    powerTriggersUsedThisTurn: combat.powerTriggersUsedThisTurn ?? [],
    pendingTriggers: structuredClone(combat.pendingTriggers ?? []),
    pendingTriggerAbility: triggerPreview?.playerId === viewerId ? structuredClone(triggerPreview) : null,
    // Mask allocators to avoid leaking private draw reactions through their count.
    nextTriggerId: 0,
    startTurnProgress: progress ? {
      choices: visibleProgressChoices,
      beforeDraw: progress.beforeDraw ? structuredClone(progress.beforeDraw) : undefined,
      rollPending: progress.rollPending ? structuredClone(progress.rollPending) : undefined,
      discard: progress.discard ? {
        playerId: progress.discard.playerId,
        sourceId: progress.discard.sourceId,
        pendingTriggers: [],
      } : undefined,
      forcedCard: progress.forcedCard ? {
        playerId: progress.forcedCard.playerId,
        cardUid: progress.forcedCard.playerId === viewerId ? progress.forcedCard.cardUid : null,
        sourceCardId: progress.forcedCard.sourceCardId ?? 'mayhem',
        sourceLabel: progress.forcedCard.sourceLabel,
        exhaustNonPower: progress.forcedCard.exhaustNonPower === true,
      } : undefined,
    } : undefined,
    pendingCardCopy: combat.pendingCardCopy ? {
      id: combat.pendingCardCopy.playerId === viewerId ? combat.pendingCardCopy.id : 0,
      playerId: combat.pendingCardCopy.playerId,
      card: structuredClone(combat.pendingCardCopy.card),
      energySpent: combat.pendingCardCopy.energySpent,
      resumePhase: combat.pendingCardCopy.resumePhase,
      forcedExhaust: combat.pendingCardCopy.forcedExhaust,
      forcedChoices: combat.pendingCardCopy.forcedChoices?.map(redactStartChoice) ?? null,
      deferredHavocs: structuredClone(combat.pendingCardCopy.deferredHavocs),
      deferredTriggers: structuredClone(combat.pendingCardCopy.deferredTriggers ?? []),
      sourceNames: structuredClone(combat.pendingCardCopy.sourceNames),
      virtualOnly: combat.pendingCardCopy.virtualOnly === true,
      queuedWeaves: combat.pendingCardCopy.playerId === viewerId
        ? structuredClone(combat.pendingCardCopy.queuedWeaves ?? [])
        : [],
    } : undefined,
    pendingDistilled: combat.pendingDistilled ? {
      playerId: combat.pendingDistilled.playerId,
      cards: combat.pendingDistilled.playerId === viewerId
        ? structuredClone(combat.pendingDistilled.cards)
        : null,
    } : undefined,
    pendingHermitSetupLoads: structuredClone(combat.pendingHermitSetupLoads ?? []),
    pendingDieRelicChoices: structuredClone(combat.pendingDieRelicChoices ?? []),
    pendingHermitChamberPlays: (combat.pendingHermitChamberPlays ?? []).map((pending) => ({
      playerId: pending.playerId,
      sourceCardId: pending.sourceCardId,
      free: pending.free,
      cardUids: pending.playerId === viewerId ? structuredClone(pending.cardUids) : [],
      cardCount: pending.cardUids.length,
    })),
    pendingHermitStrengthRewards: structuredClone(combat.pendingHermitStrengthRewards ?? []),
    ...(combat.pendingCardPlayWindows?.some((window) => window.playerId === viewerId) ? {
      pendingCardPlayWindows: structuredClone(combat.pendingCardPlayWindows
        .filter((window) => window.playerId === viewerId)),
    } : {}),
    pendingPlayerChoices: structuredClone(combat.pendingPlayerChoices ?? []),
    ...(combat.pendingSlayerChoices?.length ? {
      pendingSlayerChoices: combat.pendingSlayerChoices.map((choice) => choice.kind === 'ritualDagger'
        ? { ...choice, revealed: choice.playerId === viewerId ? choice.revealed : null }
        : structuredClone(choice)),
    } : {}),
    pendingPlunderSwitches: structuredClone(combat.pendingPlunderSwitches ?? []),
    pendingRelicScry: combat.pendingRelicScry ? {
      id: combat.pendingRelicScry.playerId === viewerId ? combat.pendingRelicScry.id : 0,
      playerId: combat.pendingRelicScry.playerId,
      relicIndex: combat.pendingRelicScry.relicIndex,
      cards: combat.pendingRelicScry.playerId === viewerId
        ? structuredClone(combat.pendingRelicScry.cards)
        : null,
    } : undefined,
    playedCardsThisTurn: structuredClone(combat.playedCardsThisTurn ?? []),
    viewerStanceChangedThisTurn: combat.stanceChangedThisTurn.includes(viewerId),
    presentationEvents: (combat.presentationEvents ?? []).map((event) => ({
      seq: event.seq,
      kind: event.kind,
      actorId: event.actorId,
      sourceId: event.sourceId,
      enemyIds: [...event.enemyIds],
      playerIds: [...event.playerIds],
      ...(event.enemyRow === undefined ? {} : { enemyRow: event.enemyRow }),
      ...(event.enemyHpLoss === undefined ? {} : { enemyHpLoss: { ...event.enemyHpLoss } }),
      ...(event.kind === 'card' ? {
        upgraded: event.upgraded,
        copied: event.copied,
        energy: event.energy,
        ...(event.mode === undefined ? {} : { mode: event.mode }),
        ...(event.resolvedType === undefined ? {} : { resolvedType: event.resolvedType }),
      } : {}),
      ...(event.kind === 'slime' ? {
        slimeUid: event.slimeUid,
        upgraded: event.upgraded,
        animationIndex: event.animationIndex,
      } : {}),
      ...(event.kind === 'orb' ? { orb: event.orb } : {}),
      ...(event.kind === 'turn' ? { effect: event.effect, actorTargeted: event.actorTargeted } : {}),
    })),
    pendingSummons: structuredClone(combat.pendingSummons ?? []),
    log: combat.log,
    enemies: combat.enemies.map(({ poisonSources, ...enemy }) => enemy),
    players: combat.players.map((player) => redactPlayer(player, viewerId)),
  }
}
