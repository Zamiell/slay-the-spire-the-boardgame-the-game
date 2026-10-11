# Failure modes and focused verification plan (before implementation)

- A new skin becomes a character, changes cards/rules/RNG, or accepts the wrong
  owner. Keep the existing skin model; exercise real engine plays and verify
  saved runs retain the original character plus a valid skin.
- Purchase spends the wrong amount, repeats charges, touches packs or loses the
  other hero's choice. Buy both at 2,500 coins through the actual Shop, reload,
  check independent profile choices, and retain existing account-wallet tests.
- Missing, unowned or forged skins appear equipped; different accounts or tabs
  leak choices. Retain the existing skin/profile/account-wallet verifiers.
- Solo, lobby, teammate, reconnect, restored run or reduced-motion art resolves
  to an original hero or stale animation. Cover both skins in the real app and
  production combat screen on desktop and horizontal phone, Chromium/WebKit.
- Attack clocks, contact or projectile origins change when keyed by the new
  visual ids. Reuse base-character choreography and inspect full recordings,
  repeat/queued plays, restoration and the exact idle return.
- Hands, anatomy, sword length, head/body scale, foot anchors or costume change
  between poses; sprites clip or cross-fade limbs. Inspect source contact sheets
  and recorded attacks; exporters assert measured landmarks and margins.
- Card illustrations are generic/repeated, misassigned, miscropped or miss pack
  cards/upgraded faces. Generate every released owner card with its original
  semantic reference; inspect all art sheets and verify registry coverage.
- Card compositing damages frame, cost, rules or title. Derive owner-correct
  masks/registrations, preserve pixels outside masks, and record source hashes.
- Campfire parties miss scenes, include a replaced original hero, mix stature,
  sit in fire or lose a teammate. Export every supported visual party and inspect
  solo, mixed pair and four-seat composites against the scene's perspective.
- Shop-standing, portrait, wallpaper or treasure open/grip art changes identity,
  breaks transparency, palm/finger anatomy, grip alignment or performance caps.
  Inspect generated inputs/outputs and verify existing asset format/size gates.
- New catalogue tiles overflow/are inaccessible on desktop or landscape phone.
  Record/screenshot Shop/Profile and verify no sideways overflow or missing art.
- Kratos regresses while sharing presentation logic. Run its focused animation,
  skin, skin-card and profile verifiers, not the legacy browser umbrella.

Repeatable evidence: focused E2E scripts, screenshots, recorded browser videos,
source/prompt/output hash manifests and deterministic rebuild commands. Final
release additionally requires changed light lane without retries, one fresh
batch of three independent clean reviews, successful GitHub Build and test jobs,
and remote/deployment SHA verification.

## Verifier-selection maintenance found during release gate

New focused browser suites must be selected for their owning skin, combat,
Shop, card-face and online/reconnect surfaces; shared sheets must retain those
new direct consumers without expanding to unrelated suites. Existing selector
count assertions must explicitly include the new owners. Disposable Git graph
fixtures must not inherit a developer's mandatory signing service: unsigned
throwaway commits are required there, while real delivery commits stay signed.
