import { useEffect, useState, type CSSProperties } from 'react'
import { assetPath } from '../game/assets.ts'
import { cardIsCurse } from '../game/cards.ts'
import type { ActionOutcome, VisibleRun } from '../multiplayer/useRoomSession.ts'
import type { RewardSource } from '../game/run.ts'
import { rewardSourceLabel } from './reward-source.ts'
import { CardRewardIcon, CardRewardPicker } from './CardRewardPicker.tsx'
import { CardPicker } from './CardPicker.tsx'
import { RelicRewardPicker } from './RelicRewardPicker.tsx'
import { ItemLootChoice, LootChoice, PotionLootChoices } from './RewardScreen.tsx'
import { RewardChoiceScreen } from './RewardChoiceScreen.tsx'
import { useRoomAction } from './actions/useRoomAction.ts'
import type { RoomActionContext } from './actions/useRoomAction.ts'
import type { NoncombatAction } from './actions/room-action.ts'
import { RoomActionStatus } from './actions/RoomActionStatus.tsx'

type Props = RoomActionContext & {
  run: VisibleRun
  viewerId: string
  waitingForTeammate?: boolean
  onAction: (action: object) => Promise<ActionOutcome>
}

export function OnlineRewardScreen({ run, viewerId, waitingForTeammate = false, onAction, snapshot, refresh, onResync }: Props) {
  const [activeCard, setActiveCard] = useState(false)
  const [activeRelic, setActiveRelic] = useState(false)
  const [activeTransform, setActiveTransform] = useState(false)
  const [transformUid, setTransformUid] = useState<string | null>(null)
  const [operation, setOperation] = useState<'card' | 'reveal' | 'loot'>('loot')
  const [sources, setSources] = useState<RewardSource[]>([])
  const backdrop = { '--reward-backdrop': `url("${new URL(assetPath(`backgrounds/boss-act-${run.act}.webp`), window.location.href).href}")` } as CSSProperties
  const offer = run.rewards.find((candidate) => candidate.playerId === viewerId)
  const player = run.players.find((candidate) => candidate.id === viewerId)
  const delivery = useRoomAction({ snapshot, refresh, onAction, onRestore: actions => {
    if (!offer?.prismatic && actions.some(action => action.kind === 'cardReward' && action.choice === 'reveal')) {
      setActiveCard(false)
    }
  } })
  const lootPending = delivery.busy
  const cardChoicePending = delivery.busy && operation === 'card'
  const revealPending = delivery.busy && operation === 'reveal'
  const availableSources = offer?.availableSources ?? []
  const availableSourcesKey = availableSources.join(',')
  useEffect(() => setSources((current) => current.filter((source) => availableSources.includes(source))), [availableSourcesKey])
  useEffect(() => {
    if (!Array.isArray(offer?.bossRelics)) setActiveRelic(false)
  }, [offer?.bossRelics, viewerId])
  useEffect(() => {
    if (!offer?.transformReward) {
      setActiveTransform(false)
      setTransformUid(null)
    }
    if (!offer?.cardReward) {
      setActiveCard(false)
    }
  }, [offer?.cardReward, offer?.transformReward, offer?.choices, viewerId])
  if (!offer || !player) return null
  const hasLootChoice = Boolean(offer.gold || offer.potion || offer.relic ||
    Array.isArray(offer.bossRelics) && offer.bossRelics.length > 0 || offer.transformReward ||
    offer.cardReward)
  const dispatch = (actions: NoncombatAction[], kind: typeof operation) => {
    if (delivery.submit(actions)) setOperation(kind)
  }
  const pickCard = (choice: number | null) => dispatch([{ kind: 'cardReward', choice }], 'card')
  const revealCards = (sources?: RewardSource[]) => dispatch([
    { kind: 'cardReward', choice: 'reveal', ...(sources ? { sources } : {}) },
  ], 'reveal')
  const dispatchLoot = (actions: NoncombatAction[]) => dispatch(actions, 'loot')
  const skipLoot = () => {
    const actions: NoncombatAction[] = []
    if (offer.gold) actions.push({ kind: 'goldReward', gain: false })
    if (offer.potion) actions.push({ kind: 'potionReward', choice: 'skipAll' })
    if (offer.relic) actions.push({ kind: 'relicReward', choice: 'skip' })
    if (offer.bossRelics) actions.push({ kind: 'bossRelicReward', choice: 'skip' })
    if (offer.transformReward) actions.push({ kind: 'transformReward', cardUid: null })
    if (offer.cardReward && !cardChoicePending) actions.push({ kind: 'cardReward', choice: null })
    dispatchLoot(actions)
  }

  if (delivery.phase === 'unknown' || delivery.phase === 'accepted') return <RewardChoiceScreen
    title={activeCard ? 'Choose a Card' : activeRelic ? 'Choose a Relic' : 'Loot!'}
    choiceKey="room-action-recovery" style={backdrop}>
    <RoomActionStatus uncertain={delivery.phase === 'unknown'} onResync={onResync} />
  </RewardChoiceScreen>

  if (activeRelic && Array.isArray(offer.bossRelics) && offer.bossRelics.length > 0) return <RelicRewardPicker
    choices={offer.bossRelics} style={backdrop} disabled={lootPending} skipDisabled={waitingForTeammate}
    onBack={() => setActiveRelic(false)}
    onChoose={(relicId) => dispatchLoot([{ kind: 'bossRelicReward', choice: 'gain', relicId }])}
    onSkip={() => dispatchLoot([{ kind: 'bossRelicReward', choice: 'skip' }])} />

  if (activeTransform && offer.transformReward) return <CardPicker
    cards={(player.deck ?? []).filter((card) => !cardIsCurse(card.defId))}
    verb="Transform"
    backLabel="Back to loot"
    selectedCardUids={transformUid ? [transformUid] : []}
    onSelect={(uid) => setTransformUid((current) => current === uid ? null : uid)}
    onClear={() => setTransformUid(null)}
    onBack={() => { setActiveTransform(false); setTransformUid(null) }}
    onConfirm={() => {
      if (!transformUid) return
      dispatchLoot([{ kind: 'transformReward', cardUid: transformUid }])
    }}
    confirmDisabled={lootPending || !transformUid}
    backDisabled={lootPending}
    disabled={lootPending} />

  if (activeCard && cardChoicePending) return <section className="reward-screen reward-screen--card-choice" style={backdrop} aria-busy="true">
    <h2 className="reward-screen__title">Choose a Card</h2>
    <p className="muted" role="status">Claiming card…</p>
  </section>

  if (activeCard && offer.cardReward && offer.choices === null) return <section className="reward-screen reward-screen--card-choice" style={backdrop}>
    <h2 className="reward-screen__title">Choose a Card</h2>
    {offer.prismatic ? <fieldset className="reward-screen__sources"><legend>Choose 3 reward decks</legend>
      {(offer.availableSources ?? []).map((source) => <label key={source}><input type="checkbox" checked={sources.includes(source)} disabled={revealPending}
        onChange={(event) => setSources((current) => event.target.checked
          ? current.length < 3 ? [...current, source] : current
          : current.filter((candidate) => candidate !== source))} /> {rewardSourceLabel(source)}</label>)}
      <button type="button" disabled={sources.length !== 3 || revealPending} onClick={() => revealCards(sources)}>{revealPending ? 'Revealing…' : 'Reveal cards'}</button>
    </fieldset> : <p className="muted" role="status">Revealing cards…</p>}
    <button className="reward-screen__skip" type="button" disabled={waitingForTeammate || delivery.busy}
      onClick={() => pickCard(null)}>{waitingForTeammate ? 'Waiting for teammate' : 'Skip'}</button>
  </section>

  if (activeCard && offer.cardReward && offer.choices !== null) return <CardRewardPicker
    choices={offer.choices} upgraded={offer.upgraded} uidPrefix={`reward-${viewerId}`} style={backdrop}
    disabled={delivery.busy}
    skipDisabled={waitingForTeammate} skipLabel={waitingForTeammate ? 'Waiting for teammate' : 'Skip'}
    onChoose={pickCard} onSkip={() => pickCard(null)} />

  return <section className="reward-screen reward-screen--loot" style={backdrop}>
    <h2 className="reward-screen__title">Loot!</h2>
    <div className="reward-screen__players"><div className="reward-screen__player">
      {offer.gold ? <LootChoice sound="gold" disabled={lootPending} onClick={() => dispatchLoot([{ kind: 'goldReward' }])} icon={<img src={assetPath('icons/gold.png')} alt="" />}>{offer.gold} Gold</LootChoice> : null}
      {typeof offer.potion === 'string' ? <PotionLootChoices potionId={offer.potion} player={player} ascension={run.ascension} disabled={lootPending}
        onChoose={(decision) => dispatchLoot([{ ...decision, kind: 'potionReward', choice: decision.kind }])} /> : null}
      {typeof offer.relic === 'string' ? <ItemLootChoice kind="relic" id={offer.relic} disabled={lootPending}
        confirmLabel="claim this relic" onClick={() => dispatchLoot([{ kind: 'relicReward', choice: 'gain' }])} /> : null}
      {Array.isArray(offer.bossRelics) && offer.bossRelics.length > 1 ? <LootChoice disabled={lootPending}
        icon={<img src={assetPath('icons/relic.png')} alt="" />} onClick={() => setActiveRelic(true)}>
        Choose 1 of {offer.bossRelics.length} relics
      </LootChoice> : Array.isArray(offer.bossRelics) ? offer.bossRelics.map((relicId) => <ItemLootChoice kind="relic" id={relicId}
        key={relicId} disabled={lootPending} confirmLabel="claim this relic"
        onClick={() => dispatchLoot([{ kind: 'bossRelicReward', choice: 'gain', relicId }])} />)
      : null}
      {offer.cardReward && !cardChoicePending ? <LootChoice disabled={lootPending} onClick={() => {
        setActiveCard(true)
        if (offer.choices === null && !offer.prismatic) revealCards()
      }} icon={<CardRewardIcon rare={offer.cardSource === 'rare'} />}>Add a card to your deck.</LootChoice> : null}
      {offer.transformReward ? <LootChoice disabled={lootPending} onClick={() => setActiveTransform(true)}
        icon={<CardRewardIcon />}>Transform a card.</LootChoice> : null}
      {!hasLootChoice ? <p className="muted" role="status">Waiting for teammates…</p> : null}
    </div></div>
    {hasLootChoice ? <button className="reward-screen__skip" type="button" disabled={lootPending || waitingForTeammate}
      onClick={skipLoot}>{waitingForTeammate ? 'Waiting for teammate' : 'Skip'}</button> : null}
  </section>
}
