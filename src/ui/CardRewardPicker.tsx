import { useState, type CSSProperties } from 'react'
import { assetPath } from '../game/assets.ts'
import { cardDef } from '../game/cards.ts'
import { Card } from './Card.tsx'
import { RewardChoiceScreen } from './RewardChoiceScreen.tsx'

type Props = {
  choices: readonly string[]
  upgraded?: boolean
  disabled?: boolean
  uidPrefix?: string
  title?: string
  description?: string
  skipDisabled?: boolean
  skipLabel?: string
  style?: CSSProperties
  onChoose: (index: number) => void
  onSkip?: () => void
}

/** The shared full-screen choice surface for Card Rewards and mandatory Guardian Gems. */
export function CardRewardPicker({
  choices, upgraded = false, disabled = false, uidPrefix = 'card-reward',
  title = 'Choose a Card', description, skipDisabled = false, skipLabel = 'Skip', style, onChoose, onSkip,
}: Props) {
  const [viewUpgrades, setViewUpgrades] = useState(false)
  const rewardKey = `${uidPrefix}:${upgraded}:${choices.join(',')}`
  const pickerStyle = { ...style, '--reward-card-count': Math.max(choices.length, 1) } as CSSProperties
  return <RewardChoiceScreen title={title} description={description} choiceKey={rewardKey} style={pickerStyle}
    disabled={disabled}>
    <div className="reward-screen__cards" onTransitionEnd={(event) => {
      if (event.propertyName === 'transform' && event.target instanceof HTMLElement && event.target.classList.contains('card')) {
        event.target.dispatchEvent(new Event('card-keyword-help-ready', { bubbles: true }))
      }
    }}>
      {choices.map((defId, index) => <Card key={`${defId}-${index}`}
        card={{ uid: `${uidPrefix}-${index}`, defId, upgraded: upgraded || viewUpgrades && Boolean(cardDef(defId).upgrade) }} playable={!disabled}
        hoverHelp={!disabled}
        tabIndex={disabled ? -1 : undefined}
        onClick={() => !disabled && onChoose(index)} />)}
    </div>
    {onSkip ? <button className="reward-screen__skip" type="button" disabled={disabled || skipDisabled} onClick={onSkip}>{skipLabel}</button> : null}
    {choices.some((defId) => cardDef(defId).upgrade) ? <label className="reward-screen__view-upgrades">
      <input type="checkbox" checked={viewUpgrades} disabled={disabled}
        onChange={(event) => setViewUpgrades(event.target.checked)} /> View Upgrades
    </label> : null}
  </RewardChoiceScreen>
}

export function CardRewardIcon({ rare = false }: { rare?: boolean }) {
  return <img src={assetPath(`icons/${rare ? 'rare-' : ''}card-reward.png`)} alt="" />
}
