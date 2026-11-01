import { forcedCardAction, runSeed } from './lib/start-turn-fuzz.mjs'
import { suite, check, assert, assertDeepEqual, assertEqual, report } from './lib/harness.mjs'

suite('start-turn fuzz policy')

function snapshot(defId = 'strike_silent') {
  return {
    you: { playerId: 'owner' },
    run: { combat: {
      startTurnProgress: { forcedCard: { playerId: 'owner', cardUid: 'forced', sourceCardId: 'mayhem' } },
      players: [{ id: 'owner', hand: [{ uid: 'forced', defId, upgraded: false }], chamber: [] }],
      enemies: [{ uid: 'dead', dead: true }, { uid: 'first', dead: false }, { uid: 'second', dead: false }],
    } },
  }
}

check('the forced-card owner submits a complete simple answer using the first living target', () => {
  assertDeepEqual(forcedCardAction(snapshot()), {
    kind: 'playCard', cardUid: 'forced', playerId: 'owner', enemyUid: 'first',
  })
  assertDeepEqual(forcedCardAction(snapshot('defend_silent')), {
    kind: 'playCard', cardUid: 'forced', playerId: 'owner',
  })
  const other = snapshot()
  other.you.playerId = 'peer'
  assertEqual(forcedCardAction(other), undefined)
})

check('unsupported private choices and higher-priority mandatory prompts are not guessed or skipped', () => {
  assertEqual(forcedCardAction(snapshot('survivor')), undefined, 'discard requires a separate complete policy')
  const pending = snapshot()
  pending.run.combat.pendingTriggers = [{ id: 1, playerId: 'owner', sourceId: 'trigger' }]
  assertEqual(forcedCardAction(pending), undefined)
  const dead = snapshot()
  dead.run.combat.enemies.forEach((enemy) => { enemy.dead = true })
  assertEqual(forcedCardAction(dead), undefined)
})

check('only the four simple Guardian starters gain sequence support, with explicit safe choices', () => {
  for (const defId of ['guardian_strike', 'guardian_defend', 'guardian_twin_slam', 'guardian_curl_up']) {
    for (const upgraded of [false, true]) {
      const state = snapshot(defId)
      const player = state.run.combat.players[0]
      player.hand[0].upgraded = upgraded
      player.guardianMode = 'defense'
      player.vigor = 3
      assertDeepEqual(forcedCardAction(state), {
        kind: 'playCard', cardUid: 'forced', playerId: 'owner', spendVigor: 0,
        ...(['guardian_strike', 'guardian_twin_slam'].includes(defId) ? { enemyUid: 'first' } : {}),
      })
    }
  }
  for (const defId of ['guardian_stasis_field', 'guardian_power_beam', 'guardian_hack']) {
    assertEqual(forcedCardAction(snapshot(defId)), undefined, `${defId} is not a supported starter sequence`)
  }
})

check('socketed or Crystallize-inherited gems do not slip through starter sequence support', () => {
  const socketed = snapshot('guardian_defend')
  socketed.run.combat.players[0].hand[0].attachedGemId = 'guardian_jasper'
  assertEqual(forcedCardAction(socketed), undefined)
  const inherited = snapshot('guardian_strike')
  inherited.run.combat.players[0].powers = [{
    uid: 'crystallize', defId: 'guardian_crystallize', upgraded: false, attachedGemId: 'guardian_jasper',
  }]
  assertEqual(forcedCardAction(inherited), undefined)
})

check('seed 4079 resolves its real Mayhem target prompt through the authoritative room API', () => {
  const result = runSeed(4079)
  assertEqual(result.kind, 'ok', JSON.stringify(result))
  assertEqual(result.errors.length, 0)
  assert(result.events.some((event) => event.startsWith('forced ')), 'the prompt was answered, not relabeled')
})

check('seed 92913 answers Mayhem’s Guardian Defend prompt rather than reporting it inconclusive', () => {
  const result = runSeed(92913)
  assertEqual(result.kind, 'ok', JSON.stringify(result))
  assertEqual(result.errors.length, 0)
  assert(result.events.some((event) => event.startsWith('forced p3:c34@')), 'Guardian Defend was submitted')
})

report('start-turn fuzz policy')
