import { DOWNFALL_PHYSICAL_ENEMY_CARDS } from '../../src/game/downfall/enemies.ts'

// Zero-based cells in the official TTS sheets. Keep die-order variants distinct:
// artId deliberately collapses those variants and cannot identify a printed card.
export const enemyCardSources = []
function sheet(source, ids, minAscension = 0) {
  ids.forEach((id, index) => {
    if (id && !enemyCardSources.some(card => card.id === id && card.minAscension === minAscension)) {
      enemyCardSources.push({ id, source: `base-${source}`, index, minAscension })
    }
  })
}

sheet(3135, ['red_louse_first', 'small_slime', 'jaw_worm_first', 'cultist'])
sheet(3163, [null, null, 'fungi_beast', null, 'red_louse', 'large_slime',
  'sneaky_gremlin', 'mad_gremlin', 'blue_slaver', 'red_slaver', 'looter', 'jaw_worm'])
sheet(3171, [null, null, null, null, null, 'large_slime', null, null, null, null, 'looter'], 7)
sheet(3171, [...Array(11).fill(null), 'jaw_worm_a7'])
sheet(3035, [
  'gremlin_wizard', null, 'fat_gremlin', null, null, null, null, null,
  'green_louse', 'green_louse_21w', 'red_louse_summon', 'fungi_beast_summon',
  'sentry_a', 'sentry_b', ...Array(9).fill(null),
  'large_slime_summon_w4s', 'large_slime_summon_4sw', 'large_slime_summon_sw4', null,
  'acid_slime', 'acid_slime_daw', 'acid_slime_wda', 'acid_slime_wad',
  'spike_slime', 'spike_slime_dv2', 'spike_slime_v2d', 'spike_slime_2dv',
])
sheet(3136, ['snecko', 'snake_plant', 'spheric_guardian', 'byrd_encounter', null,
  'shelled_parasite', 'chosen_14', 'chosen_16', 'looter_hard', null, 'centurion_3b', 'centurion_b3'])
sheet(3170, [null, 'snake_plant', 'spheric_guardian', null, null, 'shelled_parasite'], 7)
sheet(3038, [
  'byrd_s31', 'byrd_31s', 'byrd_s13', ...Array(4).fill(null),
  'bronze_orb', 'bronze_orb_3bd', 'bronze_orb_db3', 'bronze_orb_b3d',
  'torch_head', ...Array(7).fill(null), 'mugger', null, 'mystic', 'mystic_2sh',
  'blue_slaver_dw3', 'blue_slaver_w3d', 'blue_slaver_3wd', 'blue_slaver_wd3',
  'red_slaver_dv3', 'red_slaver_3dv', 'red_slaver_3vd', 'red_slaver_v3d', 'fungi_beast_a7',
])
sheet(2959, ['jaw_worm_act3', 'spire_growth', 'repulsor', 'exploder',
  'orb_walker_3ws', 'orb_walker_2s', 'transient', 'maw', 'writhing_mass', 'darkling'])
sheet(3169, [null, null, 'repulsor', 'exploder', null, null, null, 'maw'], 7)
sheet(3041, ['dagger', ...Array(11).fill(null), 'jaw_worm_summon_3b4', 'jaw_worm_summon',
  'exploder_summon', 'spiker_add', 'spiker_attack', 'repulsor_summon', null, 'darkling_bha', 'darkling_hab'])

sheet(3168, ['lagavulin', 'gremlin_nob', 'sentries'])
sheet(2942, [null, null, null, 'gremlin_nob', 'lagavulin', 'sentries'], 1)
sheet(3175, ['lagavulin', 'gremlin_nob', 'sentries'], 12)
sheet(3113, ['book_of_stabbing', 'gremlin_leader', 'taskmaster'])
sheet(3123, ['book_of_stabbing', 'gremlin_leader', 'taskmaster'], 1)
sheet(3174, ['book_of_stabbing', 'gremlin_leader', 'taskmaster'], 12)
sheet(3164, ['giant_head', 'nemesis', 'reptomancer'])
sheet(3172, ['giant_head', 'nemesis', 'reptomancer'], 1)
sheet(3173, ['giant_head', 'nemesis', 'reptomancer'], 12)

for (const [id, normal, hard, threshold = 10] of [
  ['slime_boss', 2986, 2983],
  ['hexaghost', 2987, 2984],
  ['guardian_attack', 2988, 2985],
  ['bronze_automaton', 2992, 2989],
  ['the_collector', 2993, 2990],
  ['the_champ', 2994, 2991],
  ['awakened_one_phase_1', 2998, 3015],
  ['donu', 2999, 3016],
  ['time_eater', 3000, 2997],
  ['awakened_one_phase_2', 3003, 3001],
  ['deca', 3004, 3002],
  ['corrupt_heart', 3006, 3005, 11],
]) {
  sheet(normal, [id])
  sheet(hard, [id], threshold)
}
sheet(2884, ['spire_shield'])
sheet(2885, ['spire_spear'])

for (const card of DOWNFALL_PHYSICAL_ENEMY_CARDS) {
  const minAscension = card.minAscension ?? 0
  if (!enemyCardSources.some(entry => entry.id === card.defId && entry.minAscension === minAscension)) {
    enemyCardSources.push({
      id: card.defId, source: `downfall-${Math.floor(card.cardId / 100)}`, index: card.index, minAscension,
    })
  }
}

// These modes are printed together on the same face, not on its reverse.
for (const [id, original] of Object.entries({
  guardian_defensive: 'guardian_attack',
  the_champ_fury: 'the_champ',
  downfall_wrathful_wrath: 'downfall_wrathful',
  downfall_blasphemer_divinity: 'downfall_blasphemer',
})) {
  for (const card of enemyCardSources.filter(entry => entry.id === original)) {
    enemyCardSources.push({ ...card, id })
  }
}
