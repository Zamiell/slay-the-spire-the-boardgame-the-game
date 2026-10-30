import { drawLockText } from './draw-lock-text.ts'

/** Emphasis on native faces; the underlying rules remain exact data text. */
export function KeywordText({ text, drawLocked = false }: { text: string; drawLocked?: boolean }) {
  if (drawLocked) return <span>{drawLockText(text).map((part, index) => part.blocked
    ? <s className="card__blocked-draw" key={index}><KeywordText text={part.text} /></s>
    : <span key={index}><KeywordText text={part.text} /></span>)}</span>
  return <span>{text.split(/\b(Block|Weak|Vulnerable|Strength|Energy|Exhaust|Retain|Ethereal|Scry|Poison|Miracles?|Shivs?|Attacks?|Skills?|Powers?)\b/gi)
    .map((part, index) => index % 2
      ? <strong className="rules-keyword" key={index}>{part}</strong>
      : part)}</span>
}
