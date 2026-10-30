import { PotionTooltipAnchor } from './PotionIcon.tsx'
import './styles/incoming-damage.css'

export function IncomingDamage({ name, damage, block, wrath }: {
  name: string; damage: number | undefined; block: number; wrath: boolean
}) {
  const tone = damage === undefined ? 'pending' : damage > 0 ? 'damage' : 'clear'
  return <PotionTooltipAnchor id="incoming-damage" className={`seat__incoming-damage seat__incoming-damage--${tone}`}
    focusable name={`${name}: incoming unblocked damage ${damage ?? 'pending'}`} kindLabel="Incoming damage estimate"
    text={damage === undefined
      ? 'Finish start-of-turn ordering or the current card choice to calculate incoming damage.'
      : `${damage} damage gets past your current ${block} Block from enemy attacks${wrath ? ' and Wrath' : ''} this turn. ${
        wrath ? `Wrath adds 1 damage before enemy attacks; your current Block absorbs ${Math.min(1, block)} of it. ` : ''
      }Includes attack order, Strength, Weak, Vulnerable, multi-hits, and row/Facing targets. Other end-of-turn effects and HP-loss prevention such as Buffer are not included; this is not a prediction of final HP. Damage is not capped at your remaining HP.`}>
    <span aria-hidden="true">Incoming: <strong>{damage ?? '?'}</strong></span>
  </PotionTooltipAnchor>
}
