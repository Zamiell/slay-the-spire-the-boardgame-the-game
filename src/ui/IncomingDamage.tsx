import { PotionTooltipAnchor } from './PotionIcon.tsx'
import type { IncomingDamagePreview } from '../game/combat.ts'
import './styles/incoming-damage.css'

export function IncomingDamage({ name, preview, block, wrath, startOfTurn = false }: {
  name: string; preview: IncomingDamagePreview | undefined; block: number; wrath: boolean; startOfTurn?: boolean
}) {
  const damage = preview?.damage
  const wasted = preview?.wastedBlock ?? 0
  const tone = damage === undefined ? 'pending' : damage > 0 ? 'damage' : 'clear'
  return <PotionTooltipAnchor id="incoming-damage" className={`seat__incoming-damage seat__incoming-damage--${tone}`}
    focusable name={`${name}: incoming unblocked damage ${damage ?? 'pending'}${wasted > 0 ? `; ${wasted} excess Block` : ''}`} kindLabel="Incoming damage estimate"
    text={damage === undefined
      ? 'Waiting for the shared die roll or a pending effect to finish before calculating incoming damage.'
      : `${startOfTurn ? 'Based on the current die and board. Remaining start-of-turn choices can change this estimate. ' : ''
      }${damage} damage gets past your current ${block} Block from enemy attacks${wrath ? ' and Wrath' : ''} this turn. ${
        wrath ? `Wrath adds 1 damage before enemy attacks; your current Block absorbs ${Math.min(1, block)} of it. ` : ''
      }${wasted > 0 ? `(+${wasted}) means ${wasted} excess Block would go unused and be lost when Block resets. ` : ''
      }Includes Poison before attacks and Wrath, Poison death effects, attack order, Strength, Weak, Vulnerable, multi-hits, and row/Facing targets. Other end-of-turn effects and HP-loss prevention such as Buffer are not included; this is not a prediction of final HP. Damage is not capped at your remaining HP.`}>
    <span aria-hidden="true">Incoming: <strong>{damage ?? 'pending'}</strong>{wasted > 0 ? ` (+${wasted})` : ''}</span>
  </PotionTooltipAnchor>
}
