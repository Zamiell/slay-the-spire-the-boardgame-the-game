import type { StartTurnAbility, StartTurnChoice } from '../../game/combat.ts'

export type StartTurnDraft = {
  order: string[]
  enemyTargets: Record<string, string | undefined>
  playerTargets: Record<string, string | undefined>
  exhaustUids: Record<string, string | undefined>
  modeShifts: Record<string, boolean | undefined>
  targets: Record<string, (string | null | undefined)[]>
  evokeSlots: Record<string, number[]>
  evokeTargets: Record<string, (string | null | undefined)[]>
  scryOrder: string[]
  scryPicked: string[]
}

export type StartTurnDraftInput = {
  scope: string
  viewerId: string
  online: boolean
  abilities: readonly StartTurnAbility[]
  savedTargets?: Readonly<Record<string, string>>
  savedChoices?: readonly StartTurnChoice[]
  scryIds: readonly string[]
  scryKey: string
}
type Scopes = { owner: string; viewer: string; plan: string; peers: string; scries: string; reveal: string }
export type StartTurnDraftState = { scopes: Scopes; value: StartTurnDraft }
export type StartTurnFieldUpdate<Key extends keyof StartTurnDraft> =
  StartTurnDraft[Key] | ((previous: StartTurnDraft[Key]) => StartTurnDraft[Key])

export function startTurnDraftScopes(input: StartTurnDraftInput): Scopes {
  const { abilities, online, viewerId, savedChoices, savedTargets } = input
  return {
    owner: input.scope,
    viewer: viewerId,
    plan: JSON.stringify([
      abilities.map(ability => [ability.id, ability.overflowShivs, ability.targets?.map(target => target.uid),
        ability.players?.map(player => player.id), ability.exhaustCards?.map(card => card.uid),
        ability.evokeChoice?.options.map(option => [option.slot, option.orb]),
        !online || ability.playerId === viewerId ? savedTargets?.[ability.id] : undefined]),
      (savedChoices ?? []).filter(choice => !online || abilities.some(ability =>
        ability.id === choice.id && ability.playerId === viewerId)),
    ]),
    peers: online ? JSON.stringify(abilities.filter(ability => ability.playerId !== viewerId)
      .map(ability => [ability.id, savedTargets?.[ability.id], savedChoices?.find(choice => choice.id === ability.id)])) : '',
    scries: JSON.stringify(input.scryIds),
    reveal: input.scryKey,
  }
}

function restoredPlan(input: StartTurnDraftInput) {
  const saved = new Map(input.savedChoices?.map(choice => [choice.id, choice]))
  const entries = <Value>(pick: (ability: StartTurnAbility, choice: StartTurnChoice | undefined) => Value) =>
    Object.fromEntries(input.abilities.map(ability => [ability.id, pick(ability, saved.get(ability.id))]))
  return {
    order: input.abilities.map(ability => ability.id),
    enemyTargets: entries((ability, choice) => input.savedTargets?.[ability.id] ?? choice?.enemyUid ??
      (ability.targets?.length === 1 ? ability.targets[0]!.uid : undefined)),
    playerTargets: entries((ability, choice) => choice?.targetPlayerId ??
      (ability.players?.length === 1 ? ability.players[0]!.id : undefined)),
    exhaustUids: entries((ability, choice) => choice?.exhaustUids?.[0] ??
      (ability.exhaustCards?.length === 1 ? ability.exhaustCards[0]!.uid : undefined)),
    modeShifts: entries((_ability, choice) => choice?.guardianModeShift),
    targets: entries((ability, choice) => choice?.shivEnemyUids ?? Array<string | undefined>(ability.overflowShivs).fill(undefined)),
    evokeSlots: entries((_ability, choice) => choice?.evokeSlots ?? []),
    evokeTargets: entries((_ability, choice) => choice?.evokeEnemyUids ?? []),
  }
}

export function createStartTurnDraft(input: StartTurnDraftInput): StartTurnDraftState {
  return { scopes: startTurnDraftScopes(input), value: {
    ...restoredPlan(input), scryOrder: [...input.scryIds], scryPicked: [],
  } }
}

export function reconcileStartTurnDraft(state: StartTurnDraftState, input: StartTurnDraftInput): StartTurnDraftState {
  const scopes = startTurnDraftScopes(input)
  if (state.scopes.owner !== scopes.owner || input.online && state.scopes.viewer !== scopes.viewer)
    return createStartTurnDraft(input)
  let value = state.value
  if (state.scopes.plan !== scopes.plan) value = { ...value, ...restoredPlan(input) }
  else if (state.scopes.peers !== scopes.peers) {
    const peers = restoredPlan({ ...input, abilities: input.abilities.filter(ability => ability.playerId !== input.viewerId) })
    value = { ...value,
      enemyTargets: { ...value.enemyTargets, ...peers.enemyTargets },
      playerTargets: { ...value.playerTargets, ...peers.playerTargets },
      exhaustUids: { ...value.exhaustUids, ...peers.exhaustUids },
      modeShifts: { ...value.modeShifts, ...peers.modeShifts },
      targets: { ...value.targets, ...peers.targets },
      evokeSlots: { ...value.evokeSlots, ...peers.evokeSlots },
      evokeTargets: { ...value.evokeTargets, ...peers.evokeTargets },
    }
  }
  if (state.scopes.scries !== scopes.scries) value = { ...value, scryOrder: [...input.scryIds] }
  if (state.scopes.reveal !== scopes.reveal) value = { ...value, scryPicked: [] }
  return value === state.value && state.scopes.viewer === scopes.viewer ? state : { scopes, value }
}

export function updateStartTurnField<Key extends keyof StartTurnDraft>(
  state: StartTurnDraftState, scopes: Scopes, field: Key, update: StartTurnFieldUpdate<Key>,
): StartTurnDraftState {
  const key = field === 'scryOrder' ? 'scries' : field === 'scryPicked' ? 'reveal' : 'plan'
  if (state.scopes.owner !== scopes.owner || state.scopes.viewer !== scopes.viewer || state.scopes[key] !== scopes[key] ||
    key === 'plan' && state.scopes.peers !== scopes.peers) return state
  const previous = state.value[field]
  const value = typeof update === 'function' ? update(previous) : update
  return Object.is(previous, value) ? state : { ...state, value: { ...state.value, [field]: value } }
}
