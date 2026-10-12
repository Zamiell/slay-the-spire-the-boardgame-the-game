# Defect-chan: focused lightning/dark beam evokes

Follow-up to release `097cbb3e`: the user requested orb focusing and casting,
not merely a relocated beam on an idle character. The failure contract was
written before implementation in [evoke-failure-modes.md](evoke-failure-modes.md).

## Presentation

Reuse the existing registered hero/release cels and lightning/dark channel art:
no new generated raster, frame registration, gameplay rule or room state.

- 0–240ms: focus the correct stationary orb between her hands.
- 240–760ms: extend the hand; hold the matching orb at the palm while every
  authoritative lightning/dark beam connects from that point to its target.
- 760–900ms: return to the registered hero stance.
- At 900ms recovery completion: relinquish body ownership. Presentation events
  retain their existing 1800ms impact lifetime, without masking a later attack.
- Original 240ms beam onset, 520ms beam duration, impacts and SFX stay unchanged.
  A normal offensive card still uses its normal flying projectile.

Simultaneous evokes retain all beam events but share one actor pose owner.
If a later warm evoke overlaps an earlier warm beam from the same actor, its
focus phase keeps the hand extended and focuses at the palm, rather than
retracting the hand out from under the older beam. The final recovery is safe
because older beams end before the newer beam ends. A cold newer event does not
remove an older decoded pose. One actor's events cannot affect another's hold.
Normal attack cels are masked with visibility only, so their original animation
and flying-projectile clocks continue rather than restarting after recovery.

Pose, orb texture and beam-origin readiness are latched per combat/event. Warm
origin is normalized **[.71, .478]**; failed/late-decode fallback stays at the
existing chest point **[.497, .482]** without mid-flight re-aiming. The retained
registration field `evokeOrigin` describes this cold fallback. Frost, passive
orbs and original Defect's existing beam presentation are unchanged. Death,
restoration, disconnect and reduced motion remove pose ownership through the
existing live-presentation lifecycle.

Predecoded cache entries are not enough to guarantee a newly mounted image is
paintable on its first frame. Until all mounted pose/orb images finish loading,
with nonzero intrinsic dimensions, the evoke
layer stays hidden and the prior body remains visible; its clocks keep running.
This avoids a first-frame blank without restarting the beam or changing targets.

## Repeatable evidence

```sh
node scripts/verify-defect-chan-evoke-browser.mjs
node scripts/verify-monogatari-animation-browser.mjs
node scripts/verify-skin-attack-browser.mjs --engine=chromium --screen=desktop --record
node scripts/verify-monogatari-online-browser.mjs
node scripts/verify-all.mjs --changed=origin/master --lane=light --jobs=4
```

The new focused E2E uses real Dual Cast and upgraded Fission events through the
production renderer, not synthetic presentation events. It records Chromium and
WebKit on desktop (1440×900) and horizontal phone (844×390 CSS pixels).
Pose screenshots are taken in their own evokes with the animations frozen at a time inside the
pose, because a software-rendered frame can outlast the 140 ms recover pose; the timing assertions
run on unfrozen evokes.
`artifacts/defect-chan-evoke/report.json`, four WebM recordings and phase/queued/
cold/original-Defect screenshots are inspectable and reproducible. The final
focused command passed **4/4**, zero browser/asset errors: one decoded body at
every sampled frame, all focus/cast/recovery phases, matching orb art, every
beam's target endpoint and clock, cold latch, mixed/simultaneous/queued and
attack-overlap behavior, plus restoration/disconnect/death/reduced motion.
It also checks an ordinary attack after recovery, with charge/release screenshots.
An attack started during the cast must resume its existing clock after recovery.

The existing animation regression was updated to expect the warm palm origin
and five predecoded Defect-chan assets (three cels plus two orb textures);
Ironclad/Kratos preload counts are unchanged. Pipeline ownership includes the
new focused verifier and retains existing visual owners. Test fixtures respect
static orb slots: upgraded Fission chooses slots 0 and 1, not slot 0 twice.
The existing queued-body assertion now respects inherited visibility and loaded
dimensions, rather than counting an intentionally masked, non-painted attack.

The local artifact directory also retains iteration logs. Diagnostic per-frame
records exposed a first-frame mounted-image decode gap; the implementation now
keeps the prior body visible until the actual elements have loaded dimensions.
The assets are already predecoded; this avoids redundant per-mount decode waits.
A separate repro
confirmed a settled pose could linger for the 1800ms impact lifetime; recovery
now unmounts the pose at 900ms. Both regressions have focused E2E coverage, not
waived checks. An overlap-clock assertion also reproduced an attack resuming at
116ms instead of its original elapsed time; visibility masking fixes that reset.
The final full matrix keeps a strict one-body assertion.
The recordings and screenshots are local
production-screen engine fixtures, not a claim of an AI campaign playtest.
Release gates and deployed-SHA proof are recorded alongside task artifacts.

Final local regression results: existing anime combat matrix **8/8** (both
skins, both engines, both screen classes), Kratos Chromium desktop animation
check passed, and real two-seat online cosmetic/private-state/reconnect checks
passed **4/4** with eight recordings. Pipeline selection checks passed **15/15**.
These are the related set because the change touches shared combat rendering,
not prices, ownership storage, card composition or noncombat assets. The old
browser umbrella/full browser lane were not run. Three fresh independent clean
reviews and the required no-retry light lane remain mandatory before commit;
CI and Pages/server SHA parity are checked after the authorized push.

All four fresh evoke recordings were sampled at 3fps and visually inspected,
including hand-origin beams, fixed body/feet size, recovery, queued casts and
original Defect. Phase screenshots provide larger source/hand detail. WebKit
phone PNGs use its native 3× device-pixel ratio; the supported viewport is still
844×390 CSS pixels. No portrait or arbitrary viewport was added.
