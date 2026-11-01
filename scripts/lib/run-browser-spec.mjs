import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { browserOutputDirectory } from './verification-output.mjs'
import { verifierMetadata } from './verifier-registry.mjs'

export function runBrowserSpec(spec) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const name = basename(fileURLToPath(spec), '.spec.mjs')
  const metadata = verifierMetadata(`verify-${name}-browser.mjs`, root)
  if (metadata.output !== 'invocation') throw new Error(`Unregistered Playwright fixture: ${name}`)
  const output = browserOutputDirectory(root, name)
  console.log(`Browser artifacts: ${output}`)
  const result = spawnSync(command, ['exec', 'playwright', 'test',
    '--config', fileURLToPath(new URL('../playwright.config.mjs', import.meta.url)),
    '--output', output, fileURLToPath(spec)],
  { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
