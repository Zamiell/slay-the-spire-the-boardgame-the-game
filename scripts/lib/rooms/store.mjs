// Disk persistence owns archives/journals and their recovery ordering. The one
// hydration callback belongs to the room lifecycle, not to filesystem storage.
import { randomBytes } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, truncateSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CHARACTER_IDS } from '../../../src/game/types.ts'
import { isRemovedHeroRun, mergeLeaderboardRuns, restoreLeaderboardRuns } from '../leaderboard.mjs'
import { restoreMail } from '../mail.mjs'
import { classificationRecord, deckHash, HERO_NAMES, INITIAL_DECK_CLASSIFICATIONS, INITIAL_DECK_TYPES,
  isRemovedHero, isRemovedHeroDeckType, recordDeckClassification, statsDecks, validClassifierThreadId, validDeckType, validSoloDeck } from '../stats.mjs'
import { restoreCoinGrants } from '../coin-grants.mjs'

const LEGACY_DECK_TYPES = new Set([
  'Ironclad Barricade Body Slam', 'Ironclad Strength Multi-Hit', 'Ironclad Exhaust Engine',
  'Ironclad Block Fortress', 'Ironclad Heavy Blade', 'Ironclad Wound Engine',
  'Silent Poison Catalyst', 'Silent Shiv Finisher', 'Silent Discard Engine',
  'Silent Footwork Block', 'Silent Poison Shiv Hybrid', 'Silent Draw Combo',
  'Defect Lightning Orb Focus', 'Defect Frost Orb Focus', 'Defect Mixed Orb',
  'Defect Claw Spam', 'Defect Dark Orb Burst', 'Defect Zero Cost Cycle', 'Defect Powers Engine',
  'Watcher Stance Dance', 'Watcher Wrath Burst', 'Watcher Retain Engine',
  'Watcher Scry Engine', 'Watcher Divinity Mantra', 'Watcher Calm Block',
  'Slime Boss Slime Swarm', 'Slime Boss Split Engine', 'Slime Boss Tackle Burst',
  'Guardian Mode Shift', 'Guardian Socket Gems', 'Guardian Defensive Scaling',
  'Hexaghost Ignite Engine', 'Hexaghost Ghostflame Cycle', 'Hexaghost Burn Control',
  'Hermit Chamber Combo', 'Hermit Dead On Burst', 'Hermit Curse Engine',
])

function roomHasRemovedHero(room) {
  const removed = (character) => typeof character === 'string' && !CHARACTER_IDS.includes(character)
  return room.seats.some((seat) => removed(seat?.character)) ||
    Array.isArray(room.run?.players) && room.run.players.some((player) => removed(player?.character))
}

function readJournal(store, path) {
  let buffer
  try { buffer = readFileSync(path) } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
  const validBytes = buffer.lastIndexOf(10) + 1
  if (validBytes === buffer.length) return buffer.toString('utf8')
  let complete = false
  try { JSON.parse(buffer.subarray(validBytes).toString('utf8')); complete = true } catch {}
  store.interruptedJournals.set(path, { buffer, validBytes, complete })
  return complete ? `${buffer.toString('utf8')}\n` : buffer.subarray(0, validBytes).toString('utf8')
}

export function repairInterruptedJournals(store) {
  for (const [path, { buffer, validBytes, complete }] of store.interruptedJournals) {
    if (!readFileSync(path).equals(buffer)) throw new Error(`Journal changed during recovery: ${path}`)
    if (complete) appendFileSync(path, '\n', { mode: 0o600 })
    else {
      writeFileSync(`${path}.partial-${randomBytes(8).toString('hex')}`, buffer.subarray(validBytes), { mode: 0o600, flag: 'wx' })
      truncateSync(path, validBytes)
      console.warn(`Preserved an incomplete journal tail from ${path}`)
    }
    store.interruptedJournals.delete(path)
  }
}

function appendJournal(store, path, entries) {
  let descriptor
  try { descriptor = openSync(path, 'r') } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (descriptor !== undefined) {
    try {
      const size = fstatSync(descriptor).size
      if (size) {
        const lastByte = Buffer.alloc(1)
        if (readSync(descriptor, lastByte, 0, 1, size - 1) !== 1) throw new Error(`Journal changed during append: ${path}`)
        if (lastByte[0] !== 10) {
          readJournal(store, path)
          repairInterruptedJournals(store)
        }
      }
    } finally { closeSync(descriptor) }
  }
  appendFileSync(path, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 })
}

export function loadStore({ file, restartRecovery = false, restartReconnectMs = 5 * 60_000 } = {}, hydrateRoom) {
  const store = { rooms: new Map(), leaderboardRuns: [], statsRuns: [], leaderboardRevision: 0, leaderboardDirty: true, leaderboardChanges: new Map(),
    statsStateDirty: true, statsChanges: new Map(), interruptedJournals: new Map(),
    deckTypes: [...INITIAL_DECK_TYPES], deckClassificationBudget: { day: -1, used: 0 },
    deckClassifierThreadId: undefined, deckClassifierRelease: undefined, profiles: [], mail: [], mailDirty: false, file, reconnectQuorums: new Map(),
    // Recorded runs before the Shop launched are paid by the one-time coin grant.
    coinsLaunchedAt: Date.now(), coinGrants: [] }
  if (!file) return store
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(saved?.rooms)) throw new Error('rooms must be an array')
    const legacyRuns = restoreLeaderboardRuns(saved.leaderboardRuns)
    let archive
    try { archive = JSON.parse(readFileSync(`${file}.leaderboard.json`, 'utf8')) } catch (error) {
      if (error?.code === 'ENOENT' && saved.leaderboardArchive) throw new Error('Leaderboard archive is missing')
      if (error?.code !== 'ENOENT') throw error
    }
    if (archive !== undefined && !Array.isArray(archive)) throw new Error('Leaderboard archive must be an array')
    const archivedRuns = restoreLeaderboardRuns(archive)
    if (archive !== undefined && archivedRuns.length !== archive.filter((run) => !isRemovedHeroRun(run)).length)
      throw new Error('Leaderboard archive has invalid runs')
    const journal = readJournal(store, `${file}.leaderboard.log`)
    if (archive === undefined && existsSync(`${file}.leaderboard.log`)) throw new Error('Leaderboard archive is missing for its log')
    const archivedById = new Map(archivedRuns.map((run) => [run.id, run]))
    const journalIds = new Set()
    for (const line of journal.split('\n')) {
      if (!line) continue
      const entry = JSON.parse(line)
      if (isRemovedHeroRun(entry)) continue
      const [run] = restoreLeaderboardRuns([entry])
      if (!run) throw new Error('Leaderboard log contains an invalid run')
      archivedById.set(run.id, run)
      journalIds.add(run.id)
    }
    store.leaderboardRuns = mergeLeaderboardRuns(legacyRuns, [...archivedById.values()], {
      preferLegacyRuns: !saved.leaderboardArchive, journalIds,
    })
    store.statsRuns = store.leaderboardRuns.flatMap(statsDecks)
    store.leaderboardDirty = archive === undefined
    if (!store.leaderboardDirty && legacyRuns.length)
      for (const run of store.leaderboardRuns)
        if (JSON.stringify(run) !== JSON.stringify(archivedById.get(run.id))) store.leaderboardChanges.set(run.id, run)
    if (Array.isArray(saved.deckTypes)) store.deckTypes = [...new Set([...store.deckTypes, ...saved.deckTypes.filter(validDeckType)])]
    if (Number.isSafeInteger(saved.deckClassificationBudget?.day) && Number.isSafeInteger(saved.deckClassificationBudget?.used) && saved.deckClassificationBudget.used >= 0)
      store.deckClassificationBudget = saved.deckClassificationBudget
    if (validClassifierThreadId(saved.deckClassifierThreadId) && typeof saved.deckClassifierRelease === 'string') {
      store.deckClassifierThreadId = saved.deckClassifierThreadId
      store.deckClassifierRelease = saved.deckClassifierRelease
    }
    let statsState
    try { statsState = JSON.parse(readFileSync(`${file}.stats.json`, 'utf8')) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (statsState !== undefined) {
      if (Array.isArray(statsState?.deckTypes)) statsState.deckTypes = statsState.deckTypes.filter((type) => !isRemovedHeroDeckType(type))
      if (!Array.isArray(statsState?.deckTypes) || statsState.deckTypes.some((type) => !validDeckType(type)) ||
          !Number.isSafeInteger(statsState.deckClassificationBudget?.day) ||
          !Number.isSafeInteger(statsState.deckClassificationBudget?.used) || statsState.deckClassificationBudget.used < 0 ||
          statsState.deckClassifierThreadId !== undefined && (!validClassifierThreadId(statsState.deckClassifierThreadId) ||
          typeof statsState.deckClassifierRelease !== 'string') ||
          statsState.deckClassifierRelease !== undefined && typeof statsState.deckClassifierRelease !== 'string')
        throw new Error('Stats state is invalid')
      store.deckTypes = [...new Set([...store.deckTypes, ...statsState.deckTypes])]
      if (statsState.deckClassifierRelease !== undefined) {
        store.deckClassifierThreadId = statsState.deckClassifierThreadId
        store.deckClassifierRelease = statsState.deckClassifierRelease
      }
      const currentBudget = store.deckClassificationBudget
      const backedUpBudget = statsState.deckClassificationBudget
      if (backedUpBudget.day > currentBudget.day ||
          backedUpBudget.day === currentBudget.day && backedUpBudget.used > currentBudget.used)
        store.deckClassificationBudget = backedUpBudget
      store.statsStateDirty = store.deckTypes.length !== statsState.deckTypes.length ||
        store.deckClassificationBudget.day !== backedUpBudget.day ||
        store.deckClassificationBudget.used !== backedUpBudget.used ||
        store.deckClassifierThreadId !== statsState.deckClassifierThreadId ||
        store.deckClassifierRelease !== statsState.deckClassifierRelease
    }
    const statsLog = readJournal(store, `${file}.stats.log`)
    const logged = new Map()
    const knownTypes = new Set(store.deckTypes)
    for (const line of statsLog.split('\n')) {
      if (!line) continue
      const record = JSON.parse(line)
      if (isRemovedHero(record?.hero)) continue
      if (typeof record?.id !== 'string' || !Object.hasOwn(HERO_NAMES, record.hero) || !/^[0-9a-f]{64}$/.test(record.hash) ||
          record.deckType !== undefined && !validDeckType(record.deckType) ||
          record.retry !== undefined && (!Number.isSafeInteger(record.retry?.after) || record.retry.after < 0 ||
          !/^[0-9a-f]{64}$/.test(record.retry.hash))) throw new Error('Stats log is invalid')
      logged.set(record.id, record)
    }
    for (const run of store.statsRuns) {
      const record = logged.get(run.id)
      if (record?.hero === run.character && record.hash === deckHash(run)) {
        if (!run.deckType && record.deckType) { run.deckType = record.deckType; delete run.deckClassificationRetry }
        else if (!run.deckType && record.retry &&
            (!run.deckClassificationRetry || record.retry.after >= run.deckClassificationRetry.after))
          run.deckClassificationRetry = record.retry
      }
      if (run.deckType || run.deckClassificationRetry) {
        const latest = classificationRecord(run)
        if (JSON.stringify(latest) !== JSON.stringify(record)) store.statsChanges.set(run.id, latest)
      }
      if (run.deckType && !knownTypes.has(run.deckType)) {
        knownTypes.add(run.deckType)
        store.deckTypes.push(run.deckType)
        store.statsStateDirty = true
      }
    }
    store.profiles = saved.profiles ?? []
    if (Number.isSafeInteger(saved.coinsLaunchedAt) && saved.coinsLaunchedAt > 0) store.coinsLaunchedAt = saved.coinsLaunchedAt
    store.coinGrants = restoreCoinGrants(saved.coinGrants)
    for (const room of saved.rooms) {
      if (typeof room?.code === 'string' && Array.isArray(room.seats) && room.campaignProgress && !roomHasRemovedHero(room)) {
        const connectedAtSave = new Set(room.seats
          .filter((seat) => seat.connected !== false).map((seat) => seat.playerId))
        const seatIds = new Set(room.seats.map((seat) => seat.playerId))
        const savedQuorum = saved.reconnectQuorums?.[room.code]
        const unresolvedAtSave = Array.isArray(savedQuorum?.playerIds) && savedQuorum.expiresAt > Date.now()
          ? savedQuorum.playerIds.filter((playerId) => seatIds.has(playerId)) : []
        const recoverySeats = new Set([...connectedAtSave, ...unresolvedAtSave])
        if (restartRecovery && recoverySeats.size > 0) {
          store.reconnectQuorums.set(room.code, { playerIds: recoverySeats, expiresAt: Date.now() + restartReconnectMs })
        }
        hydrateRoom(room, connectedAtSave)
        store.rooms.set(room.code, room)
      }
    }
    const evidenced = new Set(store.statsRuns.map((run) => run.deckType).filter(Boolean))
    const retained = store.deckTypes.filter((type) => !LEGACY_DECK_TYPES.has(type) ||
      INITIAL_DECK_TYPES.includes(type) || evidenced.has(type))
    if (retained.length !== store.deckTypes.length) {
      store.deckTypes = retained
      store.statsStateDirty = true
    }
    for (const run of store.statsRuns) {
      if (run.deckType || !validSoloDeck(run)) continue
      const type = INITIAL_DECK_CLASSIFICATIONS.get(deckHash(run))
      if (!type?.startsWith(`${HERO_NAMES[run.character]} `)) continue
      run.deckType = type
      delete run.deckClassificationRetry
      recordDeckClassification(store, run)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' || existsSync(`${file}.leaderboard.json`) || existsSync(`${file}.leaderboard.log`) ||
        existsSync(`${file}.stats.json`) || existsSync(`${file}.stats.log`) || existsSync(`${file}.mail.json`)) {
      throw new Error(`Could not load room store: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Mail is separate because the main store is rewritten on every room action.
  try { store.mail = restoreMail(JSON.parse(readFileSync(`${file}.mail.json`, 'utf8'))) } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Could not load mail: ${error instanceof Error ? error.message : String(error)}`)
  }
  return store
}

export function saveStore(store) {
  if (!store.file) return
  mkdirSync(dirname(store.file), { recursive: true })
  const temporary = `${store.file}.tmp`
  const reconnectQuorums = Object.fromEntries([...store.reconnectQuorums].map(([code, quorum]) => [code, {
    playerIds: [...quorum.playerIds], expiresAt: quorum.expiresAt,
  }]))
  const main = { version: 1, rooms: [...store.rooms.values()], deckTypes: store.deckTypes,
    deckClassificationBudget: store.deckClassificationBudget, deckClassifierThreadId: store.deckClassifierThreadId,
    deckClassifierRelease: store.deckClassifierRelease, profiles: store.profiles, reconnectQuorums,
    coinsLaunchedAt: store.coinsLaunchedAt, coinGrants: store.coinGrants }
  if (!existsSync(store.file) || store.leaderboardDirty) {
    writeFileSync(temporary, JSON.stringify({ ...main, leaderboardRuns: store.leaderboardRuns }), { mode: 0o600 })
    renameSync(temporary, store.file)
  }
  repairInterruptedJournals(store)
  const archive = `${store.file}.leaderboard.json`
  if (store.leaderboardDirty) {
    const archiveTemporary = `${archive}.tmp`
    writeFileSync(archiveTemporary, JSON.stringify(store.leaderboardRuns), { mode: 0o600 })
    renameSync(archiveTemporary, archive)
    store.leaderboardDirty = false
    store.leaderboardChanges.clear()
  } else if (store.leaderboardChanges.size) {
    appendJournal(store, `${store.file}.leaderboard.log`, [...store.leaderboardChanges.values()])
    store.leaderboardChanges.clear()
  }
  if (store.statsChanges.size) {
    appendJournal(store, `${store.file}.stats.log`, [...store.statsChanges.values()])
    store.statsChanges.clear()
  }
  if (store.statsStateDirty) {
    const statsTemporary = `${store.file}.stats.json.tmp`
    writeFileSync(statsTemporary, JSON.stringify({ deckTypes: store.deckTypes, deckClassificationBudget: store.deckClassificationBudget,
      deckClassifierThreadId: store.deckClassifierThreadId, deckClassifierRelease: store.deckClassifierRelease }), { mode: 0o600 })
    renameSync(statsTemporary, `${store.file}.stats.json`)
    store.statsStateDirty = false
  }
  writeFileSync(temporary, JSON.stringify({ ...main, leaderboardArchive: true }), { mode: 0o600 })
  renameSync(temporary, store.file)
  // Mark mail clean only after writing it, including when an earlier save failed.
  if (store.mailDirty) {
    const mailTemporary = `${store.file}.mail.json.tmp`
    writeFileSync(mailTemporary, JSON.stringify(store.mail), { mode: 0o600 })
    renameSync(mailTemporary, `${store.file}.mail.json`)
    store.mailDirty = false
  }
}
