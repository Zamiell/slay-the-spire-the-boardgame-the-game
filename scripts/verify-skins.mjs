#!/usr/bin/env node
// Skins: Kratos is a skin of Ironclad, never a character. A skin is presentation only, so these
// checks pin the registry, that a run carries it, that it never touches the rules, and that every
// loader tolerates the Kratos data recorded while he was still a playable character.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHARACTER_IDS, DOWNFALL_CHARACTER_IDS } from '../src/game/types.ts'
import { SKINS, SKIN_IDS, SKIN_LABELS, VISUAL_IDS, SKIN_TRAITS, characterOfSkin, hasStagedAttack, isSkinOf, playerVisualId, skinTraits, skinsOf, validSkin, visualId } from '../src/game/skins.ts'
import { createRun } from '../src/game/run.ts'
import { beginCatchUp } from '../src/game/run/setup.ts'
import { createCombat, playCard, preparePlayerTurn } from '../src/game/combat.ts'
import { bruiserSlime } from '../src/game/downfall/slime-boss.ts'
import { addPresentationEvent } from '../src/game/combat/presentation.ts'
import { createRng } from '../src/game/rng.ts'
import { createCampaignProgress, parseCampaignProgress } from '../src/game/campaign.ts'
import { CARDS } from '../src/game/cards.ts'
import { RELICS } from '../src/game/relics.ts'
import { validateRunLog } from '../src/ui/run-log.ts'
import { addLeaderboardRun } from './lib/leaderboard.mjs'
import { createRoom, createStore, joinRoom, saveStore, snapshotFor, startRun } from './lib/rooms.mjs'
import { assert, assertDeepEqual, assertEqual, check, report, suite } from './lib/harness.mjs'

suite('skins')
const readText = (path) => readFileSync(path, 'utf8')

// Everything below iterates the registry: registering a skin in src/game/skins.ts extends every case.
const CORE_HEROES = ['ironclad', 'silent', 'defect', 'watcher']
const heroOf = characterOfSkin
const otherHero = (skin) => CORE_HEROES.find((character) => character !== heroOf(skin))

check('every skin belongs to exactly one character and is no character', () => {
  assert(SKIN_IDS.length > 0, 'at least one skin is registered')
  assertDeepEqual(SKIN_IDS, Object.values(SKINS).flat(), 'SKIN_IDS lists the registry in order')
  assertEqual(new Set(SKIN_IDS).size, SKIN_IDS.length, 'a skin id is registered once')
  assertDeepEqual(VISUAL_IDS, [...CHARACTER_IDS, ...SKIN_IDS])
  assertDeepEqual(Object.keys(SKIN_LABELS), SKIN_IDS, 'every skin has a label')
  for (const skin of SKIN_IDS) {
    assert(/^[a-z][a-z0-9_]*$/.test(skin), `${skin} is a path-safe id`)
    assert(!CHARACTER_IDS.includes(skin), `${skin} is not a playable character`)
    assertEqual(Object.values(CARDS).filter((def) => def.owner === skin).length, 0, `${skin} owns no cards`)
    assert(SKIN_LABELS[skin].length > 0, `${skin} has a label`)
    assert(CHARACTER_IDS.includes(heroOf(skin)), `${skin} dresses a real character`)
    assert(skinsOf(heroOf(skin)).includes(skin))
  }
  for (const [character, skins] of Object.entries(SKINS)) assertDeepEqual(skinsOf(character), skins)
  assert(!('ashes_of_sparta' in RELICS), 'the legacy Kratos relic is gone')
})

check('only a skin the character owns is valid, and it picks the art key', () => {
  for (const skin of SKIN_IDS) {
    const hero = heroOf(skin)
    assert(isSkinOf(hero, skin))
    const wrong = [[otherHero(skin), skin], [hero, hero], [hero, skin.toUpperCase()], [hero, ''], [hero, null], [hero, undefined], [hero, 7],
      [hero, {}], [hero, [skin]], [skin, skin]]
    for (const [character, candidate] of wrong) {
      assert(!isSkinOf(character, candidate), `${character}/${String(candidate)} is not a skin pair`)
      assertEqual(validSkin(character, candidate), undefined)
      assertEqual(visualId(character, candidate), character, 'an invalid skin leaves the character\'s own art')
    }
    assertEqual(visualId(hero, skin), skin)
    assertEqual(visualId(hero), hero)
    assertEqual(playerVisualId({ character: hero, skin }), skin)
    assertEqual(playerVisualId({ character: otherHero(skin), skin }), otherHero(skin))
  }
})

check('a character named like an Object.prototype member has no skins and never throws', () => {
  for (const character of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assertDeepEqual(skinsOf(character), [])
    for (const skin of SKIN_IDS) {
      assert(!isSkinOf(character, skin))
      assertEqual(validSkin(character, skin), undefined)
      assertEqual(visualId(character, skin), character)
      assertEqual(playerVisualId({ character, skin }), character)
    }
  }
})

check('skin traits are read by visual id; characters and prototype names have none', () => {
  assertDeepEqual(Object.keys(SKIN_TRAITS), SKIN_IDS, 'every skin declares its traits')
  for (const skin of SKIN_IDS) {
    assertEqual(typeof skinTraits(skin)?.energyOrb, 'boolean', `${skin} declares energyOrb`)
    assertEqual(typeof skinTraits(skin)?.stagedAttack, 'boolean', `${skin} declares stagedAttack`)
    assertEqual(hasStagedAttack(skin), skinTraits(skin).stagedAttack, `${skin} staged attack follows its trait`)
  }
  for (const visual of [...CHARACTER_IDS, 'toString', 'constructor', '__proto__']) assertEqual(skinTraits(visual), undefined, visual)
  assertEqual(skinTraits('kratos')?.energyOrb, true)
  assert(hasStagedAttack('kratos') && hasStagedAttack('hermit'), 'Kratos and Hermit stage their attacks')
  assert(!hasStagedAttack('ironclad') && !hasStagedAttack('constructor'))
})

const party = (...members) => members.map(([character, skin], index) => ({ id: `p${index + 1}`, name: character, character, skin }))
const withoutSkins = (value) => JSON.parse(JSON.stringify(value, (key, entry) => key === 'skin' ? undefined : entry))

check('a run carries each hero\'s skin and drops one the hero cannot wear', () => {
  for (const skin of SKIN_IDS) {
    const other = otherHero(skin)
    const third = CORE_HEROES.find((character) => character !== heroOf(skin) && character !== other)
    const run = createRun(11, party([heroOf(skin), skin], [other, skin], [third, 'nonsense'], [CORE_HEROES.find((c) => ![heroOf(skin), other, third].includes(c))]))
    assertEqual(run.players[0].skin, skin)
    for (const player of run.players.slice(1)) assert(!('skin' in player), `${player.character} has no skin`)
    assertEqual(JSON.parse(JSON.stringify(run)).players[0].skin, skin, 'the skin survives a save')
    assert(!('skin' in createRun(11, party([heroOf(skin)])).players[0]), 'the default look stores nothing')
  }
})

check('a skin is presentation only: rules, RNG and combat are identical', () => {
  for (const skin of SKIN_IDS) {
    const hero = heroOf(skin)
    const plain = createRun(12, party([hero], [otherHero(skin)]))
    const skinned = createRun(12, party([hero, skin], [otherHero(skin)]))
    assertDeepEqual(withoutSkins(skinned), withoutSkins(plain))
    assertEqual(JSON.stringify(skinned.rng), JSON.stringify(plain.rng))
    const fight = (run) => preparePlayerTurn(createCombat(createRng(42), structuredClone(run.players), []))
    const combat = fight(skinned)
    assertEqual(combat.players[0].skin, skin, 'combat creation keeps the skin')
    assertDeepEqual(withoutSkins(combat), withoutSkins(fight(plain)))
  }
})

check('a skin records hit-by-hit damage on its attack events exactly when its stagedAttack trait says so', () => {
  const attack = (character, skin) => {
    const run = createRun(16, party([character, skin]))
    const combat = createCombat(createRng(42), structuredClone(run.players), [])
    addPresentationEvent(combat, { kind: 'card', sourceId: 'strike_ironclad', actorId: 'p1', enemyIds: ['e1'], playerIds: [],
      upgraded: false, copied: false, energy: 1 })
    return combat.presentationEvents.at(-1)
  }
  for (const skin of SKIN_IDS) {
    if (SKIN_TRAITS[skin].stagedAttack) assertDeepEqual(attack(heroOf(skin), skin).enemyHpLoss, {}, `${skin} stages its attack`)
    else assert(!('enemyHpLoss' in attack(heroOf(skin), skin)), `${skin} attack events stay unstaged`)
  }
  assert(!('enemyHpLoss' in attack('ironclad', undefined)), 'Ironclad\'s attack events stay unstaged')
})

check('Catch Up seats keep the skin they join with', () => {
  for (const skin of SKIN_IDS) {
    // The table already seats a third hero, so neither newcomer duplicates a character. A Downfall hero can only join a
    // Downfall table (Catch Up refuses it in a base-game run), so its table is seated by another Downfall hero.
    const downfall = DOWNFALL_CHARACTER_IDS.some((character) => character === heroOf(skin))
    const seated = downfall ? DOWNFALL_CHARACTER_IDS.find((character) => character !== heroOf(skin))
      : CORE_HEROES.find((character) => character !== heroOf(skin) && character !== otherHero(skin))
    const base = createRun(13, party([seated]))
    const act2 = { ...base, phase: 'map', neow: null, act: 2, map: { ...base.map, act: 2, position: null } }
    const joined = beginCatchUp(act2, party([heroOf(skin), skin]).map((member) => ({ ...member, id: 'p2' })))
    assert(joined !== act2, 'the newcomer joined')
    assertEqual(joined.players.find((player) => player.id === 'p2').skin, skin)
    const invalid = beginCatchUp(act2, [{ id: 'p2', name: 'Bo', character: otherHero(skin), skin }])
    assert(!('skin' in invalid.players.find((player) => player.id === 'p2')))
  }
})

const makeLog = (initial) => {
  const final = structuredClone(initial)
  final.phase = 'defeat'; final.neow = null; final.combat = null
  return { version: 2, runId: initial.campaign.runId, initial, events: [{ patch: [{ path: [], value: final }] }] }
}

check('run logs keep a valid skin, drop an invalid one and never reject an old log', () => {
  for (const skin of SKIN_IDS) {
    const skinned = validateRunLog(makeLog(createRun(14, party([heroOf(skin), skin]))))
    assertEqual(skinned?.initial.players[0].skin, skin)
    const old = validateRunLog(makeLog(createRun(14, party([heroOf(skin)]))))
    assert(old && !('skin' in old.initial.players[0]), 'a log from before skins replays')
    const forged = makeLog(createRun(14, party([otherHero(skin)])))
    forged.initial.players[0].skin = skin
    const dropped = validateRunLog(forged)
    assert(dropped, 'a wrong skin does not reject the log')
    assert(!('skin' in dropped.initial.players[0]), 'the wrong skin is dropped to the default look')
    const garbage = makeLog(createRun(14, party([heroOf(skin)])))
    garbage.initial.players[0].skin = { [skin]: true }
    assert(!('skin' in validateRunLog(garbage).initial.players[0]))
  }
})

check('a run log of a Kratos character is refused cleanly', () => {
  const legacy = makeLog(createRun(15, party(['ironclad'])))
  legacy.initial.players[0].character = 'kratos'
  assertEqual(validateRunLog(legacy), null)
})

check('a campaign saved with Kratos\'s unlock row loads without it', () => {
  const saved = JSON.parse(JSON.stringify(createCampaignProgress()))
  saved.characters.kratos = 8
  const loaded = parseCampaignProgress(saved)
  assert(!('kratos' in loaded.characters))
  assertDeepEqual(loaded, createCampaignProgress())
})

check('a room snapshot carries a staged attack\'s per-enemy damage, so every client splits the hero\'s hits from a Slime Command', () => {
  const store = createStore()
  const room = createRoom(store, { code: 'SLIMEY' })
  const ann = joinRoom(room, { name: 'Ann', character: 'slime_boss', skin: 'anime_slime_boss' })
  const bo = joinRoom(room, { name: 'Bo', character: 'guardian' })
  startRun(room, ann.token, { seed: 7 })
  const [player] = structuredClone(room.run.players)
  const enemies = [0, 1].map((index) => ({ uid: `enemy-${index}`, defId: 'jaw_worm', row: 0, isBoss: false, hp: 30, maxHp: 30, block: 0,
    strength: 0, vulnerable: 0, weak: 0, poison: 0, actionIndex: 0, abilityUsed: true, dead: false }))
  let combat = createCombat(createRng(47), [{ ...player, hand: [], draw: [], energy: 9, slimes: [bruiserSlime('command-bruiser')] }], enemies)
  combat.phase = 'player'
  const tackle = { uid: 'flame-tackle', defId: 'slime_boss_flame_tackle', upgraded: false }
  combat.players[0].hand.push(tackle)
  combat = playCard(combat, player.id, tackle.uid, { enemyUid: 'enemy-0', row: 0, slimeUids: ['command-bruiser'], slimeEnemyUids: ['enemy-0'] })
  room.run.phase = 'combat'
  room.run.combat = combat
  const event = combat.presentationEvents.findLast((held) => held.kind === 'card')
  assertDeepEqual(event.enemyHpLoss, { 'enemy-0': 2, 'enemy-1': 2 }, 'the engine attributes only the hero\'s own hits to the card event')
  assertEqual(combat.enemies[0].hp, 27, 'the Bruiser Command adds its own damage on top (2 + 1)')
  const seen = snapshotFor(room, ann.token).run.combat.presentationEvents.findLast((held) => held.kind === 'card')
  assertDeepEqual(seen.enemyHpLoss, event.enemyHpLoss, 'the snapshot forwards the public damage map')
  assert(seen.enemyHpLoss !== event.enemyHpLoss, 'the snapshot copies it')
  assertDeepEqual(snapshotFor(room, bo.token).run.combat.presentationEvents.findLast((held) => held.kind === 'card').enemyHpLoss, event.enemyHpLoss,
    'another seat sees the same public numbers')
})

check('stored rooms: seat skins load, bad ones drop, and a room seating Kratos is discarded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sts-skins-'))
  try {
    const file = join(directory, 'rooms.json')
    const store = createStore({ file })
    const room = createRoom(store, { code: 'SKINNY' })
    const [skin] = SKIN_IDS
    const ann = joinRoom(room, { name: 'Ann', character: heroOf(skin), skin })
    joinRoom(room, { name: 'Bo', character: otherHero(skin) })
    const legacy = createRoom(store, { code: 'OLDKRA' })
    joinRoom(legacy, { name: 'Old', character: 'ironclad' })
    saveStore(store)
    const saved = JSON.parse(readText(file))
    saved.rooms.find((entry) => entry.code === 'OLDKRA').seats[0].character = 'kratos'
    saved.rooms.find((entry) => entry.code === 'SKINNY').seats[1].skin = skin
    writeFileSync(file, JSON.stringify(saved))
    const restored = createStore({ file })
    assertEqual(restored.rooms.has('OLDKRA'), false, 'a room seating the removed hero is discarded')
    const [first, second] = restored.rooms.get('SKINNY').seats
    assertEqual(first.token, ann.token)
    assertEqual(first.skin, skin, 'a valid skin is recovered with the room')
    assert(!('skin' in second), 'a skin the hero cannot wear is dropped on recovery')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

check('leaderboard, stats log and stats state recorded for Kratos load without him', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sts-skins-legacy-'))
  try {
    const file = join(directory, 'rooms.json')
    const row = (id, character, characters = [character]) => ({ id, character, characters, ascension: 1, mode: 'standard',
      damageStatsComplete: true, startedAtAct: 1, highestBossActDefeated: 3, combatsFinished: 3, damageDealt: 3,
      damageTaken: 3, damageBlocked: 3, floorsCleared: 3, recordedAt: 1, finalDeck: [{ defId: 'strike_ironclad', upgraded: false }] })
    const store = createStore({ file })
    addLeaderboardRun(store, row('browser-1234:keep', 'ironclad'))
    saveStore(store)
    const archivePath = `${file}.leaderboard.json`
    writeFileSync(archivePath, JSON.stringify([...JSON.parse(readText(archivePath)), row('browser-1234:kratos', 'kratos'),
      row('browser-1234:mixed', 'ironclad', ['ironclad', 'kratos'])]))
    writeFileSync(`${file}.leaderboard.log`, `${JSON.stringify(row('browser-1234:logged', 'kratos'))}\n`)
    writeFileSync(`${file}.stats.log`, `${JSON.stringify({ id: 'browser-1234:kratos', hero: 'kratos', hash: 'a'.repeat(64), deckType: 'Kratos Rage Unleash' })}\n`)
    writeFileSync(`${file}.stats.json`, JSON.stringify({ deckTypes: ['Ironclad Strength Scaling', 'Kratos Rage Unleash'],
      deckClassificationBudget: { day: 1, used: 0 } }))
    const restored = createStore({ file })
    assertDeepEqual(restored.leaderboardRuns.map((run) => run.id), ['browser-1234:keep'])
    assert(!restored.deckTypes.some((type) => type.startsWith('Kratos')), 'his deck types are forgotten')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

report('skins')
