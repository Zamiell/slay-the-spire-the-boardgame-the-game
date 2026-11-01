import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const result = spawnSync('python3', ['scripts/art/verify-upgrade-text.py'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
})
assert.equal(result.status, 0, result.stderr || result.error?.message || 'Upgrade text verification failed')
process.stdout.write(result.stdout)
console.log('PASS generic upgrade-layout matching, safe patching, thumbnails and skin variants')
