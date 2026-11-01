# Refactoring plan

This plan records the remaining opportunities from the repository-wide architectural
audit following commit `b7d3bf9a`. The objective is stronger ownership boundaries,
consistent behavior, and reproducible verification, not smaller files for their
own sake. Progress and validation evidence are recorded with each item.

## Recommended sequence

1. Finish shared action-lifecycle adoption, establish typed room/action contracts,
   and make the asset toolchain reproducible.
2. Separate replay and persistence responsibilities, consolidate event drafts,
   and improve verification ownership and HTTP infrastructure.
3. Introduce an explicitly partial online combat view model, then improve combat
   presentation ownership and consolidate CSS one surface at a time.

These are sequencing recommendations, not requirements to combine unrelated work
into one change. Deliver bounded, independently verifiable increments.

## 1. Finish adopting the shared action lifecycle

- **Priority:** High
- **Effort:** Medium
- **Starting points:** `src/ui/RelicResolvePanel.tsx`,
  `src/ui/NeowScreen.tsx`, `src/ui/QuickSetupScreen.tsx`, and `src/ui/actions/`.

These screens still maintain separate pending-request and retry logic. Some paths
clear or rearm after uncertain delivery rather than waiting for authoritative
evidence.

- [x] Inventory each operation's local and online completion semantics.
- [x] Reuse the shared lifecycle with operation-specific confirmation evidence.
- [x] Preserve immediate duplicate-submission locks, scope fencing, and draft
  restoration after definitive refusal.
- [x] Keep uncertain mutations locked until authoritative evidence or a causally
  later successful refresh resolves them.
- [x] Replace automatic retries that could repeat an unresolved mutation.

**Completion criteria:** Focused cases cover accepted, refused, reconciled, and
unknown outcomes; stale replies; partial multi-step operations; restoration; and
local callbacks. Promise completion alone must not be treated as proof of delivery.

**Implemented:** Neow, relic acquisition, and Quick Start/Catch Up now use the
shared lifecycle. Dependent relic actions execute in order and stop on uncertainty.
Relic drafts survive authoritative reward updates without remounting an in-flight
controller. Automatic setup no longer retries an uncertain action on a timer.

**Evidence:** Type checking and noncombat/combat lifecycle property checks pass.
New setup, Tiny House, and Neow recovery cases pass on desktop and horizontal phone;
existing Tiny House, Neow viewport, and loot integration checks pass. The Tiny House
resume regression now explicitly verifies the intended whole-loot rewind before
reacquisition. The combined final gate and visual review remain tracked below.

## 2. Type the internal room model and complete client action types

- **Priority:** High
- **Effort:** Medium to large
- **Starting points:** `tsconfig.json`, `src/protocol/`,
  `src/multiplayer/useRoomSession.ts`, `scripts/lib/rooms.mjs`, and
  `scripts/lib/rooms/`.

Type checking currently covers `src`, while server `.mjs` handlers remain
unchecked. Client action submission accepts `object`, and protocol schemas cover
selected action families.

- [x] Define the internal room/store shapes separately from public snapshots.
- [x] Introduce typed client action builders or a discriminated action union.
- [x] Incrementally check server handlers using those contracts.
- [x] Reuse existing protocol schemas where their semantics match.
- [x] Preserve legacy coercion, error ordering, and compatibility where they are
  intentional.

**Completion criteria:** Checked handlers and clients agree on action fields.
Runtime validation, authorization, hidden-information projection, rollback, and
settlement ordering remain authoritative on the server. Types must not replace
those checks or require a wholesale server rewrite.

**Implemented:** A private room/seat/store core and canonical noncombat decision
contracts now connect the browser's typed `decide` API to checked campfire,
merchant, and reward handlers. `pnpm typecheck` and production builds check this
server slice as well as `src`. Negative compile fixtures reject incomplete
payments, missing Potion recipients, invalid reward choices, and public seats used
as private identities. The remaining combat transport stays on its existing
compatibility path; this is the planned incremental boundary, not a claim that
the entire JavaScript server has become TypeScript.

**Evidence:** Both compiler projects, 488 room checks, and protocol checks pass.
Runtime validation, errors, and transaction behavior remain covered.

## 3. Separate replay, persistence, and validation responsibilities

- **Priority:** High
- **Effort:** Medium to large
- **Starting points:** `src/ui/run-log.ts` and the solo-save logic in
  `src/ui/App.tsx`.

The run-log module combines IndexedDB storage, patch generation, state validation,
DOM recording, replay execution, and assistant history. Solo-save validation lives
separately inside the application shell.

- [x] Extract a pure replay codec for patches, normalization, and validation.
- [x] Separate persistence from DOM recording and playback.
- [x] Give assistant history a clear interface to recorded transitions.
- [x] Share structural validators and versioned migrations where appropriate.
- [x] Keep strict imported-replay policies distinct from tolerant legacy-save
  recovery.

**Completion criteria:** Existing saves and replays remain compatible; deterministic
state reconstruction, validation limits, malformed-input handling, persistence
ordering, and recording/restoration boundaries retain focused coverage.

**Implemented:** The stable run-log facade now delegates to a pure codec, ordered
IndexedDB storage, read-only recorded-history access, DOM controls, recorder, and
player. Selector parsing is an explicit browser capability, not a hidden codec
dependency. Solo-save recovery, ownership checks, checkpoint matching, and legacy
Daily migration no longer live in App. Shared phase validation does not weaken the
strict replay import budgets or impose them on recoverable local journals.
Asynchronous IndexedDB open failures now refuse recording rather than falsely
acknowledging durable storage.

**Evidence:** Both compiler projects, affected light checks, pure patch properties,
malformed/legacy import cases, replay controls, complete recorded-history access,
solo resume, and whole-room resume pass. Browser coverage explicitly checks
asynchronous storage refusal. Architecture checks prevent browser services from
entering the codec and shared structural validator.

## 4. Make asset verification reproducible

- **Priority:** High
- **Effort:** Small to medium
- **Starting points:** `.github/workflows/ci.yml`, `README.md`,
  `scripts/verify-art-bakes.mjs`, and `scripts/animation/monogatari.py`.

Some artwork checks compare regenerated encoded bytes. Arbitrary Pillow wheels
and codec versions can produce different bytes even when source artwork has not
changed, while CI uses distribution-provided tooling.

- [x] Provide a documented, reproducible environment for asset audits and baking.
- [x] Record the relevant Python, Pillow, NumPy, WebP, and FFmpeg toolchain.
- [x] Check compatibility before starting expensive byte-exact audits.
- [x] Use the same supported toolchain locally and in CI.
- [x] Distinguish toolchain incompatibility from genuinely stale artwork.

**Completion criteria:** A documented clean setup reproduces committed assets and
passes their audits without ad hoc dependency reconstruction. Do not rebake
unrelated assets merely to accommodate a different local encoder.

**Implemented:** `infra/art-toolchain.json` pins immutable Ubuntu and Node images,
a dated APT snapshot, and codec versions. `scripts/art-audit.mjs` provides native
preflight and isolated Podman/Docker audits. Container audits have no network
access and mount the checkout read-only. CI installs from the same package
snapshot and reads the Node version from the manifest. README documents setup and
intentional toolchain upgrades.

**Evidence:** The container builds and its preflight passes. All six image/media
audit suites passed in that environment: five in the initial run, then the asset
inventory after adding its missing Git dependency. No artwork was regenerated.

## 5. Give online combat an explicitly partial view model

- **Priority:** Medium; substantial safety benefit
- **Effort:** Large
- **Starting points:** `src/ui/OnlineGame.tsx`, `src/protocol/room.ts`,
  `src/ui/combat-screen/types.ts`, and combat preview/query consumers.

The online adapter currently substitutes empty arrays for hidden piles and
manufactures RNG and other fields to satisfy `CombatState`. That requires
consumers to remember which apparently valid values are unavailable information.

- [ ] Define a read-only presentation model that distinguishes unknown from empty.
- [ ] Separate local simulation capabilities from online presentation capabilities.
- [ ] Adapt renderers and queries to request only the information they actually use.
- [ ] Keep previews that need private information explicitly unavailable.
- [ ] Remove fabricated authoritative-state fields as consumers migrate.

**Completion criteria:** Local and online presentation remain consistent without
treating hidden data as empty data. Private arrays and supplies remain private,
and online previews cannot accidentally simulate from invented state.

## 6. Consolidate event-selection state

- **Priority:** Medium
- **Effort:** Medium
- **Starting point:** `EventScreen` in `src/ui/RoomScreen.tsx`.

The event screen maintains many independent draft fields and reset effects for
payments, trades, rewards, recipients, and prepared choices.

- [x] Model drafts around the owning player and authoritative event stage.
- [x] Centralize selection, invalidation, cancellation, and restoration transitions.
- [x] Preserve combinations of simultaneous costs and choices rather than forcing
  them into an oversimplified exclusive state.
- [x] Separate draft transitions from event presentation.

**Completion criteria:** Stage/player changes invalidate only the appropriate
drafts; overlay reopening preserves valid work; refusal and reconnect restore
valid choices; stale selections cannot carry into another event.

**Implemented:** `event-draft.ts` owns typed draft transitions, and `useEventDraft`
reconciles them before paint. Payment, item, card-reward, source-catalogue, trade,
and prepared-combat scopes invalidate independently. Stale callbacks cannot edit a
new owner or reveal. Recipient-dependent loot defaults initialize once and do not
overwrite explicit choices when an overlay replays its effects.

**Evidence:** Pure scope/cancellation regressions, UI helpers, and physical event
rules pass. Event repeat/reconnect coverage now verifies unrelated-refresh
preservation and new-instance reset, with recordings on both supported screens.
Event panel and unavailable-event suites pass.

## 7. Give combat-stage presentation its own ownership boundary

- **Priority:** Medium
- **Effort:** Large
- **Starting points:** `src/ui/CombatScreen.tsx`,
  `src/ui/combat-screen/hooks.ts`, and existing presentation-event helpers.

Combat presentation still mixes VFX scheduling, actor geometry, layout measurement,
and gameplay interaction in the main screen.

- [x] Identify cohesive stage-layout and presentation responsibilities.
- [x] Build on the existing presentation-event lifecycle rather than replacing it.
- [x] Separate pure layout calculations from DOM measurement and rendering.
- [x] Keep contact timing, restoration cleanup, and reduced-motion behavior explicit.
- [x] Avoid an extracted component that merely receives dozens of unrelated props.

**Completion criteria:** The new boundary owns its measurements and presentation
lifecycle, without changing gameplay timing, action authority, hand interaction,
or target selection. Recorded transition coverage must include restoration and
both supported screen classes.

**Implemented:** `useCombatStage` owns fitting, DOM measurements, scroll intent,
restoration readiness, and native transition suspension. `stage-layout` supplies
pure fitting math. `useCombatPresentation` owns the shared restoration-aware
audio/VFX feed and stagger derivation. Character choreography and gameplay
authority remain in their existing owners.

**Evidence:** The affected light checks, both compiler projects, production build,
reload restoration, hover overflow, and Chromium/WebKit target geometry and
character sizing pass. Desktop/phone stage recording contact sheets were reviewed.
Sizing now measures short-lived poses atomically rather than racing their removal,
and verifies the actual supported WebM/MOV/WebP policy. Browser libraries were
restored in an isolated container, with no host package installation. The complete
skin-attack presentation matrix and start-turn restoration checks also pass.
The combined final UI review remains part of the final gate.

## 8. Finish component-owned CSS consolidation

- **Priority:** Medium
- **Effort:** Medium to large
- **Starting points:** `src/ui/styles.css`, `src/ui/chrome.css`, their imported
  partials, and the existing `interaction-defaults` layer.

Both stylesheet trees deliberately depend on import order, and several surfaces
have rules in both trees. The recently fixed hover override demonstrates the
maintenance cost of competing ownership.

- [x] Consolidate one surface at a time under a clear owner.
- [x] Keep theme and interaction defaults below component-specific rules.
- [x] Remove superseded overrides after confirming their intended behavior.
- [x] Preserve intentional accessibility, reduced-motion, and responsive overrides.

**Completion criteria:** Each migrated surface has an understandable cascade and
retains its arrival, hover, focus, press, touch, transition, and dismissal behavior.
Do not perform a global stylesheet rewrite.

**Implemented:** `CampfireScreen.css` now owns local/online campfire layout, scene,
responsive treatment, and interaction feedback. The competing base/theme partials
are removed, along with obsolete inline-deck rules left behind by the shared
CardPicker migration. Theme keys and cross-component accessibility policies remain
intentionally shared; low-priority interaction defaults remain layered.

**Evidence:** Before/after computed-style comparisons are identical on desktop
and horizontal phone for idle, hover, keyboard focus, press, chosen, disabled,
game/OS reduced motion, and forced colors. Campfire scene, local/online action,
shared picker, hover overflow, and Tiny House suites pass. Screenshots were
reviewed, and the complete light lane passes 92/92 in the compatible toolchain.
The combined recorded UI sweep remains part of final delivery.

## 9. Make verifier ownership and output resources explicit

- **Priority:** Medium
- **Effort:** Medium
- **Starting points:** `scripts/lib/affected-verifiers.mjs`,
  `scripts/verify-pipeline.mjs`, `scripts/verify-all.mjs`,
  `scripts/verify-build.mjs`, and browser fixture configuration.

Verifier selection combines dependency analysis, source-text matching, and
ownership tables. Tests also assert hard-coded suite counts. Builds and browser
runs can compete for or overwrite shared output directories.

- [x] Define suite metadata for ownership, lane, and output/resource requirements.
- [x] Retain dependency inference and conservative fallback for unmapped changes.
- [x] Test required and excluded ownership relationships rather than relying on
  magic suite counts.
- [x] Isolate verification build outputs from production build outputs.
- [x] Preserve recordings and screenshots across independent suite invocations.
- [x] Retain standalone focused entrypoints and zero-retry behavior.

**Completion criteria:** Selection remains conservative and explainable, new suites
do not require unrelated count updates, and independent verification cannot corrupt
build outputs or erase another suite's evidence.

**Implemented:** `verifier-registry.mjs` centralizes ownership and declares lanes,
browser resources, and output policy. Unknown suites still use dependency/source
inference and conservative fallback. Infrastructure has focused owners instead of
accidentally selecting the legacy umbrella. Build verification uses a guarded,
fresh scratch directory; production builds still own `dist`. Managed Playwright
invocations have unique directories, and all their manual screenshots now use the
shared `artifacts` fixture or `testInfo.outputPath()`. Specialized legacy suites
retain their explicitly suite-owned output contracts.

**Evidence:** The 31 pipeline checks cover ownership, fallback, resource lanes,
and output safety without magic suite totals. Production and verification builds
passed simultaneously with identical bundle names. Repeated standalone fixture
runs retained both sets of screenshots and desktop/phone recordings; URL-based
and extended-fixture capture cases also pass.

## 10. Share HTTP mechanics and response decoding

- **Priority:** Medium
- **Effort:** Medium
- **Starting points:** `src/profile.ts`, `src/mail.ts`, `src/stats.ts`,
  `src/leaderboard.ts`, and `src/multiplayer/room-endpoint.ts`.

These clients independently handle timeouts, JSON parsing, endpoint resets, and
errors.

- [x] Share request mechanics and typed response decoders.
- [x] Preserve caller cancellation and distinguish it from timeouts.
- [x] Keep endpoint-reset and malformed-response handling consistent.
- [x] Retain domain-specific messages, outboxes, and account-change fencing.
- [x] Specify retry policy per operation, especially for mutations.

**Completion criteria:** Transport failures and invalid responses are explicit,
while existing operation-specific retry and idempotency guarantees are preserved.
Do not apply a blanket retry policy to every request.

**Implemented:** `src/http.ts` owns one request attempt, JSON parsing, cancellation,
deadline cleanup, and response errors. `src/protocol/responses.ts` supplies typed
decoders used by profile, mailbox, stats, and leaderboard clients. Retry decisions
remain in their existing domain owners; mutation transport never retries itself.
Malformed successful responses fail explicitly, while non-JSON refusals retain
their HTTP classification. Wallet catalogue normalization preserves valid balances
when a newer server knows additional packs or skins.

**Evidence:** HTTP contract/deadline cases and compiler checks pass, as do account,
mailbox, stats, leaderboard, winning-deck, and wallet browser checks. Integration
coverage also exposed and fixed mouse-opened card-collection focus restoration,
without changing keyboard-shortcut return focus.

## Boundaries to preserve

- Keep the gameplay engine dependency-free and acyclic.
- Preserve the intentional effect/trigger recursion boundary in
  `src/game/combat/effects.ts`.
- Keep character-specific rules and animation choreography explicit.
- Retain specialized multi-page browser fixtures when isolation would destroy the
  scenario being exercised.
- Do not split card/enemy definition tables merely because they are large.
- Do not introduce additional libraries without a concrete reduction in complexity.

## Delivery and verification

Follow `AGENTS.md` for each implementation increment:

- Start with affected-verifier listings, then use the light lane and focused
  browser owners during iteration.
- Preserve gameplay, multiplayer authority, privacy, compatibility, and local
  behavior with focused regression cases.
- For UI changes, cover desktop and horizontal-phone screens only; record and
  inspect normal-motion transitions and screenshots, and run the complete UI sweep.
- Complete the required light, type, build, and focused checks before publishing.
  The legacy browser umbrella remains opt-in.
- Update this plan as items are completed, narrowed, or rejected with evidence.
