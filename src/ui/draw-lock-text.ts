export type DrawTextPart = { text: string; blocked: boolean }

/** Match drawing instructions, not draw-pile references or the prohibition itself. */
export function drawLockText(text: string): DrawTextPart[] {
  const parts: DrawTextPart[] = []
  const pattern = /\bdraw\s+(?!piles?\b)(?:until\s+you\s+have\s+[^,.;\n]*?\bcards?\s+in\s+hand|(?:[^,.;\n]*?\s+)?cards?\b)/gi
  let end = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index
    if (/\b(?:cannot|can['’]t|do not|don['’]t)\s*$/i.test(text.slice(0, at))) continue
    if (at > end) parts.push({ text: text.slice(end, at), blocked: false })
    parts.push({ text: match[0], blocked: true })
    end = at + match[0].length
  }
  if (end < text.length) parts.push({ text: text.slice(end), blocked: false })
  return parts
}
