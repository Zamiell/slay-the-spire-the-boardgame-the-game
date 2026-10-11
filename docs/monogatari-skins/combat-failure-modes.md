# Combat failure modes before implementation

- Grip anatomically impossible: disconnected wrist/thumb, fused/extra fingers, hands on blade. Inspect each complete drawing and hand crops.
- Head/body/weapon changes size during attack: register head-size and both foot anchors, never fit individual alpha bounds independently.
- Sword tip penetrates floor or misses target: contact tip must stay above sole baseline and contact clock matches travel; audit desktop/horizontal phone recording.
- Limb morphing or detached pieces: only complete held drawings; no optical-flow interpolation or cut-up generated limbs.
- Foot sliding at pose changes: draw planted feet, register same baseline and rear sole; no scale pulse during idle.
- Skin incorrectly inherits Kratos multi-hit behavior: retain base-character clocks and projectile paths, stagedAttack false.
- Defect projectile originates at face after human conversion: align core visual to chest/hand release rather than eyes.
- Safari still image/no attack: static complete pose layers for both characters avoid video codec requirements.
- Reduced motion or dead state missing art: export matching static hero and portrait.
- Cold-load failure makes actor invisible: existing static fallback, decode/preload complete poses before attack.
- Multiplayer/reconnect incorrect visual: resolve via player skin identity, never alter gameplay state/hidden information.
- Transparent alpha damaged or opaque background: preserve native alpha and inspect composites; exporter asserts transparent canvas edges.
- Metadata regressions: report display scale/head ratio once from registered canvas, same scale static and animated.
- Missing idle/attack animation manifests: deterministic exporter records hashes, duration, anchors and outputs; reproducible --check mode.

## Focused animation E2E failure contract (before browser-check implementation)

- Cold delayed pose past event lifetime must retain one decoded idle fallback for entire attack, not pop a pose in late.
- Every warm action has exactly one painted complete hero drawing; ready/contact/release/settle windows own the registered keyframe.
- Solo, row-target and multi-hit engine events must preserve authoritative targets and base non-staged latest-attack behavior.
- Cast projectile origin must match measured palm and fixed 550ms launch/560ms flight; evoke ray origin must match registered chest, with no face emission.
- Warm restoration, disconnect, dead hero and reduced motion must remove attack layers and retain a decoded correctly sized cutout.
- Check desktop and horizontal phone, Chromium and WebKit only; videos and JSON results must map each screen/engine/skin case.
- Cold Defect fallback remains in idle pose: its projectile must originate at chest core rather than at the warm release's forward palm (empty air in idle). Pose readiness and projectile geometry must latch together, retaining the same target/contact clock and never re-aiming late.
