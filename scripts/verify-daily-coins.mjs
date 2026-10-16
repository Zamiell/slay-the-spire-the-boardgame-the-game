// Daily history is paid at server startup, through the same durable wallet as HTTP purchases.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRoomServer } from './room-server.mjs'
import { createStore, saveStore } from './lib/rooms.mjs'
import { addLeaderboardRun } from './lib/leaderboard.mjs'
import { createWallet } from '../src/wallet.ts'

const directory = mkdtempSync(join(tmpdir(), 'sts-daily-coins-'))
const file = join(directory, 'rooms.json')
const account = (username, wallet) => ({ username, token: crypto.randomUUID(), ...(wallet ? { wallet, walletImports: [], walletPaid: {} } : {}) })
const ann = account('Ann', { ...createWallet(), coins: 100, packs: ['slayer_defect'], skins: ['kratos'] })
const bo = account('Bo')
const untouched = account('Unrelated', { ...createWallet(), coins: 13 })
const zero = account('NoBosses')
const store = createStore({ file })
store.coinsLaunchedAt = Date.parse('2026-10-01T00:00:00Z')
store.profiles.push(ann, bo, untouched, zero)
store.coinGrants.push({ username: 'bo', coins: 17, grantId: 'ef'.repeat(16), claimId: null, claimedAt: null })
const add = (id, username, highestBossActDefeated, day = '2026-10-09', extra = {}) => addLeaderboardRun(store, {
  id: `daily-coins-${id}`, username, character: 'ironclad', ascension: 10, mode: 'daily', dailyDate: day, startedAtAct: 1,
  highestBossActDefeated, combatsFinished: 8, damageDealt: 50, damageTaken: 10, damageBlocked: 20, floorsCleared: 30, ...extra,
}, Date.parse(`${day}T12:00:00Z`))
add('ann-win', 'ＡＮＮ', 3)
saveStore(store) // Archive plus journal must merge the same run only once.
add('ann-retry', 'ann', 1)
add('bo', 'Bo', 1, '2026-10-10')
add('zero', 'NoBosses', 0)
add('anonymous', undefined, 4)
add('standard', 'Ann', 4, '2026-10-09', { mode: 'standard', dailyDate: undefined })
add('undated', 'Ann', 3, '2026-10-09', { dailyDate: undefined })
saveStore(store)
let service
let failSaves = false
const start = async () => {
  service = createRoomServer({ storeFile: file, onSaveError: () => {}, saveStoreImpl: (value) => {
    if (failSaves) throw new Error('disk full')
    saveStore(value)
  } })
  const { port } = await service.listen(0)
  return `http://127.0.0.1:${port}`
}
let origin
const request = async (profile, body = {}) => {
  const response = await fetch(`${origin}/api/profile/wallet`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: profile.token, ...body }) })
  return { status: response.status, body: await response.json() }
}
try {
  failSaves = true
  await assert.rejects(start, /disk full/, 'startup must stop if the history cannot be saved')
  const unpaid = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(unpaid.profiles.find((profile) => profile.username === 'Ann').wallet.coins, 100)
  assert.equal(unpaid.profiles.find((profile) => profile.username === 'Ann').dailyCoinsEarned, undefined)
  failSaves = false
  origin = await start()
  const first = await request(ann)
  assert.equal(first.status, 200)
  assert.equal(first.body.wallet.coins, 598, 'two recorded climbs owe 429 + 69 at A10, in addition to the existing 100')
  assert.deepEqual(first.body.wallet.packs, ['slayer_defect'])
  assert.deepEqual(first.body.wallet.skins, ['kratos'])
  assert.equal((await request(bo)).body.wallet.coins, 85, 'a new wallet preserves its legacy 17 and receives the daily 68')
  assert.equal((await request(untouched)).body.wallet.coins, 13)
  assert.equal((await request(zero)).body.wallet.coins, 0, 'no boss earns no coins')
  const receipt = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(receipt.profiles.find((profile) => profile.username === 'Ann').wallet.coins, 598)
  assert.equal(receipt.profiles.find((profile) => profile.username === 'Ann').dailyCoinsEarned, 498)
  // Imports from old and refreshed devices retain the separate history bonus.
  const migration = { id: crypto.randomUUID(), wallet: { ...createWallet(), coins: 100, packs: ['slayer_defect'], skins: ['kratos'] } }
  assert.equal((await request(ann, { migration })).body.wallet.coins, 598)
  assert.equal((await request(ann, { migration })).body.wallet.coins, 598)
  const dormant = { ...migration, id: crypto.randomUUID(), wallet: { ...migration.wallet, coins: 1000 } }
  const imported = await request(ann, { migration: dormant })
  assert.equal(imported.body.wallet.coins, 1498, 'a larger old browser wallet absorbed the daily bonus')
  const refreshed = { id: crypto.randomUUID(), wallet: imported.body.wallet }
  assert.equal((await request(ann, { migration: refreshed })).body.wallet.coins, 1498, 'a refreshed wallet imported its bonus twice')
  await service.close()
  origin = await start()
  assert.equal((await request(ann)).body.wallet.coins, 1498, 'restart paid the same history twice')
  assert.equal((await request(bo)).body.wallet.coins, 85)
  await service.close()
  // Previous releases drop unfamiliar wallet fields but preserve raw profile receipts.
  const rolledBack = createStore({ file })
  for (const profile of rolledBack.profiles) if (profile.wallet) delete profile.wallet.dailyCoinsEarned
  saveStore(rolledBack)
  origin = await start()
  assert.equal((await request(ann)).body.wallet.coins, 1498, 'redeployment after rollback paid history twice')
  assert.equal((await request(bo)).body.wallet.coins, 85)
  const submit = async (id, extra = {}, token = ann.token) => {
    const response = await fetch(`${origin}/api/leaderboard`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...store.leaderboardRuns.find((run) => run.id === 'daily-coins-ann-win'),
        id, profileToken: token, highestBossActDefeated: 1, ...extra }) })
    return { status: response.status, body: await response.json() }
  }
  // An old tab records a climb after deployment, with no award list.
  const late = await Promise.all([submit('daily-coins-late'), submit('daily-coins-late')])
  assert(late.every((reply) => [200, 201].includes(reply.status)))
  assert.equal((await request(ann)).body.wallet.coins, 1567, 'an old client recorded after deployment missed its 69 coins')
  assert.equal((await submit('daily-coins-late', {}, bo.token)).status, 200)
  assert.equal((await request(bo)).body.wallet.coins, 85, 'another account claimed an existing result')
  assert.equal((await submit('daily-coins-resumed', { highestBossActDefeated: 2, dailyBossActs: [2] })).status, 201)
  assert.equal((await request(ann)).body.wallet.coins, 1789, 'a resumed climb lost the boss beaten before the update')
  assert.equal((await submit('daily-coins-bloom', { highestBossActDefeated: 3, dailyBossActs: [1, 2, 1, 3] })).status, 201)
  assert.equal((await request(ann)).body.wallet.coins, 2339, 'the recorded Mind Bloom boss lost its normal 95-coin roll')
  assert.equal((await submit('daily-coins-invalid', { dailyBossActs: [0] })).status, 400)
  await service.close()
  origin = await start()
  assert.equal((await submit('daily-coins-resumed-bloom', { highestBossActDefeated: 3, dailyBossActs: [2, 1, 3] })).status, 201)
  assert.equal((await request(ann)).body.wallet.coins, 2889, 'resuming before Mind Bloom lost the earlier Act I boss or shifted its rolls')
  failSaves = true
  assert.equal((await submit('daily-coins-save-retry')).status, 503, 'an unsaved new payout was acknowledged')
  failSaves = false
  assert.equal((await submit('daily-coins-save-retry')).status, 200)
  assert.equal((await request(ann)).body.wallet.coins, 2958)
  const paid = JSON.parse(readFileSync(file, 'utf8')).profiles.find((profile) => profile.username === 'Ann')
  assert.equal(paid.wallet.coins, 2958)
  assert.equal(paid.dailyCoinsEarned, 1958)
  assert.equal((await submit('daily-coins-standard', { dailyBossActs: [1, 2, 3, 4] })).status, 200)
  await service.close()
  origin = await start()
  assert.equal((await request(ann)).body.wallet.coins, 2958, 'restart duplicated a new recorded climb')
  assert.equal(service.store.leaderboardRuns.find((run) => run.id === 'daily-coins-standard')?.mode, 'standard',
    'a Daily retry corrupted an existing standard result')
  console.log('Daily coins: history, repeated climbs, identity, existing/new wallets, old clients, resumed climbs, Mind Bloom, save failure and rollback/restart idempotency passed')
} finally {
  failSaves = false
  await service?.close()
  rmSync(directory, { recursive: true, force: true })
}
