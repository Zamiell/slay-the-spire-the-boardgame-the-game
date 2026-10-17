import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { validateSessionConfig } from './validate-session-config.mjs'

const workflow = readFileSync(new URL('../.github/workflows/pages-deploy.yml', import.meta.url), 'utf8')
assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1[\s\S]*?with:[\s\S]*?persist-credentials: false/)
assert.match(workflow, /workflow_call:/)
assert.match(workflow, /workflow_dispatch:/)
assert.match(workflow, /node-version: 24/)
assert.match(workflow, /VITE_ASSET_CDN_ORIGIN="https:\/\/raw\.githubusercontent\.com\/\$GITHUB_REPOSITORY\/\$DEPLOY_SHA\/public\/assets" VITE_ASSET_BACKUP_ORIGIN="https:\/\/raw\.githubusercontent\.com\/\$GITHUB_REPOSITORY\/\$DEPLOY_SHA\/public\/assets" VITE_SINGLE_PLAYER=false VITE_HOSTED_SESSION=true pnpm build/)
assert.match(workflow, /find dist\/assets\/combat\/rigged -type f -name '\*\.mov' -delete/)
assert.match(workflow, /find dist\/assets\/bgm -type f -delete/)
assert.match(workflow, /for file in camp\.webp rest\.webp smith\.webp sitters\/ironclad\.webp; do test -s/)
assert.match(workflow, /hero-defect-idle\.mov[\s\S]*content-type: video\/quicktime/)
assert.match(workflow, /exordium\.mp3[\s\S]*content-type: audio\/mpeg/)
assert.match(workflow, /du -sb dist[\s\S]*-le 900000000/)
assert.match(workflow, /MULTIPLAYER_SERVER_ORIGIN\/api\/health/)
assert.match(workflow, /\.webSocketActionAcks == true/)
assert.match(workflow, /\.releaseSha == \$sha/)
assert.match(workflow, /validate-session-config\.mjs/)
assert.match(workflow, /actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6\.0\.0/)
assert.match(workflow, /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5\.0\.0/)
assert.match(workflow, /actions\/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5\.0\.1/)
assert.doesNotMatch(workflow, /push:\s+branches:/)
assert.doesNotMatch(workflow, /artifact_name|source_run_id|handoff|trycloudflare|pyjam/i)

const previousCdn = process.env.VITE_ASSET_CDN_ORIGIN
const previousBackup = process.env.VITE_ASSET_BACKUP_ORIGIN
const cdn = 'https://cdn.example/public/assets'
const backupOrigin = 'https://raw.githubusercontent.com/example/game/sha/public/assets'
process.env.VITE_ASSET_CDN_ORIGIN = cdn
process.env.VITE_ASSET_BACKUP_ORIGIN = backupOrigin
const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
try {
  const { assetPath } = await vite.ssrLoadModule('/src/game/assets.ts')
  assert.equal(assetPath('noncombat/campfire/camp.webp'), '/assets/noncombat/campfire/camp.webp')
  assert.equal(assetPath('noncombat/campfire/sitters/kratos.webp'), '/assets/noncombat/campfire/sitters/kratos.webp')
  assert.equal(assetPath('noncombat/campfire/rest.webp'), '/assets/noncombat/campfire/rest.webp')
  assert.equal(assetPath('noncombat/campfire/smith.webp'), '/assets/noncombat/campfire/smith.webp')
  assert.equal(assetPath('bgm/exordium.mp3'), `${cdn}/bgm/exordium.mp3`)
  assert.equal(assetPath('cards/strike.webp'), '/assets/cards/strike.webp')
  assert.equal(assetPath('combat/rigged/hero-defect-idle.webp'), `${backupOrigin}/combat/rigged/hero-defect-idle.webp`)
  assert.equal(assetPath('combat/rigged/jaw_worm-idle.webp'), '/assets/combat/rigged/jaw_worm-idle.webp')
  assert.equal(assetPath('combat/rigged/hero-defect-attack.webp'), '/assets/combat/rigged/hero-defect-attack.webp')
} finally {
  await vite.close()
  if (previousCdn === undefined) delete process.env.VITE_ASSET_CDN_ORIGIN
  else process.env.VITE_ASSET_CDN_ORIGIN = previousCdn
  if (previousBackup === undefined) delete process.env.VITE_ASSET_BACKUP_ORIGIN
  else process.env.VITE_ASSET_BACKUP_ORIGIN = previousBackup
}

const stableOrigin = 'https://sts-94-239-51-8.2001-861-388c-4ee0-c3d5-2f30-1be7-2e79.sslip.io:18443'
const sha = 'a'.repeat(40)
for (const [config, accepted] of [
  [{ protocolVersion: 1, sha, runId: '12', origin: stableOrigin, alwaysOn: true }, true],
  [{ protocolVersion: 1, sha, runId: '12', origin: 'https://abc123.tunnel.pyjam.as', alwaysOn: true }, false],
  [{ protocolVersion: 1, sha, runId: '12', origin: stableOrigin, origins: [stableOrigin], alwaysOn: true }, false],
  [{ protocolVersion: 1, sha, runId: '12', sourceRunId: '11', origin: stableOrigin, alwaysOn: true }, false],
  [{ protocolVersion: 1, sha, runId: '12', origin: stableOrigin, alwaysOn: false }, false],
  [{ protocolVersion: 2, sha, runId: '12', origin: stableOrigin, alwaysOn: true }, false],
  [{ protocolVersion: 1, sha: 'b'.repeat(40), runId: '12', origin: stableOrigin, alwaysOn: true }, false],
  [{ protocolVersion: 1, sha, runId: 12, origin: stableOrigin, alwaysOn: true }, false],
]) {
  let valid = true
  try { validateSessionConfig(config, { sha, stableOrigin }) } catch { valid = false }
  assert.equal(valid, accepted, JSON.stringify(config))
}

console.log('✓ Pages publishes only the stable always-on multiplayer origin')
