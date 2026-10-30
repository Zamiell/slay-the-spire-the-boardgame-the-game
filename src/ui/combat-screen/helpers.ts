// Reading the board for the screen: what a card still needs before it can be
// played, what a seat is called, and how the log reads.
//
// No components here and no hooks, and no reaching for state that was not passed
// in. `revealViewerRow` is the one that touches the DOM, because scrolling the
// board to the seat you control is a measurement rather than a render.
import type { CombatState } from '../../game/combat.ts'
import { remainingRoundHpLoss } from '../../game/combat.ts'
import { potionDef } from '../../game/relics.ts'
import type { Player } from '../../game/types.ts'
import { orbDisplayText } from '../TokenRow.tsx'

/** The engine's phase names are for the engine; players get words. */
export const PHASE_LABEL: Record<CombatState['phase'], string> = {
  player: 'Your turn',
  copy: 'Resolve original card',
  start: 'Start of turn',
  discard: 'Order discards',
  enemy: 'Enemies act',
  roundEnd: 'Round over',
  won: 'Victory',
  lost: 'Defeat',
}

/** Rows are the board's spatial unit: one per player, enemies sit in them. */
export function rowsOf(state: CombatState): number[] {
  const rows = new Set<number>()
  for (const player of state.players) rows.add(player.row)
  for (const enemy of state.enemies) if (!enemy.isBoss) rows.add(enemy.row)
  return [...rows].sort((a, b) => b - a)
}

export function revealViewerRow(board: HTMLElement | null, row: HTMLElement | null) {
  if (!board || !row) return
  const boardBox = board.getBoundingClientRect()
  const rowBox = row.getBoundingClientRect()
  board.scrollTop += rowBox.top - boardBox.top - (board.clientHeight - rowBox.height) / 2
  const seats = [...row.querySelectorAll<HTMLElement>('.row__seat')]
  const partySeats = [...board.querySelectorAll<HTMLElement>('.row__seat')]
    .filter((seat) => seat.querySelector('.seat'))
  const enemies = [...row.querySelectorAll<HTMLElement>('.enemy')]
  const bosses = [...board.querySelectorAll<HTMLElement>('.board__bosses .enemy:not(.enemy--dead)')]
  let actors = [...seats, ...(enemies.length > 0 ? enemies : bosses)]
  const span = (items: HTMLElement[]): [number, number] => {
    const boxes = items.map((actor) => actor.getBoundingClientRect())
    return [Math.min(...boxes.map((box) => box.left)), Math.max(...boxes.map((box) => box.right))]
  }
  const gutter = 8
  if (actors.length > 0 && seats.length > 0) {
    const [left, right] = span(actors)
    if (right - left > board.clientWidth - gutter * 2) {
      if (partySeats.length > 0) {
        const [partyLeft, partyRight] = span(partySeats)
        actors = partyRight - partyLeft <= board.clientWidth - gutter * 2 ? partySeats : seats
      } else {
        actors = seats
      }
    }
  }
  if (actors.length > 0) {
    const [left, right] = span(actors)
    const target = board.scrollLeft + left - boardBox.left - (board.clientWidth - (right - left)) / 2
    board.scrollLeft = Math.max(0, Math.min(Math.max(0, board.scrollWidth - board.clientWidth), target))
  }
}

/**
 * The seat button's accessible name.
 *
 * An `aria-label` replaces the element's contents wholesale, so anything not
 * named here is invisible to a screen reader no matter how it is marked up —
 * which is how the tokens' own hidden labels ended up unreachable. Everything
 * shown on the seat has to be listed.
 */
export function describeSeat(player: Player): string {
  const parts = [`${player.name}, ${player.hp} of ${player.maxHp} hit points, row ${player.row + 1}`]
  if (player.character === 'guardian' && player.guardianMode) {
    parts.push(`${player.guardianMode === 'attack' ? 'Attack' : 'Defense'} Mode`, `Vigor ${player.vigor}`)
  }
  const tokens: [string, number][] = [
    ['Block', player.block],
    ['Strength', player.strength],
    ['Vigor active this turn', player.vigorSpentThisTurn ?? 0],
    ['Vulnerable', player.vulnerable],
    ['Weak', player.weak],
    ['Shivs', player.shivs],
    ['Miracles', player.miracles],
    ['Claw cubes', player.clawCubesGainedThisCombat ?? 0],
  ]
  for (const [label, value] of tokens) if (value > 0) parts.push(`${label} ${value}`)
  if (player.strengthLossAtEndOfTurn > 0) {
    parts.push(`Strength loss at end of turn ${player.strengthLossAtEndOfTurn}`)
  }
  if (player.drawLocked) parts.push('cannot draw more cards this turn')
  if (player.cardPlayLocked) parts.push('cannot play additional cards this turn')
  if ((player.freeAttacksThisTurn ?? 0) > 0) parts.push('next Attack costs 0 this turn')
  if ((player.doubledAttacksThisTurn ?? 0) > 0) {
    parts.push(`Double Tap, next ${player.doubledAttacksThisTurn} Attack${player.doubledAttacksThisTurn === 1 ? '' : 's'} played twice`)
  }
  if ((player.tripledAttacksThisTurn ?? 0) > 0) {
    parts.push(`Blasphemy, next ${player.tripledAttacksThisTurn} Attack${player.tripledAttacksThisTurn === 1 ? '' : 's'} played three times`)
  }
  if ((player.doubledCardsThisTurn ?? 0) > 0) {
    parts.push(`Echo Form, next ${player.doubledCardsThisTurn} Attack or Skill card${
      player.doubledCardsThisTurn === 1 ? '' : 's'
    } played twice`)
  }
  if ((player.doubledSkillsThisTurn ?? 0) > 0) {
    parts.push(`Burst, next ${player.doubledSkillsThisTurn} Skill${player.doubledSkillsThisTurn === 1 ? '' : 's'} played twice`)
  }
  const hpLossRemaining = remainingRoundHpLoss(player)
  if (hpLossRemaining !== undefined) {
    parts.push(`${player.powers.some((power) => power.defId === 'wraith_form') ? 'Wraith Form' : 'Apparition'} protection, ${hpLossRemaining} hit point loss remaining this round`)
  }
  if (player.character === 'defect') {
    parts.push(`${player.orbs.filter(Boolean).length} of ${player.orbs.length} Orb slots occupied`)
  }
  for (const orb of player.orbs) if (orb) parts.push(`${orb} orb, ${orbDisplayText(player, orb)}`)
  if (player.potions.length > 0) parts.push(`potions ${potionDescription(player)}`)
  if (player.stance !== 'neutral') parts.push(`${player.stance} stance`)
  // Powers are deliberately NOT listed here. They render as a sibling list
  // outside this button, with their own labels — naming them here as well had
  // a screen reader announce every Power twice.
  if (player.dead) parts.push('defeated')
  return parts.join(', ')
}

function potionDescription(player: Player): string {
  return [...new Set(player.potions)].map((potionId) => {
    const count = player.potions.filter((held) => held === potionId).length
    const potion = potionDef(potionId)
    return `${potion.name}${count > 1 ? ` ×${count}` : ''}: ${potion.text}`
  }).join(', ')
}

/**
 * How far a card sits from the middle of the fan, from -1 to 1.
 *
 * A single card hangs straight; the spread narrows as the hand grows so a full
 * hand still fits the width it is given.
 */
export function fanOf(index: number, count: number): number {
  if (count < 2) return 0
  return (index - (count - 1) / 2) / ((count - 1) / 2)
}

export { canAfford,cardShivsOnPlay,gainedShivs,pendingFor,requirementsOf } from './card-play-requirements.ts'
