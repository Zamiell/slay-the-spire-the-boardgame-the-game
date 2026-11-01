import { PotionTooltipAnchor } from './PotionIcon.tsx'
import type { IncomingDamagePreview } from '../game/combat.ts'
import './styles/incoming-damage.css'

export function IncomingDamage({ name, preview, block, wrath, startOfTurn = false }: {
  name: string; preview: IncomingDamagePreview | undefined; block: number; wrath: boolean; startOfTurn?: boolean
}) {
  const damage = preview?.damage
  const wasted = preview?.wastedBlock ?? 0
  const frostBlock = preview?.frostBlock ?? 0
  const tone = damage === undefined ? 'pending' : damage > 0 ? 'damage' : 'clear'
  return <PotionTooltipAnchor id="incoming-damage" className={`seat__incoming-damage seat__incoming-damage--${tone}`}
    focusable name={`${name}: incoming unblocked damage ${damage ?? 'pending'}${wasted > 0 ? `; ${wasted} excess Block` : ''}`} kindLabel="Incoming damage estimate"
    text={damage === undefined
      ? 'Waiting for the shared die roll or a pending effect to finish before calculating incoming damage.'
      : `${startOfTurn ? 'Based on the current die and board. Remaining start-of-turn choices can change this estimate. ' : ''
      }${damage} incoming damage/HP loss after accounting for your current ${block} Block${frostBlock > 0 ? ` plus ${frostBlock} Block from Frost Orbs` : ''
      }, from enemy attacks, visible cards remaining in hand${wrath ? ', and Wrath' : ''} this turn. ${
        wrath ? 'Wrath adds 1 blockable damage before enemy attacks. ' : ''
      }${wasted > 0 ? `(+${wasted}) means ${wasted} excess Block would go unused and be lost when Block resets. ` : ''
      }Includes Poison before attacks, Wrath, Poison death effects, Frost Orb passive Block with current bonuses and the Block cap, hand effects such as Burn, Decay, Pain, Shame, and enemy-induced Slimed HP loss, attack order, Strength, Weak, Vulnerable, multi-hits, and row/Facing targets. Block is shared across hand damage, Wrath, and enemy attacks in the planned end-of-turn order; direct HP loss bypasses Block. Other end-of-turn effects (including Exhaust-triggered draws) and HP-loss prevention such as Buffer are not included; this is not a prediction of final HP. Damage is not capped at your remaining HP.`}>
    <span aria-hidden="true">Incoming: <strong>{damage ?? 'pending'}</strong>{wasted > 0 ? ` (+${wasted})` : ''}</span>
  </PotionTooltipAnchor>
}
