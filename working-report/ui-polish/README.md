# Interface polish report

## Scope and baseline

This pass improves the shared interaction language across the interface rather
than redesigning the board or replacing every screen's artwork.

- Audited the UI renderer inventory: **75 TSX files and 438 native control render
  sites**, including buttons, inputs, selects, disclosures, and dialogs.
  [Full file inventory](inventory.json).
- Captured **20 representative views on desktop and horizontal phone**, before
  implementation and after it: **80 screenshots / 40 matched comparisons**.
- Before images were captured from the UI at commit `b8ca5fc8`, before the
  production changes in this pass.
- Screenshots use isolated, synthetic accounts and runs. They do not inspect or
  alter a human save, account, leaderboard, settings, or running browser.
- Desktop screenshots show mouse hover; horizontal-phone screenshots show
  keyboard focus. Actual held touch presses and cancellation are verified
  separately. A still screenshot cannot show easing or transition duration.

**[Open the complete before/after gallery](gallery.md).**

## What changed

### 1. One interaction cadence for ordinary controls

Ordinary buttons and disclosures now share a fast response and a more relaxed
release: **50 ms hover/focus, 200 ms press, 500 ms ease-out**. Transitions cover
colour, border, shadow, opacity, and each control's existing transforms.

This applies across menus, character/run setup, settings, archive screens,
online entry/lobby, shop actions, event actions, campfire choices, confirmation
dialogs, replay buttons, and the less frequently visited setup and utility
screens. It avoids adding a different animation implementation to every button.

Cards, enemies, map nodes, card piles, Powers, and map-drawing tools retain their
specialized transition ownership. Their transforms are explicitly excluded from
the generic control rule.

### 2. Main-menu text and navigation art

- Main-menu labels grow to **105%** on hover/keyboard focus, compress to **95%**
  while pressed, and settle back on release.
- Only the label moves: the button's hit target does not resize or jump.
- HUD and corner navigation icons enlarge to **110%**, tilt **12 degrees**, and
  brighten. The tilt settles with a restrained overshoot.
- The icon animates inside its stable button. This avoids moving click targets
  or changing the containing block of a tooltip.
- Return-ribbon arrows get a small directional nudge and an explicit press
  response without scaling the entire ribbon.
- Existing title ornaments, character wallpapers, character-copy transitions,
  campaign artwork, and run-mode artwork remain intact.

### 3. Touch feedback that does not take over the gesture

Some touch browsers defer native `:active` styling until release. A small,
delegated press-feedback hook now mirrors a held touch/pen press for ordinary
controls.

- Feedback appears during the press, not after the action.
- Moving more than 12 CSS pixels cancels the decorative pressed state.
- Release, pointer cancellation, window blur, and component cleanup clear it.
- The hook never calls an action, prevents a default event, or captures a
  pointer. Scrolling and normal click dispatch remain native.
- Disabled controls and dedicated card/enemy/map/pile interactions are excluded.
- Existing two-tap potion confirmation remains two-tap confirmation.

### 4. Settings now look and respond like game controls

- Checkboxes use a bronze recess, a gold selected face, and a high-contrast check
  mark instead of an unadorned native square.
- The inputs remain real checkboxes, with native labels, Space-key activation,
  checked state, and disabled semantics.
- Volume sliders have a recessed track, live gold fill, and a metallic thumb.
  The fill follows the actual value; keyboard arrows still change the setting
  by its existing five-point step.
- Settings rows highlight on hover/focus so the selected field is easier to
  track across a wide panel.
- Selected tabs have a persistent lower highlight; hover is not the only
  indication of selection.
- The settings body has a stable, themed scrollbar gutter and contained
  scrolling.

### 5. Event, reward, and campfire decisions

- Event and loot rows gain a clear cool-blue inset highlight instead of relying
  only on brightness.
- Event headings nudge slightly toward the choice on hover/focus.
- Reward icons and campfire illustrations enlarge subtly; a held press
  compresses the illustration.
- Pressed rows look recessed.
- The row itself does not grow into adjacent choices or create overflow.
- Existing costs, unavailable-choice explanations, selection rules, claims,
  and confirmation behavior are unchanged.

### 6. Panel arrivals and information hierarchy

- Settings, collection/confirmation dialogs, map overlays, mail panels, shop
  confirmation, archive panels, online entry panels, and setup panels fade in
  over **180 ms**.
- Settings tab content uses the same short arrival.
- Main-menu and event choices use a small **24 ms stagger**, capped at **96 ms**
  for longer main menus.
- Shared keyword/help panels get an **80 ms** fade.
- These are opacity-only panel entrances. Moving or scaling a panel containing
  fixed tooltips can break tooltip coordinates, so that was deliberately avoided.
- Full-screen backgrounds do not fade with the panel. In particular,
  multiplayer entry keeps the same painted background as the main menu.
- No gameplay action waits for a decorative animation to finish.

### 7. Keyboard, reduced motion, and high-contrast behavior

- Ordinary controls have a consistent inset focus ring, visible inside beveled
  or ribbon-shaped boundaries.
- Pressed/selected states remain distinct from hover.
- Both the game's Reduce motion setting and the OS preference suppress the new
  scaling, tilting, nudging, staggering, and panel motion.
- Focus and colour cues remain visible with motion disabled.
- Forced-colors mode restores native checkbox appearance and system-colour
  outlines.
- Opening the online lobby's Run settings disclosure and pressing Escape now
  closes it in one step, even when its help tooltip is visible. The disclosure
  handles Escape before incidental tooltip dismissal.

## STS2 reference and adaptation decisions

The user-provided local decompilation was used to inspect behavior, not as code
to paste into this project. No decompiled source or newly extracted proprietary
textures are included in this change.

| Reference inspected | Behavior used | Web adaptation |
|---|---|---|
| `NMainMenuTextButton.cs` | 1.05 hover scale, 0.95 press scale, 50 ms hover, 200 ms press, 500 ms release | Animate a label span inside the existing hit target. |
| `NTopBarButton.cs` | 1.1 icon scale, -12-degree tilt, brighter hover, 500 ms rotation | Animate the image, not its button. Browser easing approximates the game's interpolation. |
| `NBackButton.cs` | Small hover enlargement, press settling, short response and slower release | Nudge/enlarge the arrow inside the existing ribbon silhouette. |
| `NConfirmButton.cs` | Separate hover, held-press, and release states | Preserve each existing confirmation action; share the visual cadence. |
| `NSettingsTab.cs` | Gold emphasis and gradual release from focus | Persistent selected underline plus bounded hover/focus treatment; no expanding tab hitboxes. |
| `NSettingsSlider.cs`, `NSettingsTickbox.cs` | Clear focus treatment around settings controls | Style native browser inputs instead of replacing their keyboard/touch mechanics. |
| `NEventOptionButton.cs` | Fast focus response, blue outline, distinct pressed state | Keep full-width rows stationary; highlight the bevel and move only the heading. |
| `NRewardButton.cs` | Unified row emphasis and a distinct press response | Retain compact loot rows and existing touch confirmation. |
| `NRestSiteButton.cs` | Animate the visual and distinguish pressing from hovering | Move the illustration inside a fixed choice; use the shorter shared cadence rather than a one-second press. |
| `NEndTurnButton.cs` | Explicit enabled, hovered, and pressed presentation | Preserve the existing End Turn geometry, shortcut, drag behavior, and authoritative action timing. |

This is **not a claim of pixel-exact parity with every STS2 screen**. The project
uses a different renderer, existing artwork, board-game rules, and horizontal
phone constraints. Numeric interaction targets were matched where appropriate;
layout-safe highlighting, native form semantics, and existing polished systems
take precedence elsewhere.

## Screen-family audit

| Family | Treatment |
|---|---|
| Welcome/account | Shared control transitions, press feedback, focus treatment; authentication logic unchanged. |
| Main menu, run mode, character, campaign | Animated menu labels/navigation art; preserve dedicated scene/art transitions. |
| Neow and quick setup | Shared buttons, form controls, and setup arrival; preserve automatic choices and card reveals. |
| Combat | Ordinary toolbar/confirmation feedback and navigation art; preserve hand fan, card input, enemy targeting, VFX, and pile geometry. |
| Map and drawing | Animated navigation entry/return controls and overlay arrival; retain map-node and drawing-tool animation ownership. |
| Events | Bounded cool-blue selection emphasis and heading movement; preserve unavailable-choice and shared-decision behavior. |
| Merchant, treasure, rewards, Courier | Shared action feedback and loot illustration emphasis; preserve shop art, prices, previews, reveals, and acquisition rules. |
| Campfire | Hover/press illustration response and bounded choice emphasis; preserve seated scene and full-card selection flows. |
| Card selectors and inspection | Style surrounding controls, upgrade checkboxes, and eligible dialog arrivals; retain card-specific motion and modal behavior. |
| Compendium, stats, leaderboard, profile | Panel arrivals, consistent control focus/press feedback, persistent selected-tab emphasis; data/query logic unchanged. |
| Shop/card packs/skins | Shared tab/control behavior and confirmation arrival; preserve existing pack fans, purchase reveal, and ownership handling. |
| Online entry/lobby and shared screens | Stable backgrounds, shared controls/checkboxes, improved disclosure Escape priority; networking and authority unchanged. |
| Settings, mail, assistant, developer utilities | Shared field/control treatment and relevant panel arrivals; no changes to permissions or data handling. |
| Replay, pause, give-up, run end | Shared control response and focus; preserve playback, voting, confirmation, and campaign recording behavior. |

The file inventory covers render sites, not every runtime combination of cards,
relics, party members, unlocks, and network states. The screenshot gallery covers
20 representative views; the remaining families inherit the shared treatment
and are listed here rather than presented as individually photographed.

## Implementation

| File | Responsibility |
|---|---|
| `src/ui/chrome/interaction-polish.css` | Shared cadence, control feedback, form styling, panel arrivals, and accessibility overrides. |
| `src/ui/chrome.css` | Loads the shared polish after existing chrome. |
| `src/ui/StartMenu.tsx` | Stable label spans for main-menu text animation. |
| `src/ui/SettingsDialog.tsx` | Typed live slider-fill value. |
| `src/ui/useControlPress.ts` | Passive, cancelable touch/pen feedback without taking over input. |
| `src/ui/App.tsx` | Installs the shared press-feedback hook. |
| `src/ui/OnlineGame.tsx` | Gives an open Run settings disclosure priority when handling Escape. |
| `scripts/verify-ui-polish-browser.mjs` | Isolated review fixtures, interaction checks, renderer inventory, and reproducible captures. |

## Validation results

The affected light lane passed, including TypeScript checking, architecture,
verifier routing, and the native-tooltip audit. Focused Chromium browser checks
passed for:

- The new 20-view desktop/horizontal-phone sweep, including held mouse/touch
  presses, scroll/cancel behavior, stable hit targets, native form keyboard
  input, potion confirmation, both reduced-motion controls, and forced colors.
- Main-menu and multiplayer-entry layout, including unchanged background pixels.
- Map drawing, erasing, persistence, touch behavior, and safe navigation.
- Hand sizing and independent card-input behavior on desktop and horizontal phone.
- Loot flow and existing reward-card animation behavior.
- Continuous beveled borders and keyboard-focus visibility.
- Multiplayer entry/lobby presentation, focus navigation, and disclosure dismissal.

The multiplayer verifier was updated to start keyboard navigation from an
explicitly focused control rather than assume that a mouse click leaves focus
behind, and to expect the new visible inset focus ring.

This is focused Chromium coverage, not a claim that every browser or every
possible game state was exercised. The legacy whole-browser umbrella was not run.

## Reproducing the review

```sh
# Focused interaction and screen checks, without rewriting the report:
node scripts/verify-ui-polish-browser.mjs

# Check just one supported screen class:
node scripts/verify-ui-polish-browser.mjs --screen=horizontal-phone

# Refresh the after gallery after an intentional presentation change:
node scripts/verify-ui-polish-browser.mjs --capture=after
```

Do not regenerate the `before` directory on the changed UI: it is the historical
baseline. Capture manifests record the view and interaction used for each image.
The browser helpers mute both media and Web Audio in the isolated test sessions.
