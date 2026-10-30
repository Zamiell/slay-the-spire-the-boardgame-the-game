import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CombatState } from '../game/combat.ts'
import { relicIconPath } from '../game/assets.ts'
import { effectText } from './Card.tsx'
import { combatDieBreakdown } from './combat-die-breakdown.ts'
import { enemyDieActionText } from './EnemyCard.tsx'
import { Icon, dieIcon } from './Icon.tsx'
import './styles/combat-die.css'

export function CombatDie({ state, viewerId }: { state: CombatState; viewerId: string }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const title = useId()
  const description = useId()
  const faces = useMemo(() => open ? combatDieBreakdown(state, viewerId) : [], [open, state, viewerId])
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  return <>
    <button ref={trigger} type="button" className="combat__die die-breakdown-trigger"
      aria-label={`Die ${state.die}: show all six outcomes`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>
      <Icon name={dieIcon(state.die)} size={26} />
    </button>
    {createPortal(<dialog ref={dialog} className="die-breakdown sts-scope"
      aria-labelledby={title} aria-describedby={description}
      onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }}>
      <header className="die-breakdown__header">
        <div>
          <h2 id={title}>Die breakdown</h2>
          <p id={description}>Current roll: {state.die}. Read-only: this does not reroll or activate anything.</p>
        </div>
        <button type="button" autoFocus aria-label="Close die breakdown" onClick={() => setOpen(false)}>Close</button>
      </header>
      <div className="die-breakdown__scroll">
        <p className="die-breakdown__hint">
          Current loadout and hand. Start-of-turn abilities are not replayed; optional abilities still require activation.
          Enemy values are before modifiers. Other conditions and limits still apply.
        </p>
        <div className="die-breakdown__faces">
          {faces.map(({ face, entries }) => <section key={face} className="die-breakdown__face"
            data-face={face} data-current={face === state.die} aria-label={`Roll ${face}`}>
            <h3><Icon name={dieIcon(face)} size={28} /><span>Roll {face}</span>
              {face === state.die ? <small>Current</small> : null}</h3>
            {entries.length === 0 ? <p className="muted">No die-dependent effects.</p> : null}
            {([
              ['Relics and Powers (start of turn)', entries.filter(entry => entry.kind === 'relic' || entry.kind === 'power')],
              ['Your cards (when played)', entries.filter(entry => entry.kind === 'card')],
              ['Enemy effects (printed values)', entries.filter(entry => entry.kind === 'enemy')],
            ] as const).map(([label, group]) => group.length > 0 ? <div key={label} className="die-breakdown__group">
              <h4>{label}</h4>
              <ul>{group.map(entry => <li key={entry.id} data-source={entry.id}>
                {entry.relicId ? <img src={relicIconPath(entry.relicId)} alt="" /> : null}
                <div>
                  <p><strong>{entry.name}</strong>
                    {state.players.length > 1 && entry.owner ? <span className="die-breakdown__owner"> · {entry.owner}</span> : null}
                    {entry.optional ? <span className="die-breakdown__note">Optional</span> : null}
                    {entry.used ? <span className="die-breakdown__note">Already used</span> : null}
                    {': '}{entry.text ?? (entry.actions ? enemyDieActionText(entry.actions)
                    : entry.effects?.map(effectText).join(', then ') || 'No effect on this face.')}</p>
                  {entry.target === 'row' ? <p className="die-breakdown__scope">Any row, including bosses.</p>
                    : entry.target === 'allEnemies' ? <p className="die-breakdown__scope">All enemies.</p> : null}
                  {entry.supportTarget === 'anyPlayer' ? <p className="die-breakdown__scope">Any player.</p> : null}
                  {entry.supportTarget === 'allPlayers' ? <p className="die-breakdown__scope">All players.</p> : null}
                  {entry.alternative ? <p className="die-breakdown__alternative">Alternative: {entry.alternative}</p> : null}
                </div>
              </li>)}</ul>
            </div> : null)}
          </section>)}
        </div>
      </div>
    </dialog>, document.body)}
  </>
}
