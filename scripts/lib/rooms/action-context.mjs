import { UID_LIMIT } from '../../../src/protocol/actions.ts'

// Normalization is intentionally distinct from validation: legacy action
// families filter, truncate or ignore these values instead of refusing them.
export const uidList = (value) => Array.isArray(value)
  ? value.filter((item) => typeof item === 'string').slice(0, UID_LIMIT) : undefined

// Invalid indices remain sentinels, never array property names supplied by a client.
export const slotList = (value) => Array.isArray(value)
  ? value.slice(0, UID_LIMIT).map((item) => Number.isInteger(item) && item >= 0 ? item : -1) : undefined

export const targetList = (value) => Array.isArray(value)
  ? value.slice(0, UID_LIMIT).map((item) => item === null || typeof item === 'string' ? item : '') : undefined

const string = (value) => typeof value === 'string' ? value : undefined
const integer = (value) => Number.isInteger(value) ? value : undefined

export const hermitDieRelicList = (value) => Array.isArray(value)
  ? value.slice(0, UID_LIMIT).flatMap((choice) => {
    const discardUids = uidList(choice?.discardUids)
    if (!choice || typeof choice.playerId !== 'string' || !Number.isInteger(choice.relicIndex) ||
      choice.relicIndex < 0 || !Number.isInteger(choice.abilityIndex) || choice.abilityIndex < 0 ||
      choice.enemyUid !== undefined && choice.enemyUid !== null && typeof choice.enemyUid !== 'string' ||
      choice.targetPlayerId !== undefined && choice.targetPlayerId !== null && typeof choice.targetPlayerId !== 'string' ||
      choice.discardUids !== undefined && discardUids?.length !== choice.discardUids.length) return []
    return [{
      playerId: choice.playerId,
      relicIndex: choice.relicIndex,
      abilityIndex: choice.abilityIndex,
      ...(choice.enemyUid === undefined ? {} : { enemyUid: choice.enemyUid }),
      ...(choice.targetPlayerId === undefined ? {} : { targetPlayerId: choice.targetPlayerId }),
      ...(discardUids === undefined ? {} : { discardUids }),
    }]
  })
  : undefined

/** Call only with validated field groups and the writer's contextual choices. */
export function cardPlayContext(action, playerId, fields, contextual, chamber = false) {
  return {
    ...fields,
    ...contextual,
    // Chamber has always ignored malformed scalar targets; hand/copy plays
    // instead pass them to the engine. Do not silently unify those policies.
    enemyUid: (chamber ? string(action.enemyUid) : action.enemyUid) ?? null,
    playerId: (chamber ? string(action.playerId) : action.playerId) ?? playerId,
    switchWithPlayerId: (chamber ? string(action.switchWithPlayerId) : action.switchWithPlayerId) ?? null,
    mode: chamber ? integer(action.mode) : action.mode,
    spendMiracle: action.spendMiracle === true,
    chooseLoadSelf: action.chooseLoadSelf === true,
    guardianModeShift: action.guardianModeShift === true,
    secondGuardianModeShift: action.secondGuardianModeShift === true,
    scryToHandUid: string(action.scryToHandUid),
    metamorphosisPowerUid: string(action.metamorphosisPowerUid),
    evokeSlots: slotList(action.evokeSlots),
    evokeEnemyUids: targetList(action.evokeEnemyUids),
  }
}

export function powerContext(action, fields) {
  return {
    ...fields,
    enemyUid: action.enemyUid ?? null,
    enemyRow: integer(action.enemyRow) ?? null,
    playerId: string(action.playerId) ?? null,
    guardianModeShift: action.guardianModeShift === true,
    cardUid: string(action.cardUid),
    orbSlots: slotList(action.orbSlots),
  }
}

export function potionContext(action, shivEnemyUids) {
  return {
    enemyUid: action.enemyUid ?? null,
    targetPlayerId: action.targetPlayerId ?? null,
    enemyRow: integer(action.enemyRow) ?? null,
    shivEnemyUids,
    recoverDiscardUid: string(action.recoverDiscardUid),
    // Unlike bounded card/Power choices, Potion exhaust lists are unbounded.
    exhaustUids: Array.isArray(action.exhaustUids)
      ? action.exhaustUids.filter((uid) => typeof uid === 'string') : undefined,
    die: integer(action.die),
    replacePotionId: string(action.replacePotionId),
    transformHandUid: string(action.transformHandUid),
    recoverExhaustUid: string(action.recoverExhaustUid),
    targetRelicPlayerId: string(action.targetRelicPlayerId),
    targetRelicIndex: integer(action.targetRelicIndex),
    targetAbilityIndex: integer(action.targetAbilityIndex),
  }
}
