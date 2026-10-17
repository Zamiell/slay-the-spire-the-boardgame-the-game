import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRoomServer } from './room-server.mjs'
import { createStore, saveStore } from './lib/rooms.mjs'

// Recovering from quota must read another tab's newer journal before applying a remote unlock.
{
  const { createCampaignProgress } = await import('../src/game/campaign.ts')
  const { CAMPAIGN_KEY, savedCampaign, saveCampaign, saveAscensionUnlock } = await import('../src/campaign-storage.ts')
  const values = new Map()
  let blocked = false
  globalThis.window = new EventTarget()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { if (blocked) throw new Error('quota full'); values.set(key, value) },
  }
  try {
    const base = createCampaignProgress()
    saveCampaign(base)
    blocked = true
    saveAscensionUnlock(6)
    blocked = false
    values.set(CAMPAIGN_KEY, JSON.stringify({ ...base, characters: { ...base.characters, ironclad: 4 }, highestAscension: 7 }))
    const recovered = savedCampaign()
    assert.deepEqual({ marks: recovered.characters.ironclad, level: recovered.highestAscension }, { marks: 4, level: 7 })
    saveAscensionUnlock(8)
    const persisted = JSON.parse(values.get(CAMPAIGN_KEY))
    assert.deepEqual({ marks: persisted.characters.ironclad, level: persisted.highestAscension }, { marks: 4, level: 8 })
    blocked = true
    saveAscensionUnlock(10)
    blocked = false
    values.set(CAMPAIGN_KEY, JSON.stringify({ ...base, characters: { ...base.characters, ironclad: 5 }, highestAscension: 9 }))
    const floor = savedCampaign()
    assert.deepEqual({ marks: floor.characters.ironclad, level: floor.highestAscension }, { marks: 5, level: 10 })
    saveAscensionUnlock(11)
    const latest = JSON.parse(values.get(CAMPAIGN_KEY))
    assert.deepEqual({ marks: latest.characters.ironclad, level: latest.highestAscension }, { marks: 5, level: 11 })
    console.log('✓ quota fallback reconciles a newer durable journal without erasing its marks')
  } finally {
    delete globalThis.localStorage
    delete globalThis.window
  }
}

const directory = mkdtempSync(join(tmpdir(), 'sts-ascension-sync-'))
const file = join(directory, 'rooms.json')
let failSave = false
let writes = 0
const server = createRoomServer({ storeFile: file, saveDelayMs: 60_000, onSaveError: () => {}, saveStoreImpl: (store) => {
  if (failSave) throw new Error('disk unavailable')
  writes += 1
  saveStore(store)
} })
const origin = `http://127.0.0.1:${(await server.listen(0)).port}`
const post = async (path, body) => {
  const response = await fetch(`${origin}/api/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
try {
  const account = { username: 'AscensionSync', token: crypto.randomUUID(), password: 'ascension sync password' }
  assert.equal((await post('profile', account)).status, 200)
  const sync = (highestAscension, token = account.token) => post('profile/ascension', { token, highestAscension })
  assert.deepEqual(await sync(5), { status: 200, body: { highestAscension: 5 } })
  const afterUpload = writes
  assert.deepEqual(await sync(0), { status: 200, body: { highestAscension: 5 } }, 'a fresh device must restore the unlock')
  assert.deepEqual(await sync(3), { status: 200, body: { highestAscension: 5 } }, 'a stale device must never lower the unlock')
  assert.equal(createStore({ file }).profiles[0].highestAscension, 5, 'the acknowledged unlock must already be durable')
  assert.equal(writes, afterUpload, 'unchanged refreshes must not rewrite the room store')
  failSave = true
  assert.equal((await sync(6)).status, 503, 'an unlock must not be acknowledged before it is saved')
  failSave = false
  assert.deepEqual(await sync(0), { status: 200, body: { highestAscension: 6 } })
  assert.equal(createStore({ file }).profiles[0].highestAscension, 6, 'a retry must persist the earlier failed write')
  for (const invalid of [-1, 14, 1.5, '13', null]) assert.equal((await sync(invalid)).status, 400)
  assert.equal((await sync(13, crypto.randomUUID())).status, 409)
  assert.equal((await sync(13)).body.highestAscension, 13)

  // A fresh browser can recover old solo progress, but shared A10 dailies and borrowed co-op levels are not unlock evidence.
  const legacy = { username: 'LegacyAscension', token: crypto.randomUUID() }
  server.store.profiles.push(legacy)
  server.store.leaderboardRuns.push(
    { id: 'legacy-clear', username: 'LEGACYASCENSION', characters: ['ironclad'], ascension: 4, highestBossActDefeated: 3, recordedAt: 1 },
    { id: 'legacy-daily', username: legacy.username, characters: ['ironclad'], ascension: 10, highestBossActDefeated: 4, dailyDate: '2026-10-17', recordedAt: 2 },
    { id: 'legacy-loss', username: legacy.username, characters: ['ironclad'], ascension: 9, highestBossActDefeated: 2, recordedAt: 3 },
    { id: 'borrowed', characters: ['silent', 'defect'], ascension: 12, highestBossActDefeated: 3, winningDecks: [{ username: legacy.username }], recordedAt: 4 },
    { id: 'other', username: 'SomebodyElse', characters: ['ironclad'], ascension: 12, highestBossActDefeated: 3, recordedAt: 5 },
  )
  assert.deepEqual(await sync(0, legacy.token), { status: 200, body: { highestAscension: 5 } })
  assert.equal(createStore({ file }).profiles.find((profile) => profile.token === legacy.token).highestAscension, 5)
  console.log('✓ authenticated, monotonic, durable Ascension sync and conservative solo-history recovery')
} finally {
  await server.close()
  rmSync(directory, { recursive: true, force: true })
}
