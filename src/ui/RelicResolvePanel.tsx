import { useLayoutEffect, useState } from 'react'
import { pendingRelicEligibleCards, previewTinyHouseRewardCard } from '../game/run.ts'
import type { PendingGuardianSocket, PendingRelicPreview, PotionRewardDecision } from '../game/run.ts'
import type { ActionOutcome } from '../multiplayer/useRoomSession.ts'
import { cardDef } from '../game/cards.ts'
import { relicDef } from '../game/relics.ts'
import type { CardInstance, Player } from '../game/types.ts'
import { LootChoice, PotionLootChoices } from './RewardScreen.tsx'
import { CardRewardIcon, CardRewardPicker } from './CardRewardPicker.tsx'
import { CardPicker, PickerConfirmButton } from './CardPicker.tsx'
import { useActionLifecycle } from './actions/useActionLifecycle.ts'
import { sequenceActions } from './actions/action-delivery.ts'
import type { RoomActionContext } from './actions/useRoomAction.ts'
import { RoomActionStatus } from './actions/RoomActionStatus.tsx'
import { roomActionScope } from './actions/room-action.ts'
import { RewardChoiceScreen } from './RewardChoiceScreen.tsx'

type Props = {
  pending: PendingRelicPreview
  player: Player
  potion?: false | null | string
  ascension: number
  onPotion: (decision: PotionRewardDecision) => void | Promise<ActionOutcome>
  onRewardChoice: (reward: number, choice: number) => void | Promise<ActionOutcome>
  onResolve: (cardUids: string[], rewardIndices: number[]) => void | Promise<ActionOutcome>
  delivery?: RoomActionContext
}

const CARD_COUNTS: Record<string, number> = {
  war_paint: 1, whetstone: 1, astrolabe: 3, empty_cage: 2, pandoras_box: 3, tiny_house: 1,
}

type Submission = {
  reward?: number
  choice?: number
  previous: number[]
  resolving?: boolean
  potion?: { id: Props['potion']; inventory: string }
}

export function RelicResolvePanel({ pending, player, potion, ascension, onPotion, onRewardChoice, onResolve, delivery }: Props) {
  const [cards, setCards] = useState<string[]>([])
  const [selectedCardUids, setSelectedCardUids] = useState<string[]>([])
  const [rewards, setRewards] = useState<number[]>(() => Object.assign([], pending.rewardIndices))
  const [operation, setOperation] = useState<'reward' | 'resolve'>('resolve')
  const [activeReward, setActiveReward] = useState<number | null>(() =>
    ['enchiridion', 'downfall_enchiridion'].includes(pending.relicId) && pending.rewardIndices?.[0] === undefined ? 0 : null)
  const rewardKey = JSON.stringify(pending.rewardIndices ?? {})
  useLayoutEffect(() => setRewards(current => Object.assign([...current], pending.rewardIndices)), [rewardKey])
  const restore = (submission: Submission, authoritative = pending) => {
    if (submission.reward !== undefined && authoritative.rewardIndices?.[submission.reward] !== submission.choice) {
      setRewards(Object.assign([...submission.previous], authoritative.rewardIndices))
      setActiveReward(submission.reward)
    }
  }
  const lifecycle = useActionLifecycle<Submission, { pending: PendingRelicPreview; potion: Props['potion']; inventory: string }>({
    scope: `${delivery ? roomActionScope(delivery.snapshot) : player.id}/${pending.id ?? pending.relicId}`,
    board: { pending, potion, inventory: JSON.stringify(player.potions) },
    refresh: delivery?.refresh, version: delivery?.snapshot.version, awaitCommit: Boolean(delivery),
    committed: (submission, current) => !submission.resolving &&
      (submission.reward === undefined || current.pending.rewardIndices?.[submission.reward] === submission.choice) &&
      (!submission.potion || current.potion !== submission.potion.id || current.inventory !== submission.potion.inventory),
    reconciled: (submission, committed, current) => { if (!committed) restore(submission, current.pending) },
  })
  const resolving = lifecycle.busy
  const rewardChoicePending = lifecycle.busy && operation === 'reward'
  const submit = (submission: Omit<Submission, 'previous'>, steps: (() => void | Promise<ActionOutcome>)[]) => {
    const payload = { ...submission, previous: [...rewards] }
    return lifecycle.submit(payload, current => sequenceActions(steps, current), true, outcome => {
      if (outcome.status !== 'accepted') restore(payload, outcome.snapshot?.pendingRelic ?? pending)
    })
  }
  const isTinyHouse = pending.relicId === 'tiny_house'
  const tinyHouseRewardIndex = isTinyHouse ? rewards[0] : undefined
  const tinyHouseRewardDefId = tinyHouseRewardIndex !== undefined && tinyHouseRewardIndex >= 0
    ? pending.rewardChoices?.[0]?.[tinyHouseRewardIndex]
    : undefined
  const tinyHouseRewardCard = tinyHouseRewardDefId ? previewTinyHouseRewardCard(player, tinyHouseRewardDefId) : undefined
  const eligible = [
    ...(tinyHouseRewardCard && pendingRelicEligibleCards({ deck: [tinyHouseRewardCard] }, 'tiny_house').length > 0
      ? [tinyHouseRewardCard] : []),
    ...pendingRelicEligibleCards(player, pending.relicId),
  ]
  const count = Math.min(CARD_COUNTS[pending.relicId] ?? 0, eligible.length)
  const rewardReady = (pending.rewardChoices ?? []).every((_choice, index) => rewards[index] !== undefined)
  const verb = pending.relicId === 'pandoras_box' ? 'Transform'
    : pending.relicId === 'empty_cage' ? 'Remove' : 'Upgrade'
  const chooseReward = (reward: number, choice: number) => {
    if (lifecycle.locked()) return
    const next = [...rewards]
    next[reward] = choice
    setRewards(next)
    setOperation('reward')
    setActiveReward(null)
    const resolving = !isTinyHouse && cards.length === count &&
      (pending.rewardChoices ?? []).every((_choices, index) => next[index] !== undefined)
    submit({ reward, choice, resolving }, [
      () => onRewardChoice(reward, choice),
      ...(resolving ? [() => onResolve(cards, next)] : []),
    ])
  }
  const choosePotion = (decision: PotionRewardDecision) => {
    if (lifecycle.locked()) return
    setOperation('resolve')
    submit({ potion: { id: potion, inventory: JSON.stringify(player.potions) } }, [() => onPotion(decision)])
  }
  const skipTinyHouseLoot = () => {
    if (lifecycle.locked()) return
    const reward = (pending.rewardChoices ?? []).findIndex((_choices, index) => rewards[index] === undefined)
    if (reward < 0) return choosePotion({ kind: 'skipAll' })
    setOperation('resolve')
    submit({ reward, choice: -1, ...(typeof potion === 'string'
      ? { potion: { id: potion, inventory: JSON.stringify(player.potions) } } : {}) }, [
      () => onRewardChoice(reward, -1),
      ...(typeof potion === 'string' ? [() => onPotion({ kind: 'skipAll' })] : []),
    ])
  }
  const resolveRelic = (cardUids: string[], rewardIndices: number[]) => {
    if (lifecycle.locked()) return
    setOperation('resolve')
    submit({ resolving: true }, [() => onResolve(cardUids, rewardIndices)])
  }
  const rewardIsRare = (reward: number) => pending.relicId === 'enchiridion' || pending.relicId === 'forbidden_fruit' && reward === 1
  const isPandora = pending.relicId === 'pandoras_box'
  const remaining = count - cards.length
  if (lifecycle.phase === 'unknown' || lifecycle.phase === 'accepted') return <RewardChoiceScreen
    title={`Resolve ${relicDef(pending.relicId).name}`} choiceKey="relic-delivery">
    {delivery ? <RoomActionStatus uncertain={lifecycle.phase === 'unknown'} onResync={delivery.onResync} />
      : <p role="status">Delivery could not be confirmed. Reconnect before trying again.</p>}
  </RewardChoiceScreen>
  if (isPandora && count > 0) return <CardPicker
    cards={eligible.filter((card) => !cards.includes(card.uid))}
    verb="Transform"
    selectionLabel={`${remaining} card${remaining === 1 ? '' : 's'}`}
    selectedCardUids={selectedCardUids}
    onSelect={(uid) => setSelectedCardUids((current) => current.includes(uid) ? [] : [uid])}
    onClear={() => setSelectedCardUids([])}
    onBack={() => undefined}
    onConfirm={() => {
      const uid = selectedCardUids[0]
      if (!uid) return
      const chosen = [...cards, uid]
      if (chosen.length === count) resolveRelic(chosen, rewards)
      else {
        setCards(chosen)
        setSelectedCardUids([])
      }
    }}
    confirmLabel={`Confirm ${relicDef(pending.relicId).name}`}
    confirmDisabled={selectedCardUids.length !== 1 || resolving}
  />
  if (rewardChoicePending) return <section className="reward-screen reward-screen--card-choice" aria-busy="true">
    <h2 className="reward-screen__title">Choose a Card</h2>
    <p className="muted" role="status">Claiming card…</p>
  </section>
  if (activeReward !== null) {
    const choices = pending.rewardChoices?.[activeReward] ?? []
    return <CardRewardPicker choices={choices} upgraded={pending.rewardUpgraded?.[activeReward] === true}
      uidPrefix={`relic-reward-${activeReward}`} onChoose={(choice) => chooseReward(activeReward, choice)}
      onSkip={() => chooseReward(activeReward, -1)} />
  }
  if (isTinyHouse && (!rewardReady || typeof potion === 'string')) return <section className="reward-screen reward-screen--loot">
    <h2 className="reward-screen__title">Tiny House</h2>
    <div className="reward-screen__players"><div className="reward-screen__player">
      {typeof potion === 'string' ? <PotionLootChoices potionId={potion} player={player} ascension={ascension}
        disabled={resolving} onChoose={choosePotion} /> : null}
      {(pending.rewardChoices ?? []).map((_choices, reward) => rewards[reward] === undefined ? <LootChoice key={reward}
        icon={<CardRewardIcon />} disabled={resolving} onClick={() => setActiveReward(reward)}>Add a card to your deck.</LootChoice> : null)}
    </div></div>
    <button className="reward-screen__skip" type="button" disabled={resolving}
      onClick={skipTinyHouseLoot}>{resolving ? 'Resolving…' : 'Skip'}</button>
  </section>
  if (isTinyHouse) return <CardPicker
    cards={eligible}
    verb="Upgrade"
    selectedCardUids={selectedCardUids}
    onSelect={(uid) => setSelectedCardUids((current) => current.includes(uid) ? [] : [uid])}
    onClear={() => setSelectedCardUids([])}
    onConfirm={() => resolveRelic(selectedCardUids, rewards)}
    confirmLabel="Confirm Tiny House"
    confirmDisabled={count > 0 ? selectedCardUids.length !== 1 || resolving : resolving}
    selectionRequired={count > 0}
  />
  if ((pending.rewardChoices?.length ?? 0) > 0 && count === 0) return <section className="reward-screen reward-screen--loot">
    <h2 className="reward-screen__title">Loot!</h2>
    <div className="reward-screen__players"><div className="reward-screen__player">
      {(pending.rewardChoices ?? []).map((_choices, reward) => rewards[reward] === undefined ? <LootChoice key={reward}
        icon={<CardRewardIcon rare={rewardIsRare(reward)} />} onClick={() => setActiveReward(reward)}>Add a card to your deck.</LootChoice> : null)}
    </div></div>
    <button className="reward-screen__skip" type="button" disabled={resolving}
      onClick={() => resolveRelic([], (pending.rewardChoices ?? []).map((_choices, index) => rewards[index] ?? -1))}>{resolving ? 'Resolving…' : 'Skip'}</button>
  </section>
  if (count > 0 && rewardReady) return <CardPicker
    heading={`Resolve ${relicDef(pending.relicId).name}`} description={relicDef(pending.relicId).text}
    cards={eligible} verb={verb} selectedCardUids={cards} maxSelections={count}
    disabled={resolving} onSelect={uid => setCards(current => current.includes(uid)
      ? current.filter(selected => selected !== uid) : current.length < count ? [...current, uid] : current)}
    onClear={() => setCards([])} onConfirm={() => resolveRelic(cards, rewards)}
    confirmLabel={`Confirm ${relicDef(pending.relicId).name}`}
  />
  return <section className="room-screen relic-resolve">
    <h2>Resolve {relicDef(pending.relicId).name}</h2>
    {/* The panel asks the player to pick cards for an effect it never stated. */}
    <p className="room-item-text">{relicDef(pending.relicId).text}</p>
    {(pending.rewardChoices ?? []).map((_choices, reward) => rewards[reward] === undefined ? <LootChoice key={reward}
      icon={<CardRewardIcon rare={rewardIsRare(reward)} />} onClick={() => setActiveReward(reward)}>Add a card to your deck.</LootChoice> : null)}
    <footer className="card-picker__footer relic-resolve__footer">
      <p>{count > 0 ? 'Choose the rewards before selecting cards.' : <>Confirm this <strong>Relic</strong>.</>}</p>
      <PickerConfirmButton label={`Confirm ${relicDef(pending.relicId).name}`}
        disabled={resolving || cards.length !== count || !rewardReady}
        onClick={() => resolveRelic(cards, rewards)} />
    </footer>
  </section>
}

export function GuardianSocketPanel({ pending, deck, onResolve }: {
  pending: PendingGuardianSocket
  deck: CardInstance[]
  onResolve: (gemId: string) => void
}) {
  const host = deck.find((card) => card.uid === pending.cardUid)
  const hostName = host ? cardDef(host.defId).name : 'this card'
  return <CardRewardPicker choices={pending.gemIds} uidPrefix={`guardian-socket-${pending.cardUid}`}
    title="Choose a Gem"
    description={`Socket into ${hostName}. Unchosen Gems return to the bottom of the Gem deck.`}
    onChoose={(index) => onResolve(pending.gemIds[index]!)} />
}
