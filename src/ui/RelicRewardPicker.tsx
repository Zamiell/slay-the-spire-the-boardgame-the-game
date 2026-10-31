import { useId } from 'react'
import type { CSSProperties } from 'react'
import { relicDef } from '../game/relics.ts'
import { ItemImage } from './ItemImage.tsx'
import { RewardChoiceScreen } from './RewardChoiceScreen.tsx'
import './styles/relic-reward-picker.css'

export function RelicRewardPicker({ choices, style, disabled = false, skipDisabled = false, onChoose, onSkip, onBack }: {
  choices: readonly string[]
  style?: CSSProperties
  disabled?: boolean
  skipDisabled?: boolean
  onChoose: (id: string) => void
  onSkip: () => void
  onBack: () => void
}) {
  const titleId = useId()
  return <RewardChoiceScreen title="Choose a Relic" className="relic-reward" style={style}
    choiceKey={choices.join(',')} disabled={disabled} onBack={onBack}>
    <div className="reward-screen__cards">
      {choices.map((id, index) => {
        const def = relicDef(id)
        const descriptionId = `${titleId}-${index}`
        return <button type="button" className="relic-reward__choice" key={`${id}-${index}`}
          disabled={disabled} aria-label={def.name} aria-describedby={descriptionId} onClick={() => onChoose(id)}>
          <ItemImage kind="relic" id={id} card />
          <span id={descriptionId} className="visually-hidden">{def.text}</span>
        </button>
      })}
    </div>
    <button className="reward-screen__skip" type="button" disabled={disabled || skipDisabled} onClick={onSkip}>Skip</button>
    <button className="relic-reward__back ribbon-back" type="button" aria-label="Back to loot"
      disabled={disabled} onClick={onBack}><span aria-hidden="true" /></button>
  </RewardChoiceScreen>
}
