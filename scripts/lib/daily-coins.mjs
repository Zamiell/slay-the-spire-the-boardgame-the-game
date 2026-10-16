import { MAX_BOSS_AWARDS, rollBossCoins } from '../../src/game/coins.ts'
import { dailySeedText } from '../../src/game/daily.ts'
import { seedFromString } from '../../src/game/rng.ts'
import { MAX_WALLET_COINS } from '../../src/wallet.ts'
import { syncAccountWallet } from './account-wallets.mjs'
import { bossesOf, grantNameKey } from './coin-grants.mjs'

function dailyActs(run) {
  const known = bossesOf(run)
  const recorded = run.dailyBossActs ?? []
  // Older saved climbs may only hold awards for bosses fought after resuming.
  for (let missing = 0; missing <= known.length; missing += 1) {
    let next = missing
    for (const act of recorded) if (act === known[next]) next += 1
    if (next === known.length) return [...known.slice(0, missing), ...recorded].slice(0, MAX_BOSS_AWARDS)
  }
  return known
}

function dailyRunCoins(run) {
  const seed = seedFromString(dailySeedText(run.dailyDate))
  return dailyActs(run).reduce((sum, act, index) => sum + rollBossCoins(seed, index, act, run.ascension), 0)
}

export function dailyCoinHistory(runs) {
  const accounts = new Map()
  for (const run of runs) {
    if (run.dailyDate === undefined || run.username === undefined) continue
    const key = grantNameKey(run.username)
    const row = accounts.get(key) ?? { username: key, runs: 0, bosses: 0, coins: 0 }
    row.runs += 1
    row.bosses += dailyActs(run).length
    row.coins += dailyRunCoins(run)
    accounts.set(key, row)
  }
  return accounts
}

// Profiles, including these receipts, survive older server versions on rollback.
export function creditRecordedDailyCoins(store, run, profile) {
  if (run.dailyDate === undefined || !profile || run.username === undefined ||
      grantNameKey(run.username) !== grantNameKey(profile.username)) return false
  const key = `daily:${run.id}`
  const total = dailyRunCoins(run)
  const coins = total - (profile.dailyCoinRuns?.[key] ?? 0)
  if (coins <= 0) return false
  syncAccountWallet(store, profile, {})
  profile.dailyCoinRuns ??= {}
  profile.dailyCoinRuns[key] = total
  profile.dailyCoinsEarned = (profile.dailyCoinsEarned ?? 0) + coins
  profile.wallet.coins = Math.min(MAX_WALLET_COINS, profile.wallet.coins + coins)
  profile.wallet.dailyCoinsEarned = profile.dailyCoinsEarned
  store.walletsDirty = true
  return true
}

export function backfillDailyCoins(store) {
  const profiles = new Map(store.profiles.map((profile) => [grantNameKey(profile.username), profile]))
  let changed = false
  for (const run of store.leaderboardRuns) {
    if (run.dailyDate === undefined || run.username === undefined) continue
    changed = creditRecordedDailyCoins(store, run, profiles.get(grantNameKey(run.username))) || changed
  }
  return changed
}
