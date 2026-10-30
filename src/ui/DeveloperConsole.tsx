import { useEffect, useRef, useState } from 'react'
import { consoleCompletions, ConsoleCommandError } from './developer-commands.ts'
import './styles/developer-console.css'

type Entry = { command: string; output: string; error: boolean }

export function DeveloperConsole({ modified, onExecute }: {
  modified: boolean
  onExecute: (command: string) => string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const output = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const history = useRef<string[]>([])
  const cursor = useRef(0)
  const draft = useRef('')
  const completion = useRef<{ options: string[]; index: number } | null>(null)
  const close = () => {
    dialog.current?.close()
    setOpen(false)
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey ||
        !(event.code === 'Backquote' || event.key === '`')) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!open && (target?.closest('input, textarea, select, [role="textbox"]') || target?.isContentEditable)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (open) close()
      else {
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        dialog.current?.showModal()
        setOpen(true)
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [open])
  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight
  }, [entries, open])

  const submit = () => {
    const command = text.trim()
    if (!command) return
    let response: string
    let error = false
    try { response = onExecute(command) }
    catch (failure) {
      error = true
      if (failure instanceof ConsoleCommandError) response = failure.message
      else {
        console.error('Developer console command failed', failure)
        response = 'The command failed unexpectedly. The run was not changed; see the browser error log.'
      }
    }
    if (!error && command.toLowerCase() === 'clear') setEntries([])
    else setEntries(current => [...current.slice(-99), { command, output: response, error }])
    history.current = [...history.current.slice(-99), command]
    cursor.current = history.current.length
    draft.current = ''
    completion.current = null
    setText('')
    input.current?.focus()
  }
  const suggestions = text ? consoleCompletions(text).slice(0, 6) : []
  return <dialog ref={dialog} className="developer-console" aria-labelledby="developer-console-title"
    onCancel={event => { event.preventDefault(); close() }}
    onKeyDown={event => event.stopPropagation()}>
    <header>
      <h2 id="developer-console-title">Developer console</h2>
      <button type="button" onClick={close} aria-label="Close console">Close (` / Esc)</button>
    </header>
    <p className="developer-console__warning">
      {modified ? 'Console run: unranked.' : 'State-changing commands make this run unranked.'}
      {' '}No leaderboard entry, account Coins, or campaign progress. Local runs only.
    </p>
    <div ref={output} className="developer-console__output" role="log" aria-label="Console output" aria-live="polite">
      <p>Type help for commands, list cards/relics/potions for IDs. Names are case-insensitive.
        {' '}Tab completes; Up/Down recalls commands. Board-game limits apply.</p>
      {entries.map((entry, index) => <div key={index} data-error={entry.error || undefined}>
        <div className="developer-console__command">&gt; {entry.command}</div>
        <pre>{entry.output}</pre>
      </div>)}
    </div>
    <form onSubmit={event => { event.preventDefault(); submit() }}>
      <label className="visually-hidden" htmlFor="developer-console-input">Console command</label>
      <input ref={input} id="developer-console-input" autoComplete="off" autoCapitalize="off" spellCheck={false}
        value={text} placeholder="help" maxLength={300}
        onChange={event => { setText(event.target.value); completion.current = null; cursor.current = history.current.length }}
        onKeyDown={event => {
          if (event.key === 'Tab' && !event.shiftKey) {
            const candidates = completion.current ?? { options: consoleCompletions(text), index: -1 }
            if (!candidates.options.length) return
            event.preventDefault()
            candidates.index = (candidates.index + 1) % candidates.options.length
            completion.current = candidates
            setText(candidates.options[candidates.index]!)
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (cursor.current === history.current.length) draft.current = text
            cursor.current = Math.max(0, Math.min(history.current.length,
              cursor.current + (event.key === 'ArrowUp' ? -1 : 1)))
            setText(history.current[cursor.current] ?? draft.current)
            completion.current = null
          }
        }} />
      <button type="submit">Run command</button>
    </form>
    {suggestions.length ? <nav className="developer-console__suggestions" aria-label="Command suggestions">
      {suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => {
        setText(suggestion); completion.current = null; input.current?.focus()
      }}>{suggestion}</button>)}
    </nav> : null}
  </dialog>
}
