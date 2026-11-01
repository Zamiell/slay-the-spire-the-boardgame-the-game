import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Recheck newly exported pairs; the image tool derives corrections without card-specific rules. */
export function stabilizeUpgradeText(keys) {
  const pairs = [...new Set([...keys].map(key => key.replace(/\+$/, '')))].filter(key =>
    existsSync(join(root, 'public/assets/cards', `${key}.webp`)) &&
    existsSync(join(root, 'public/assets/cards', `${key}+.webp`)))
  if (pairs.length === 0) return
  const result = spawnSync('python3', ['scripts/art/stabilize-upgrade-text.py', '--write',
    ...pairs.flatMap(key => ['--key', key])], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error('Upgrade text normalization failed. It requires Tesseract (English), Pillow, and NumPy for skin compositing.')
}
