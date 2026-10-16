// Read-only preview of the Daily Climb history migration. Never prints credentials.
import { dailyCoinHistory } from './lib/daily-coins.mjs'
import { grantNameKey } from './lib/coin-grants.mjs'
import { createStore } from './lib/rooms.mjs'
import { statSync } from 'node:fs'

const index = process.argv.indexOf('--store')
const file = index >= 0 ? process.argv[index + 1] : undefined
if (!file) {
  console.error('Usage: node scripts/daily-coins-report.mjs --store <rooms.json>')
  process.exit(2)
}
statSync(file)
const store = createStore({ file })
const history = dailyCoinHistory(store.leaderboardRuns)
const rows = store.profiles.flatMap((profile) => {
  const row = history.get(grantNameKey(profile.username))
  return row ? [{ ...row, username: profile.username, credited: profile.dailyCoinsEarned ?? 0 }] : []
}).sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username))
console.log(JSON.stringify({ accounts: rows.filter((row) => row.coins > 0).length,
  coins: rows.reduce((sum, row) => sum + row.coins, 0), rows }, null, 2))
