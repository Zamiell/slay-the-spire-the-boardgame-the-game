import { PotionTooltipAnchor } from './PotionIcon.tsx'
import './styles/incoming-damage.css'

export function IncomingDamage({ name, damage, block }: { name: string; damage: number | undefined; block: number }) {
  const tone = damage === undefined ? 'pending' : damage > 0 ? 'damage' : 'clear'
  return <PotionTooltipAnchor id="incoming-damage" className={`seat__incoming-damage seat__incoming-damage--${tone}`}
    focusable name={`${name}: incoming unblocked damage ${damage ?? 'pending'}`} kindLabel="Enemy attack estimate"
    text={damage === undefined
      ? 'Finish start-of-turn ordering or the current card choice to calculate incoming attack damage.'
      : `${damage} damage gets past your current ${block} Block from enemy attacks this turn. Includes attack order, Strength, Weak, Vulnerable, multi-hits, and row/Facing targets. This is before end-of-turn effects and HP-loss prevention such as Buffer, not a prediction of final HP. Damage is not capped at your remaining HP.`}>
    <span aria-hidden="true">Incoming: <strong>{damage ?? '?'}</strong></span>
  </PotionTooltipAnchor>
}
