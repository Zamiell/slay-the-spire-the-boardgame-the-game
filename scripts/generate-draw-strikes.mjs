// Offline scan annotations; requires Tesseract (English) and Python Pillow. Skins preserve
// the original rules pixels, so their faces share these source-image coordinates.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { CARDS, faceOf } from '../src/game/cards.ts'
import '../src/game/downfall/slime-boss.ts'
import { cardImagePath } from '../src/game/assets.ts'
import { drawLockText } from '../src/ui/draw-lock-text.ts'
import { webpSize } from './lib/webp-size.mjs'

const execute = promisify(execFile)
const files = [...new Set(Object.values(CARDS).flatMap(def => [false, ...def.upgrade ? [true] : []]
  .filter(upgraded => /draw|fission|gamble/i.test(JSON.stringify(faceOf(def, upgraded))))
  .map(upgraded => `public${cardImagePath(def, upgraded)}`)
  .filter(file => existsSync(file)))),
  ...readdirSync('public/assets/cards-socketed-sm').filter(file => file.endsWith('.webp'))
    .map(file => `public/assets/cards-socketed-sm/${file}`)]
const annotations = {}
// Reviewed against the scans: OCR merges "a card" and misreads the Gem frame.
const reviewedLines = {
  'guardian__normal__opal': [[394, 840.5, 616]],
  'slayer__silent__heel-hook': [[375, 826, 613]],
  'slayer__silent__heel-hook+': [[375, 826, 613]],
}
let cursor = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < files.length) {
    const file = files[cursor++]
    const [width, height] = webpSize(file)
    const leftOffset = Math.floor(width * 0.11), topOffset = Math.floor(height * 0.58)
    const { stdout: image } = await execute('python3', ['-c', `
from PIL import Image, ImageChops
import sys
image = Image.open(sys.argv[1]).convert('RGB')
w, h = image.size
image = image.crop((int(w * .11), int(h * .58), int(w * .89), int(h * .92)))
r, g, b = image.split()
image = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda value: 0 if value > 170 else 255)
image = image.resize((image.width * 2, image.height * 2))
image.save(sys.stdout.buffer, 'PNG')
`, file], { encoding: 'buffer', maxBuffer: 1024 * 1024 })
    const recognition = execute('tesseract', ['stdin', 'stdout', '-l', 'eng', '--psm', '6', 'tsv'],
      { env: { ...process.env, OMP_THREAD_LIMIT: '1' }, maxBuffer: 1024 * 1024 })
    recognition.child.stdin.end(image)
    const { stdout } = await recognition
    const rows = stdout.trim().split('\n').slice(1).map(row => row.split('\t'))
    const page = rows.find(row => row[0] === '1')
    if (!page) throw new Error(`OCR did not return image dimensions: ${file}`)
    const words = rows.filter(row => row[0] === '5' && row[11]?.trim())
      .map(row => ({ line: row.slice(1, 5).join('-'), x: +row[6] / 2 + leftOffset,
        y: +row[7] / 2 + topOffset, w: +row[8] / 2, h: +row[9] / 2, text: row[11] }))
    let offset = 0
    const positioned = words.map(word => {
      const start = offset
      offset += word.text.length + 1
      return { ...word, start, end: offset - 1 }
    })
    const text = words.map(word => word.text).join(' ')
    const lines = []
    let at = 0
    for (const part of drawLockText(text)) {
      if (part.blocked) {
        const selected = positioned.filter(word => word.end > at && word.start < at + part.text.length)
        for (const id of new Set(selected.map(word => word.line))) {
          const line = selected.filter(word => word.line === id)
          const left = Math.min(...line.map(word => word.x))
          const right = Math.max(...line.map(word => word.x + word.w))
          const top = Math.min(...line.map(word => word.y))
          const bottom = Math.max(...line.map(word => word.y + word.h))
          lines.push([left, top + (bottom - top) * 0.55, right]
            .map(value => Math.round(value * 100) / 100))
        }
      }
      at += part.text.length
    }
    const key = basename(file, '.webp')
    annotations[key] = { size: [width, height], lines: reviewedLines[key] ?? lines }
  }
}))
writeFileSync('src/ui/card-draw-strikes.json',
  '{\n' + Object.entries(annotations).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n') + '\n}\n')
console.log(`Annotated ${Object.keys(annotations).length} of ${files.length} card scans`)
