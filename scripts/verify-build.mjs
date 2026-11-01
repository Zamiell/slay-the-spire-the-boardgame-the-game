#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createBuildOutput } from './lib/verification-output.mjs'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const output = createBuildOutput(fileURLToPath(new URL('../', import.meta.url)))
try {
  for (const args of [
    ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'],
    ['build'],
  ]) {
    const result = spawnSync(pnpm, args, { stdio: 'inherit', env: { ...process.env, STS_VERIFY_BUILD_DIR: output } })
    if (result.error) throw result.error
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
} finally {
  rmSync(output, { recursive: true, force: true })
}
if (process.exitCode) process.exit(process.exitCode)
console.log('✓ dependency lock and production build passed')
