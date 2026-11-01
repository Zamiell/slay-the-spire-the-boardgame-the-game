// Declarative suite ownership. Selection and dependency inference live in affected-verifiers.mjs.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function fixtureSuites(root) {
  const directory = join(root, 'scripts/browser-tests')
  return existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.spec.mjs'))
    .map(name => `verify-${name.slice(0, -'.spec.mjs'.length)}-browser.mjs`).sort() : []
}

export function declaredLane(script) {
  if (script.endsWith('-browser.mjs')) return 'browser'
  if (['verify-build.mjs', 'verify-pipeline.mjs', 'verify-art-toolchain.mjs'].includes(script)) return 'light'
  return undefined
}

export function verifierMetadata(script, root, inferredLane) {
  const lane = declaredLane(script) ?? inferredLane
  const fixture = fixtureSuites(root).includes(script)
  const owners = new Set()
  for (const map of [focusedEngineOwners, focusedUiOwners, focusedOnlyUiOwners]) {
    for (const [file, suites] of map) if (suites.includes(script)) owners.add(file)
  }
  return {
    id: script, lane, owners: [...owners].sort(),
    resources: lane === 'browser' ? ['browser'] : [],
    output: script === 'verify-build.mjs' ? 'isolated-build' : fixture ? 'invocation' : lane === 'browser' ? 'suite-owned' : 'none',
  }
}

export function toolOwners(file, root) {
  if (['scripts/lib/verifier-registry.mjs', 'scripts/lib/affected-verifiers.mjs', 'scripts/verify-all.mjs'].includes(file)) {
    return ['verify-pipeline.mjs']
  }
  if (['scripts/lib/browser-test.mjs', 'scripts/lib/run-browser-spec.mjs', 'scripts/playwright.config.mjs'].includes(file)) {
    return ['verify-pipeline.mjs', ...fixtureSuites(root)]
  }
  if (file === 'scripts/lib/verification-output.mjs') return ['verify-build.mjs', 'verify-pipeline.mjs', ...fixtureSuites(root)]
  if (['infra/art-toolchain.json', 'infra/art-audit.Containerfile', 'scripts/art-audit.mjs', 'scripts/lib/art-toolchain.mjs'].includes(file)) {
    return ['verify-art-toolchain.mjs', 'verify-art-bakes.mjs', 'verify-art-resolution.mjs', 'verify-assets.mjs',
      'verify-run-presentation.mjs', 'verify-upgrade-text.mjs', 'verify-wing-and-throw.mjs']
  }
  return undefined
}
// A Map built from a literal silently keeps the later of two equal keys, which drops the earlier owners.
export function ownerMap(entries) {
  const map = new Map()
  for (const [file, owners] of entries) {
    if (map.has(file)) throw new Error(`Duplicate verifier owner entry for ${file}`)
    map.set(file, owners)
  }
  return map
}

// Focused browser suites often enter through the public run barrel, which is
// too broad for dependency inference. Keep the few domain owners explicit so
// an engine helper change does not launch the entire visual matrix.
export const focusedEngineOwners = ownerMap([
  ...['src/game/relics.ts', 'src/game/run/rooms.ts', 'src/game/run/encounters.ts']
    .map(file => [file, ['verify-relic-refresh-browser.mjs']]),
  ['src/game/combat/enemy-turn.ts', ['verify-incoming-damage-browser.mjs']],
  ['src/game/combat/end-turn.ts', ['verify-retain-selection-browser.mjs', 'verify-incoming-damage-browser.mjs']],
  ['src/game/combat/queries.ts', ['verify-incoming-damage-browser.mjs']],
  ['src/game/combat/preview.ts', ['verify-card-block-preview-browser.mjs']],
  ['src/game/types.ts', ['verify-skins.mjs']],
  // The registry: registering a skin extends every verifier below (they iterate SKINS), so a registry change reruns them all.
  ['src/game/skins.ts', ['verify-skins.mjs', 'verify-skin-browser.mjs', 'verify-test-skins-browser.mjs', 'verify-assets.mjs',
    'verify-ui-helpers.mjs', 'verify-skin-cards-browser.mjs', 'verify-treasure-animation-browser.mjs', 'verify-merchant-overflow-browser.mjs',
    'verify-monogatari-skins-browser.mjs', 'verify-monogatari-online-browser.mjs']],
  // test-skins.mjs appends a registration to the module text of these files, so a change there reruns its proof.
  ['src/game/coins.ts', ['verify-test-skins-browser.mjs']],
  ['src/skin-preference.ts', ['verify-skins.mjs', 'verify-wallet.mjs', 'verify-skin-browser.mjs', 'verify-skin-profile-browser.mjs', 'verify-shop-browser.mjs']],
  ['src/game/assets.ts', ['verify-art-scenes-browser.mjs', 'verify-pages-deploy.mjs', 'verify-skins.mjs', 'verify-skin-cards-browser.mjs']],
  ['src/game/skin-card-faces.ts', ['verify-assets.mjs', 'verify-skin-cards-browser.mjs', 'verify-monogatari-skins-browser.mjs']],
  ['src/game/guardian-gems.ts', ['verify-boon-socket-browser.mjs', 'verify-loot-browser.mjs']],
  ['src/game/run/guardian-gems.ts', ['verify-boon-socket-browser.mjs', 'verify-loot-browser.mjs']],
  ['src/game/acquisition.ts', ['verify-courier-browser.mjs']],
  ['src/game/combat.ts', ['verify-courier-browser.mjs', 'verify-combat-layout-reload-browser.mjs']],
  ['src/game/combat/board.ts', ['verify-combat-layout-reload-browser.mjs']],
  ['src/game/combat/create.ts', ['verify-combat-layout-reload-browser.mjs']],
  ['src/game/combat/items.ts', ['verify-die-relic-browser.mjs']],
  ['src/game/noncombat.ts', ['verify-courier-browser.mjs']],
  ['src/game/run/merchant.ts', ['verify-merchant-overflow-browser.mjs', 'verify-courier-browser.mjs']],
  ['src/game/run/neow.ts', [
    'verify-blessing-potions-browser.mjs', 'verify-boon-socket-browser.mjs', 'verify-neow-viewport-browser.mjs',
  ]],
  ['src/game/run/quick-setup.ts', [
    'verify-guardian-online-start-choice-browser.mjs', 'verify-guardian-start-choice-browser.mjs',
  ]],
  ['src/game/run/relic-acquisition.ts', ['verify-tiny-house-browser.mjs']],
  ['src/game/run/rewards.ts', ['verify-loot-browser.mjs', 'verify-tiny-house-browser.mjs']],
])

export const focusedUiOwners = ownerMap([
  ...['src/ui/combat-screen/useCombatStage.ts', 'src/ui/combat-screen/stage-layout.ts'].map(file => [file, [
    'verify-combat-layout-reload-browser.mjs', 'verify-combat-target-geometry-browser.mjs',
    'verify-character-size-browser.mjs', 'verify-hover-overflow-browser.mjs',
  ]]),
  ['src/ui/combat-screen/useCombatPresentation.ts', [
    'verify-skin-attack-browser.mjs', 'verify-combat-target-geometry-browser.mjs', 'verify-start-turn-resync-browser.mjs',
  ]],
  ...['src/ui/event-draft.ts', 'src/ui/useEventDraft.ts'].map(file => [file, [
    'verify-event-repeat-browser.mjs', 'verify-event-panels-browser.mjs', 'verify-unavailable-event-browser.mjs',
  ]]),
  ...['src/http.ts', 'src/protocol/responses.ts'].map(file => [file, [
    'verify-account-browser.mjs', 'verify-mail-browser.mjs', 'verify-stats-browser.mjs',
    'verify-leaderboard-browser.mjs', 'verify-winning-decks-browser.mjs', 'verify-wallet-sync-browser.mjs',
  ]]),
  ['src/ui/useModalFocus.ts', ['verify-card-picker-browser.mjs', 'verify-card-choices-browser.mjs',
    'verify-deck-inspection-browser.mjs', 'verify-boss-relic-picker-browser.mjs']],
  ...['src/ui/useTooltipPosition.ts', 'src/ui/useKeywordHelp.ts', 'src/ui/tooltip-position.ts']
    .map(file => [file, ['verify-tooltips-browser.mjs', 'verify-resource-tooltips-browser.mjs',
      'verify-orb-tooltips-browser.mjs', 'verify-treasure-layout-browser.mjs', 'verify-room-resume-browser.mjs']]),
  ['src/ui/RunHeader.tsx', ['verify-ui-polish-browser.mjs', 'verify-potion-header-browser.mjs',
    'verify-deck-inspection-browser.mjs', 'verify-incoming-damage-browser.mjs']],
  ['src/ui/RoomBanner.tsx', ['verify-treasure-layout-browser.mjs', 'verify-event-panels-browser.mjs',
    'verify-unavailable-event-browser.mjs']],
  ...['action-evidence.ts', 'combat-resync.ts',
    'potion-selection.ts', 'power-selection.ts', 'usePotionController.ts',
    'selection-scope.ts', 'useScopedSelection.ts']
    .map(file => [`src/ui/combat-screen/${file}`, ['verify-card-choices-browser.mjs',
      'verify-single-enemy-targets-browser.mjs', 'verify-post-roll-item-browser.mjs',
      'verify-start-turn-resync-browser.mjs', 'verify-slayer-powers-browser.mjs']]),
  ...['action-delivery.ts', 'action-lifecycle.ts', 'useActionLifecycle.ts'].map(file =>
    [`src/ui/actions/${file}`, ['verify-noncombat-actions-browser.mjs', 'verify-card-choices-browser.mjs',
      'verify-start-turn-resync-browser.mjs', 'verify-post-roll-item-browser.mjs']]),
  ...['room-action.ts', 'useRoomAction.ts', 'RoomActionStatus.tsx', 'room-action-status.css'].map(file =>
    [`src/ui/actions/${file}`, ['verify-noncombat-actions-browser.mjs', 'verify-boss-relic-picker-browser.mjs']]),
  ...['neow-choice.ts', 'setup-choice.ts'].map(file =>
    [`src/ui/actions/${file}`, ['verify-noncombat-actions-browser.mjs', 'verify-neow-viewport-browser.mjs']]),
  ...['src/ui/campfire-choice.ts', 'src/ui/CampfireCardPicker.tsx'].map(file =>
    [file, ['verify-noncombat-actions-browser.mjs', 'verify-card-picker-browser.mjs']]),
  ['src/ui/combat-screen/usePowerController.ts', ['verify-guardian-card-browser.mjs',
    'verify-hermit-chamber-browser.mjs', 'verify-slayer-discard-and-orbs-browser.mjs',
    'verify-start-turn-resync-browser.mjs']],
  ...['useRelicController.ts', 'relic-selection.ts'].map(file => [`src/ui/combat-screen/${file}`,
    ['verify-relic-action-icons-browser.mjs', 'verify-relic-refresh-browser.mjs', 'verify-post-roll-item-browser.mjs']]),
  ...['src/ui/chrome/treasure.css', 'src/ui/TreasureEffects.tsx', 'public/assets/ui/treasure-skip.svg']
    .map(file => [file, ['verify-treasure-layout-browser.mjs', 'verify-treasure-animation-browser.mjs']]),
  ['src/ui/PotionIcon.tsx', ['verify-treasure-animation-browser.mjs', 'verify-orb-tooltips-browser.mjs',
    'verify-resource-tooltips-browser.mjs']],
  ['src/ui/chrome/back-buttons.css', ['verify-back-buttons-browser.mjs']],
  ['src/ui/chrome/interaction-polish.css', ['verify-ui-polish-browser.mjs', 'verify-treasure-layout-browser.mjs']],
  ['src/ui/useControlPress.ts', ['verify-ui-polish-browser.mjs']],
  ...['src/ui/Tooltip.tsx', 'src/ui/chrome/tooltip-panels.css']
    .map(file => [file, ['verify-tooltips-browser.mjs']]),
  ['src/ui/board-signals.ts', ['verify-die-relic-browser.mjs', 'verify-combat-layout-reload-browser.mjs']],
  ...['src/ui/styles/painterly-combat-stage.css', 'src/ui/styles/hand-layout.css']
    .map(file => [file, ['verify-hand-size-browser.mjs', ...(file.endsWith('/hand-layout.css')
      ? ['verify-card-interaction-browser.mjs', 'verify-start-turn-order-browser.mjs'] : [])]]),
  ...['src/ui/RewardScreen.tsx', 'src/ui/OnlineRewardScreen.tsx']
    .map(file => [file, ['verify-gold-sfx-browser.mjs', 'verify-noncombat-actions-browser.mjs']]),
  ...['scripts/audio/generate-gold-sfx.py', 'public/assets/sfx/gold.wav']
    .map(file => [file, ['verify-assets.mjs', 'verify-gold-sfx-browser.mjs']]),
  ...['src/ui/MapDrawing.tsx', 'src/ui/styles/map-drawing.css', 'src/ui/MapOverlay.tsx']
    .map(file => [file, ['verify-map-drawing-browser.mjs']]),
  ...['src/ui/chrome/keys.css', 'src/ui/chrome/stone-keys.css']
    .map(file => [file, ['verify-button-borders-browser.mjs']]),
  ['src/ui/useButtonShortcut.ts', ['verify-keyboard-browser.mjs', 'verify-card-picker-browser.mjs']],
  ['src/ui/CardPicker.tsx', ['verify-card-picker-browser.mjs', 'verify-merchant-overflow-browser.mjs', 'verify-wing-focus-browser.mjs']],
  ['src/ui/RelicResolvePanel.tsx', ['verify-card-picker-browser.mjs', 'verify-wing-focus-browser.mjs',
    'verify-noncombat-actions-browser.mjs', 'verify-tiny-house-browser.mjs']],
  ['src/ui/NeowScreen.tsx', ['verify-noncombat-actions-browser.mjs', 'verify-neow-viewport-browser.mjs']],
  ['src/ui/QuickSetupScreen.tsx', ['verify-noncombat-actions-browser.mjs']],
  ['src/ui/styles/hand.css', ['verify-card-block-preview-browser.mjs']],
  ['src/ui/styles/combat.css', ['verify-sever-soul-browser.mjs', 'verify-row-target-browser.mjs',
    'verify-soulburn-time-warp-browser.mjs']],
  ['src/ui/chrome/rewards.css', ['verify-loot-browser.mjs', 'verify-boss-relic-picker-browser.mjs']],
  ['src/ui/RewardChoiceScreen.tsx', ['verify-loot-browser.mjs', 'verify-boss-relic-picker-browser.mjs',
    'verify-neow-viewport-browser.mjs', 'verify-boon-socket-browser.mjs']],
  ['src/ui/combat-screen/StartTurnOrder.tsx', ['verify-start-turn-order-browser.mjs']],
  ['src/ui/combat-screen/HandCardSelection.tsx', [
    'verify-sever-soul-browser.mjs', 'verify-start-turn-order-browser.mjs',
    'verify-all-out-attack-browser.mjs', 'verify-survivor-selection-browser.mjs', 'verify-retain-selection-browser.mjs',
  ]],
  ...['src/ui/combat-screen/HandSelectionScreen.tsx', 'src/ui/combat-screen/SelectionScreen.tsx',
    'src/ui/styles/hand-discard-selection.css']
    .map(file => [file, ['verify-sever-soul-browser.mjs', 'verify-survivor-selection-browser.mjs',
      'verify-start-turn-order-browser.mjs', 'verify-retain-selection-browser.mjs', 'verify-runic-pyramid-browser.mjs',
      'verify-card-choices-browser.mjs', 'verify-hermit-combo-browser.mjs', 'verify-orb-selection-browser.mjs']]),
  ...['src/ui/combat-screen/OrbSelectionScreen.tsx', 'src/ui/styles/orb-selection.css']
    .map(file => [file, ['verify-orb-selection-browser.mjs', 'verify-orb-tooltips-browser.mjs', 'verify-turn-targets-browser.mjs']]),
  ['src/ui/CardCollectionOverlay.tsx', [
    'verify-deck-inspection-browser.mjs',
    'verify-flurry-stance-browser.mjs',
    'verify-card-tooltip-browser.mjs', 'verify-card-picker-browser.mjs', 'verify-keyboard-browser.mjs', 'verify-pile-controls-browser.mjs',
  ]],
  ['src/ui/styles/card-picker.css', ['verify-card-picker-browser.mjs', 'verify-deck-inspection-browser.mjs']],
  ['src/ui/App.tsx', ['verify-tooltips-browser.mjs', 'verify-room-resume-browser.mjs', 'verify-ascension-sync-browser.mjs', 'verify-restricted-browser.mjs', 'verify-run-replay-browser.mjs', 'verify-replay-controls-browser.mjs', 'verify-courier-browser.mjs',
    'verify-combat-vfx-preload-browser.mjs', 'verify-tutorial-browser.mjs', 'verify-enemy-hover-browser.mjs', 'verify-skin-browser.mjs']],
  ['src/ui/CampfireScene.tsx', ['verify-art-scenes-browser.mjs', 'verify-skin-browser.mjs']],
  ['src/ui/campfire-seats.ts', ['verify-art-scenes-browser.mjs', 'verify-skin-browser.mjs']],
  ['src/ui/CampfireScreen.tsx', ['verify-art-scenes-browser.mjs', 'verify-monogatari-skins-browser.mjs',
    'verify-noncombat-actions-browser.mjs']],
  ['src/ui/CompendiumScreen.tsx', ['verify-compendium-browser.mjs', 'verify-skin-browser.mjs', 'verify-skin-cards-browser.mjs']],
  ['src/ui/StatsScreen.tsx', ['verify-stats-browser.mjs', 'verify-skin-cards-browser.mjs']],
  ['src/ui/skin-context.tsx', ['verify-skin-cards-browser.mjs', 'verify-card-rendering-browser.mjs']],
  ['src/ui/Card.tsx', ['verify-card-block-preview-browser.mjs', 'verify-card-rendering-browser.mjs', 'verify-skin-cards-browser.mjs', 'verify-card-damage-preview-browser.mjs',
    'verify-flurry-stance-browser.mjs', 'verify-tooltips-browser.mjs',
    'verify-enemy-card-cube-browser.mjs', 'verify-claw-cubes-browser.mjs']],
  ['src/ui/CardFace.tsx', ['verify-card-rendering-browser.mjs', 'verify-skin-cards-browser.mjs']],
  ['src/ui/ShopScreen.tsx', ['verify-shop-browser.mjs', 'verify-wallet-sync-browser.mjs', 'verify-skin-cards-browser.mjs', 'verify-monogatari-skins-browser.mjs']],
  ['src/ui/styles/shop.css', ['verify-shop-browser.mjs']],
  ['src/ui/LeaderboardScreen.tsx', ['verify-leaderboard-browser.mjs']],
  ['src/ui/CombatScreen.tsx', [
    'verify-orb-selection-browser.mjs',
    'verify-retain-selection-browser.mjs', 'verify-card-choices-browser.mjs',
    'verify-card-block-preview-browser.mjs',
    'verify-single-enemy-targets-browser.mjs',
    'verify-soulburn-time-warp-browser.mjs',
    'verify-manual-end-turn-browser.mjs',
    'verify-sever-soul-browser.mjs',
    'verify-die-breakdown-browser.mjs',
    'verify-flurry-stance-browser.mjs',
    'verify-relic-action-icons-browser.mjs',
    'verify-temporary-status-browser.mjs',
    'verify-resource-tooltips-browser.mjs',
    'verify-act-four-facing-browser.mjs', 'verify-combat-video-browser.mjs',
    'verify-unload-shivs-browser.mjs', 'verify-pile-controls-browser.mjs',
    'verify-start-turn-party-browser.mjs',
    'verify-start-turn-resync-browser.mjs',
    'verify-die-relic-browser.mjs',
    'verify-courier-browser.mjs', 'verify-hermit-combo-browser.mjs', 'verify-hermit-load-reconnect-browser.mjs',
    'verify-hermit-online-staged-trigger-browser.mjs', 'verify-combat-layout-reload-browser.mjs',
    'verify-row-target-browser.mjs', 'verify-turn-targets-browser.mjs', 'verify-elite-signatures-browser.mjs',
    'verify-hero-potions-browser.mjs', 'verify-end-turn-drag-browser.mjs', 'verify-card-damage-preview-browser.mjs',
    'verify-skin-browser.mjs', 'verify-skin-attack-browser.mjs', 'verify-monogatari-animation-browser.mjs',
    'verify-monogatari-skins-browser.mjs', 'verify-monogatari-online-browser.mjs', 'verify-defect-chan-evoke-browser.mjs',
    'verify-double-tap-recover-browser.mjs',
  ]],
  ['src/ui/CombatAnimation.tsx', ['verify-combat-video-browser.mjs', 'verify-combat-hand-viewport-browser.mjs']],
  ['src/ui/combat-webm-sources.json', ['verify-art-bakes.mjs', 'verify-combat-video-browser.mjs']],
  ['src/ui/EnemyCard.tsx', ['verify-elite-signatures-browser.mjs', 'verify-elite-intent-browser.mjs', 'verify-skin-attack-browser.mjs', 'verify-boss-heavy-attacks-browser.mjs',
    'verify-enemy-card-cube-browser.mjs', 'verify-enemy-effects-browser.mjs']],
  ['src/ui/combat-screen/hooks.ts', ['verify-card-damage-preview-browser.mjs', 'verify-skin-attack-browser.mjs']],
  ['src/ui/combat-screen/staged-attacks.ts', ['verify-assets.mjs', 'verify-skin-attack-browser.mjs']],
  ['src/ui/chrome/campfire.css', ['verify-art-scenes-browser.mjs', 'verify-card-picker-browser.mjs']],
  ['src/ui/styles/staged-attacks.css', ['verify-skin-attack-browser.mjs']],
  ['src/ui/styles/attack-timing.css', ['verify-defect-chan-evoke-browser.mjs']],
  ['src/ui/SettingsDialog.tsx', ['verify-card-damage-preview-browser.mjs', 'verify-live-run-browser.mjs', 'verify-ui-polish-browser.mjs']],
  ['src/ui/game-settings.ts', ['verify-card-damage-preview-browser.mjs']],
  ['src/ui/rig-animation-metadata.json', ['verify-elite-intent-browser.mjs', 'verify-hero-potions-browser.mjs']],
  ['src/ui/hero-art-head.json', ['verify-hero-potions-browser.mjs', 'verify-assets.mjs']],
  ['src/ui/elite-art-head.json', ['verify-elite-intent-browser.mjs', 'verify-assets.mjs']],
  ['src/ui/combat-vfx.ts', ['verify-elite-signatures-browser.mjs', 'verify-elite-intent-browser.mjs', 'verify-skin-attack-browser.mjs', 'verify-skin-browser.mjs', 'verify-boss-heavy-attacks-browser.mjs']],
  ['src/ui/combat-sfx.ts', ['verify-skin-attack-browser.mjs', 'verify-skin-browser.mjs', 'verify-boss-heavy-attacks-browser.mjs']],
  ['src/ui/styles/boss-heavy-attacks.css', ['verify-boss-heavy-attacks-browser.mjs']],
  ['src/ui/styles/elite-signatures.css', ['verify-elite-signatures-browser.mjs', 'verify-elite-intent-browser.mjs']],
  ['src/ui/ItemImage.tsx', ['verify-courier-browser.mjs']],
  ['src/ui/MailBox.tsx', ['verify-mail-browser.mjs']],
  ['src/ui/MapScreen.tsx', ['verify-map-drawing-browser.mjs', 'verify-wing-focus-browser.mjs']],
  ['src/ui/RoomScreen.tsx', ['verify-treasure-layout-browser.mjs', 'verify-treasure-animation-browser.mjs',
    'verify-unavailable-event-browser.mjs', 'verify-card-choices-browser.mjs', 'verify-merchant-overflow-browser.mjs',
    'verify-joust-browser.mjs', 'verify-scrap-ooze-browser.mjs', 'verify-event-panels-browser.mjs', 'verify-potion-header-browser.mjs', 'verify-relic-refresh-browser.mjs']],
  ['src/ui/chrome/item-tiles.css', ['verify-relic-refresh-browser.mjs', 'verify-map-drawing-browser.mjs']],
  ['src/ui/chrome/event-phone.css', ['verify-event-panels-browser.mjs', 'verify-scrap-ooze-browser.mjs']],
  ['src/ui/chrome/event-loot.css', ['verify-event-panels-browser.mjs', 'verify-scrap-ooze-browser.mjs', 'verify-potion-header-browser.mjs']],
  ['src/ui/chrome/merchant-arrival.css', ['verify-event-panels-browser.mjs', 'verify-merchant-overflow-browser.mjs', 'verify-assets.mjs']],
  ['src/ui/chrome/room-stages.css', ['verify-event-panels-browser.mjs']],
  ['src/ui/styles/non-combat-rooms.css', ['verify-event-panels-browser.mjs']],
  ['src/ui/chrome/mailbox.css', ['verify-mail-browser.mjs']],
  ['src/multiplayer/useRoomSession.ts', ['verify-ascension-sync-browser.mjs', 'verify-combat-layout-reload-browser.mjs', 'verify-skin-browser.mjs', 'verify-skin-cards-browser.mjs', 'verify-start-turn-resync-browser.mjs', 'verify-monogatari-online-browser.mjs']],
  ['src/ui/RelicChip.tsx', ['verify-courier-browser.mjs', 'verify-die-relic-browser.mjs']],
  ['src/ui/DieRelicChoices.tsx', ['verify-die-relic-browser.mjs']],
  ['src/ui/OnlineGame.tsx', ['verify-retain-selection-browser.mjs', 'verify-courier-browser.mjs', 'verify-skin-browser.mjs', 'verify-skin-cards-browser.mjs', 'verify-start-turn-resync-browser.mjs', 'verify-monogatari-online-browser.mjs']],
  ['src/ui/OnlineCampfireScreen.tsx', ['verify-art-scenes-browser.mjs', 'verify-monogatari-online-browser.mjs',
    'verify-noncombat-actions-browser.mjs']],
  ['src/ui/StartMenu.tsx', ['verify-run-replay-browser.mjs', 'verify-title-menu-browser.mjs', 'verify-tutorial-browser.mjs', 'verify-skin-browser.mjs', 'verify-ui-polish-browser.mjs']],
  ['src/ui/ProfileScreen.tsx', ['verify-skin-profile-browser.mjs', 'verify-account-browser.mjs', 'verify-wallet-sync-browser.mjs', 'verify-restricted-browser.mjs']],
  ['src/profile.ts', ['verify-account-browser.mjs', 'verify-restricted-browser.mjs', 'verify-ascension-sync-browser.mjs']],
  ['src/campaign-storage.ts', ['verify-ascension-sync-browser.mjs', 'verify-daily-climb-browser.mjs', 'verify-multiplayer-resume-browser.mjs']],
  ['src/ui/styles/profile.css', ['verify-skin-profile-browser.mjs', 'verify-account-browser.mjs']],
  ['src/ui/sfx.ts', ['verify-run-replay-browser.mjs', 'verify-gold-sfx-browser.mjs']],
  ['src/ui/combat-screen/HermitTriggerChoice.tsx', [
    'verify-hermit-combo-browser.mjs', 'verify-hermit-online-staged-trigger-browser.mjs',
  ]],
  ['src/ui/combat-screen/vfx.tsx', ['verify-lightning-act2-browser.mjs', 'verify-skin-attack-browser.mjs', 'verify-defect-chan-evoke-browser.mjs']],
  ['src/ui/styles/compendium.css', ['verify-compendium-browser.mjs', 'verify-deck-inspection-browser.mjs']],
  ['src/ui/styles/prompt.css', ['verify-hermit-combo-browser.mjs', 'verify-card-interaction-browser.mjs']],
  ['src/ui/TokenRow.tsx', [
    'verify-enemy-effects-browser.mjs',
    'verify-orb-tooltips-browser.mjs',
    'verify-resource-tooltips-browser.mjs',
    'verify-turn-targets-browser.mjs', 'verify-row-target-browser.mjs', 'verify-combat-target-geometry-browser.mjs',
  ]],
  ['src/ui/styles/bars-and-tokens.css', ['verify-resource-tooltips-browser.mjs']],
  ['src/ui/chrome/tooltips.css', ['verify-resource-tooltips-browser.mjs']],
  ['src/ui/styles/enemy-portrait.css', ['verify-enemy-effects-browser.mjs', 'verify-orb-tooltips-browser.mjs', 'verify-row-target-browser.mjs', 'verify-turn-targets-browser.mjs', 'verify-end-turn-drag-browser.mjs', 'verify-pile-controls-browser.mjs']],
  ['src/ui/styles/presentation-overlays.css', ['verify-lightning-act2-browser.mjs']],
  ['src/ui/styles/stage-scale.css', ['verify-act-four-facing-browser.mjs', 'verify-combat-layout-reload-browser.mjs', 'verify-elite-intent-browser.mjs', 'verify-hero-potions-browser.mjs', 'verify-temporary-status-browser.mjs', 'verify-power-hover-browser.mjs']],
  ['src/ui/styles/title-menu.css', ['verify-run-replay-browser.mjs', 'verify-replay-controls-browser.mjs', 'verify-title-menu-browser.mjs']],
])

export const focusedOnlyUiOwners = ownerMap([
  ...['data/card-upgrade-layouts.json', 'scripts/art/stabilize-upgrade-text.py',
    'scripts/art/verify-upgrade-text.py', 'scripts/lib/stabilize-upgrade-text.mjs']
    .map(file => [file, ['verify-upgrade-text.mjs', 'verify-upgrade-text-browser.mjs', 'verify-assets.mjs']]),
  ...['src/ui/CardInspectionDialog.tsx', 'src/ui/CardInspectionProvider.tsx', 'src/ui/card-inspection-context.ts']
    .map(file => [file, ['verify-deck-inspection-browser.mjs', 'verify-card-context-inspection-browser.mjs']]),
  ...['src/ui/CombatDie.tsx', 'src/ui/combat-die-breakdown.ts', 'src/ui/styles/combat-die.css']
    .map(file => [file, ['verify-die-breakdown-browser.mjs']]),
  ...['src/ui/draw-lock-text.ts', 'src/ui/DrawLockedRules.tsx', 'src/ui/card-draw-strikes.json',
    'src/ui/styles/draw-locked-rules.css', 'src/ui/KeywordText.tsx']
    .map(file => [file, ['verify-draw-lock-browser.mjs']]),
  ['src/ui/OutsidePotionBar.tsx', ['verify-potion-header-browser.mjs']],
  ...['src/ui/IncomingDamage.tsx', 'src/ui/styles/incoming-damage.css']
    .map(file => [file, ['verify-incoming-damage-browser.mjs']]),
  ...['src/ui/DeveloperConsole.tsx', 'src/ui/developer-commands.ts', 'src/ui/console-rewind.ts', 'src/ui/styles/developer-console.css']
    .map(file => [file, ['verify-developer-console-browser.mjs']]),
  ['src/ui/combat-token-help.ts', ['verify-resource-tooltips-browser.mjs', 'verify-card-tooltip-browser.mjs']],
  ['src/ui/combat-screen/resource-visibility.ts', ['verify-resource-tooltips-browser.mjs', 'verify-claw-cubes-browser.mjs']],
  ['src/ui/card-tooltip-position.ts', ['verify-card-tooltip-browser.mjs']],
  ['src/ui/combat-screen/card-play-requirements.ts', [
    'verify-card-interaction-browser.mjs', 'verify-survivor-selection-browser.mjs',
    'verify-turn-targets-browser.mjs', 'verify-hermit-combo-browser.mjs', 'verify-hermit-load-reconnect-browser.mjs',
  ]],
  ['src/ui/combat-screen/card-interaction.ts', ['verify-card-interaction-browser.mjs']],
  ['src/ui/combat-screen/card-input-state.ts', ['verify-card-interaction-browser.mjs']],
  ['src/ui/combat-screen/useCardInteraction.ts', [
    'verify-card-interaction-browser.mjs', 'verify-hand-layout-browser.mjs', 'verify-combat-hand-viewport-browser.mjs',
    'verify-run-replay-browser.mjs',
  ]],
  ['src/ui/combat-screen/CardInteractionLayer.tsx', [
    'verify-card-block-preview-browser.mjs',
    'verify-flurry-stance-browser.mjs',
    'verify-card-damage-preview-browser.mjs',
    'verify-card-interaction-browser.mjs', 'verify-hand-layout-browser.mjs', 'verify-combat-hand-viewport-browser.mjs',
  ]],
  ['src/ui/combat-screen/card-play.ts', [
    'verify-card-damage-preview-browser.mjs',
    'verify-card-interaction-browser.mjs', 'verify-survivor-selection-browser.mjs', 'verify-turn-targets-browser.mjs',
    'verify-hermit-combo-browser.mjs', 'verify-hermit-load-reconnect-browser.mjs',
    'verify-run-replay-browser.mjs',
  ]],
  ['.github/workflows/ci.yml', ['verify-assets.mjs', 'verify-pipeline.mjs']],
  ['scripts/audio/generate-combat-sfx.py', ['verify-assets.mjs', 'verify-safari-sound-browser.mjs', 'verify-rig-animation-browser.mjs']],
  ['scripts/lib/skin-attack-fixture.mjs', ['verify-skin-attack-browser.mjs', 'verify-monogatari-animation-browser.mjs', 'verify-monogatari-skins-browser.mjs', 'verify-defect-chan-evoke-browser.mjs']],
  ['scripts/art/campfire-sitters.py', ['verify-assets.mjs', 'verify-art-scenes-browser.mjs']],
  ...['scripts/art/normalize-card-text.py', 'scripts/art/normalize-inflame-text.py']
    .map(file => [file, ['verify-assets.mjs', 'verify-card-rendering-browser.mjs']]),
  ['scripts/sync-card-assets.mjs', ['verify-assets.mjs', 'verify-card-rendering-browser.mjs', 'verify-upgrade-text.mjs']],
  ['scripts/sync-downfall-card-assets.mjs', ['verify-assets.mjs', 'verify-downfall-card-audit.mjs',
    'verify-upgrade-text.mjs', 'verify-upgrade-text-browser.mjs']],
  ['scripts/art/export-kratos-menu.py', ['verify-assets.mjs', 'verify-skin-browser.mjs']],
  ['scripts/art/export-kratos-noncombat.py', ['verify-assets.mjs', 'verify-merchant-overflow-browser.mjs', 'verify-treasure-animation-browser.mjs']],
  ['scripts/calibrate-hero-head.py', ['verify-hero-potions-browser.mjs', 'verify-art-bakes.mjs']],
  ['scripts/animation/encode-safari-attacks.py', ['verify-assets.mjs', 'verify-rig-animation-browser.mjs']],
  ['scripts/animation/check-attack-parity.py', ['verify-rig-animation-browser.mjs']],
  ['scripts/calibrate-elite-intent.py', ['verify-elite-intent-browser.mjs', 'verify-art-bakes.mjs']],
  ['scripts/animation/elite_signatures.py', ['verify-art-bakes.mjs', 'verify-elite-signatures-browser.mjs']],
  ['src/mail.ts', ['verify-mail-browser.mjs']],
  ['src/ui/useWebMcp.ts', ['verify-webmcp-browser.mjs', 'verify-live-run-browser.mjs']],
  ...['src/ui/live-run.ts', 'src/ui/AssistantSettings.tsx', 'src/ui/assistant-settings.css']
    .map((file) => [file, ['verify-live-run-browser.mjs']]),
  ['src/ui/live-run-history.ts', ['verify-live-run-history.mjs', 'verify-live-run-browser.mjs']],
  ...['scripts/live-run.mjs', 'scripts/lib/live-run-server.mjs']
    .map((file) => [file, ['verify-live-run.mjs', 'verify-live-run-browser.mjs']]),
  ['src/ui/TutorialCoach.tsx', ['verify-tutorial-browser.mjs']],
  ...['common', 'general', 'helpers', 'index', 'lessons', 'run', 'types',
    ...['defect', 'guardian', 'hermit', 'hexaghost', 'ironclad', 'silent', 'slime_boss', 'watcher'].map((hero) => `heroes/${hero}`)]
    .map((file) => [`src/ui/tutorial/${file}.ts`, ['verify-tutorial-browser.mjs']]),
  ['src/ui/styles/tutorial.css', ['verify-tutorial-browser.mjs']],
  ['src/ui/CourierPanel.tsx', ['verify-courier-browser.mjs']],
  ['src/ui/chrome/courier.css', ['verify-courier-browser.mjs']],
  ['src/ui/PowerRow.tsx', ['verify-power-hover-browser.mjs']],
  ['src/ui/run-log.ts', ['verify-run-replay-browser.mjs', 'verify-replay-controls-browser.mjs', 'verify-live-run-browser.mjs']],
  // Nothing imports the admin CLI, so without this it would count as uncovered and select every verifier.
  ['scripts/mail-admin.mjs', ['verify-mail.mjs']],
  ...['src/ui/ReplayBar.tsx', 'src/ui/run-replay.ts', 'src/ui/styles/replay-bar.css']
    .map((file) => [file, ['verify-replay-controls-browser.mjs']]),
  ['src/ui/styles/powers-in-play.css', ['verify-power-hover-browser.mjs']],
])
