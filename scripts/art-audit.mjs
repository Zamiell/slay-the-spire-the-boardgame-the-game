#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { artToolchain, requireArtToolchain } from './lib/art-toolchain.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const usage = 'Usage: node scripts/art-audit.mjs [--check-toolchain] [--container] [--runtime=podman|docker]'
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage)
  process.exit(0)
}
const allowed = new Set(['--container', '--check-toolchain', '--runtime=podman', '--runtime=docker'])
const runtimeArgs = args.filter(arg => arg.startsWith('--runtime='))
if (args.some(arg => !allowed.has(arg)) || runtimeArgs.length > 1 || runtimeArgs.length && !args.includes('--container')) {
  console.error(usage)
  process.exit(2)
}
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

try {
  if (args.includes('--container')) {
    const runtime = args.find(arg => arg.startsWith('--runtime='))?.split('=')[1] ?? 'podman'
    const tag = `localhost/sts-art-audit:${createHash('sha256').update(JSON.stringify(artToolchain)).digest('hex').slice(0, 16)}`
    run(runtime, ['build', '--platform', artToolchain.platform, '--tag', tag,
      '--build-arg', `BASE_IMAGE=${artToolchain.baseImage}`,
      '--build-arg', `NODE_IMAGE=${artToolchain.nodeImage}`,
      '--build-arg', `APT_SNAPSHOT=${artToolchain.aptSnapshot}`,
      '--file', 'infra/art-audit.Containerfile', 'infra'])
    run(runtime, ['run', '--rm', '--platform', artToolchain.platform, '--network=none', '--read-only',
      '--tmpfs', '/tmp:rw,size=2g', '--mount', `type=bind,source=${root},target=/workspace,readonly`,
      tag, 'node', '--experimental-strip-types', 'scripts/art-audit.mjs',
      ...(args.includes('--check-toolchain') ? ['--check-toolchain'] : [])])
  } else {
    requireArtToolchain()
    console.log('Artwork toolchain matches infra/art-toolchain.json')
    if (!args.includes('--check-toolchain')) run(process.execPath, ['scripts/verify-all.mjs',
      '--lane=light', '--jobs=4', 'verify-art-bakes.mjs', 'verify-art-resolution.mjs',
      'verify-assets.mjs', 'verify-run-presentation.mjs', 'verify-upgrade-text.mjs', 'verify-wing-and-throw.mjs'])
  }
} catch (error) {
  console.error(error.message)
  console.error('Use node scripts/art-audit.mjs --container for the pinned, isolated toolchain; do not rebake assets with mismatched codecs.')
  process.exit(1)
}
