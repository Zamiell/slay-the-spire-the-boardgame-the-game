# Refactoring plan

This plan records the remaining opportunities from the repository-wide architectural
audit following commit `b7d3bf9a`. The objective is stronger ownership boundaries,
consistent behavior, and reproducible verification, not smaller files for their
own sake. All items below are planned, not implemented.

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

- [ ] Inventory each operation's local and online completion semantics.
- [ ] Reuse the shared lifecycle with operation-specific confirmation evidence.
- [ ] Preserve immediate duplicate-submission locks, scope fencing, and draft
  restoration after definitive refusal.
- [ ] Keep uncertain mutations locked until authoritative evidence or a causally
  later successful refresh resolves them.
- [ ] Replace automatic retries that could repeat an unresolved mutation.

**Completion criteria:** Focused cases cover accepted, refused, reconciled, and
unknown outcomes; stale replies; partial multi-step operations; restoration; and
local callbacks. Promise completion alone must not be treated as proof of delivery.

## 2. Type the internal room model and complete client action types

- **Priority:** High
- **Effort:** Medium to large
- **Starting points:** `tsconfig.json`, `src/protocol/`,
  `src/multiplayer/useRoomSession.ts`, `scripts/lib/rooms.mjs`, and
  `scripts/lib/rooms/`.

Type checking currently covers `src`, while server `.mjs` handlers remain
unchecked. Client action submission accepts `object`, and protocol schemas cover
selected action families.

- [ ] Define the internal room/store shapes separately from public snapshots.
- [ ] Introduce typed client action builders or a discriminated action union.
- [ ] Incrementally check server handlers using those contracts.
- [ ] Reuse existing protocol schemas where their semantics match.
- [ ] Preserve legacy coercion, error ordering, and compatibility where they are
  intentional.

**Completion criteria:** Checked handlers and clients agree on action fields.
Runtime validation, authorization, hidden-information projection, rollback, and
settlement ordering remain authoritative on the server. Types must not replace
those checks or require a wholesale server rewrite.

## 3. Separate replay, persistence, and validation responsibilities

- **Priority:** High
- **Effort:** Medium to large
- **Starting points:** `src/ui/run-log.ts` and the solo-save logic in
  `src/ui/App.tsx`.

The run-log module combines IndexedDB storage, patch generation, state validation,
DOM recording, replay execution, and assistant history. Solo-save validation lives
separately inside the application shell.

- [ ] Extract a pure replay codec for patches, normalization, and validation.
- [ ] Separate persistence from DOM recording and playback.
- [ ] Give assistant history a clear interface to recorded transitions.
- [ ] Share structural validators and versioned migrations where appropriate.
- [ ] Keep strict imported-replay policies distinct from tolerant legacy-save
  recovery.

**Completion criteria:** Existing saves and replays remain compatible; deterministic
state reconstruction, validation limits, malformed-input handling, persistence
ordering, and recording/restoration boundaries retain focused coverage.

## 4. Make asset verification reproducible

- **Priority:** High
- **Effort:** Small to medium
- **Starting points:** `.github/workflows/ci.yml`, `README.md`,
  `scripts/verify-art-bakes.mjs`, and `scripts/animation/monogatari.py`.

Some artwork checks compare regenerated encoded bytes. Arbitrary Pillow wheels
and codec versions can produce different bytes even when source artwork has not
changed, while CI uses distribution-provided tooling.

- [ ] Provide a documented, reproducible environment for asset audits and baking.
- [ ] Record the relevant Python, Pillow, NumPy, WebP, and FFmpeg toolchain.
- [ ] Check compatibility before starting expensive byte-exact audits.
- [ ] Use the same supported toolchain locally and in CI.
- [ ] Distinguish toolchain incompatibility from genuinely stale artwork.

**Completion criteria:** A documented clean setup reproduces committed assets and
passes their audits without ad hoc dependency reconstruction. Do not rebake
unrelated assets merely to accommodate a different local encoder.

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

- [ ] Model drafts around the owning player and authoritative event stage.
- [ ] Centralize selection, invalidation, cancellation, and restoration transitions.
- [ ] Preserve combinations of simultaneous costs and choices rather than forcing
  them into an oversimplified exclusive state.
- [ ] Separate draft transitions from event presentation.

**Completion criteria:** Stage/player changes invalidate only the appropriate
drafts; overlay reopening preserves valid work; refusal and reconnect restore
valid choices; stale selections cannot carry into another event.

## 7. Give combat-stage presentation its own ownership boundary

- **Priority:** Medium
- **Effort:** Large
- **Starting points:** `src/ui/CombatScreen.tsx`,
  `src/ui/combat-screen/hooks.ts`, and existing presentation-event helpers.

Combat presentation still mixes VFX scheduling, actor geometry, layout measurement,
and gameplay interaction in the main screen.

- [ ] Identify cohesive stage-layout and presentation responsibilities.
- [ ] Build on the existing presentation-event lifecycle rather than replacing it.
- [ ] Separate pure layout calculations from DOM measurement and rendering.
- [ ] Keep contact timing, restoration cleanup, and reduced-motion behavior explicit.
- [ ] Avoid an extracted component that merely receives dozens of unrelated props.

**Completion criteria:** The new boundary owns its measurements and presentation
lifecycle, without changing gameplay timing, action authority, hand interaction,
or target selection. Recorded transition coverage must include restoration and
both supported screen classes.

## 8. Finish component-owned CSS consolidation

- **Priority:** Medium
- **Effort:** Medium to large
- **Starting points:** `src/ui/styles.css`, `src/ui/chrome.css`, their imported
  partials, and the existing `interaction-defaults` layer.

Both stylesheet trees deliberately depend on import order, and several surfaces
have rules in both trees. The recently fixed hover override demonstrates the
maintenance cost of competing ownership.

- [ ] Consolidate one surface at a time under a clear owner.
- [ ] Keep theme and interaction defaults below component-specific rules.
- [ ] Remove superseded overrides after confirming their intended behavior.
- [ ] Preserve intentional accessibility, reduced-motion, and responsive overrides.

**Completion criteria:** Each migrated surface has an understandable cascade and
retains its arrival, hover, focus, press, touch, transition, and dismissal behavior.
Do not perform a global stylesheet rewrite.

## 9. Make verifier ownership and output resources explicit

- **Priority:** Medium
- **Effort:** Medium
- **Starting points:** `scripts/lib/affected-verifiers.mjs`,
  `scripts/verify-pipeline.mjs`, `scripts/verify-all.mjs`,
  `scripts/verify-build.mjs`, and browser fixture configuration.

Verifier selection combines dependency analysis, source-text matching, and
ownership tables. Tests also assert hard-coded suite counts. Builds and browser
runs can compete for or overwrite shared output directories.

- [ ] Define suite metadata for ownership, lane, and output/resource requirements.
- [ ] Retain dependency inference and conservative fallback for unmapped changes.
- [ ] Test required and excluded ownership relationships rather than relying on
  magic suite counts.
- [ ] Isolate verification build outputs from production build outputs.
- [ ] Preserve recordings and screenshots across independent suite invocations.
- [ ] Retain standalone focused entrypoints and zero-retry behavior.

**Completion criteria:** Selection remains conservative and explainable, new suites
do not require unrelated count updates, and independent verification cannot corrupt
build outputs or erase another suite's evidence.

## 10. Share HTTP mechanics and response decoding

- **Priority:** Medium
- **Effort:** Medium
- **Starting points:** `src/profile.ts`, `src/mail.ts`, `src/stats.ts`,
  `src/leaderboard.ts`, and `src/multiplayer/room-endpoint.ts`.

These clients independently handle timeouts, JSON parsing, endpoint resets, and
errors.

- [ ] Share request mechanics and typed response decoders.
- [ ] Preserve caller cancellation and distinguish it from timeouts.
- [ ] Keep endpoint-reset and malformed-response handling consistent.
- [ ] Retain domain-specific messages, outboxes, and account-change fencing.
- [ ] Specify retry policy per operation, especially for mutations.

**Completion criteria:** Transport failures and invalid responses are explicit,
while existing operation-specific retry and idempotency guarantees are preserved.
Do not apply a blanket retry policy to every request.

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
