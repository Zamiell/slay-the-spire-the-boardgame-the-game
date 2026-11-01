import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { artToolchain, toolchainDifferences } from './lib/art-toolchain.mjs'

assert.deepEqual(toolchainDifferences({ ...artToolchain.versions }), [])
assert.deepEqual(toolchainDifferences({ ...artToolchain.versions, webp: 'different' }),
  [`webp: expected ${artToolchain.versions.webp}, found different`])
const missing = { ...artToolchain.versions }
delete missing.pillow
assert(toolchainDifferences(missing).some(message => message.endsWith('found unavailable')))
assert(/^docker\.io\/library\/ubuntu@sha256:[a-f0-9]{64}$/.test(artToolchain.baseImage), 'the audit base must be immutable')
assert(/^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/.test(artToolchain.nodeImage), 'the Node runtime must be immutable')
assert(/^\d{8}T\d{6}Z$/.test(artToolchain.aptSnapshot), 'APT dependencies must come from an immutable snapshot')
for (const [argument, status] of [['--help', 0], ['--unknown', 2], ['--runtime=docker', 2]]) {
  const result = spawnSync(process.execPath, ['scripts/art-audit.mjs', argument], { encoding: 'utf8' })
  assert.equal(result.status, status, 'usage handling must finish before probing or building the toolchain')
}
console.log('PASS artwork toolchain: immutable inputs and explicit codec mismatch detection')
