import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function runBrowserSpec(spec) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, ['exec', 'playwright', 'test',
    '--config', fileURLToPath(new URL('../playwright.config.mjs', import.meta.url)), fileURLToPath(spec)],
  { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
