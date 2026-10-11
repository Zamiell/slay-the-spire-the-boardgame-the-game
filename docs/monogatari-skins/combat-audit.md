# Combat asset audit and repeatable pipeline

Model: `gpt-image-2.5-sunburst`, high quality, native-transparent image-generation skill CLI, unchanged bundled implementation. All approved drawings are complete separate poses, with no optical-flow interpolation or segmented limb rigging.

## Accepted source drawings

- Ironclad identity: repaired idle, retaining the user-approved closed hand grip.
- Overhead anticipation: `ironclad-ready-sword.png`; initial ready blade was visibly short and rejected. Targeted sword-length repair retains body/hand drawing.
- Contact: `ironclad-impact-crossed.png`; initial square-canvas contact shrank the blade and moved stance, and was rejected. A larger transparent source canvas allows the full blade above the sole plane. An additional crossed-forearm repair ensures the near-viewer anatomical right arm stays connected to the fist nearest the crossguard through the entire swing; hands never swap positions on the hilt.
- Defect idle: `defect-idle-matched.png`; generated from charge by removing only the held orb, retaining permanent chest core and matching lower body.
- Defect charge: `defect-charge.png`.
- Defect release: `defect-release-matched.png`; generated from charge by changing only upper casting arm/hands and removing the held orb, retaining matching feet/legs.

Inputs include approved character identity drawings and original corresponding combat poses. Initial generation used user anime references. One initial Defect call was rejected by input moderation; the actual accepted reference set used only the two fully clothed sample images and character assets. Subsequent identity-preserving corrections use accepted character drawings, not the omitted sample. No inference about the filter's internal cause is asserted.

## Registration and clocks

`registration.json` records native anatomical head bounds, rear-sole landmarks, Ironclad blade endpoints, canvas/ground and action keys. All poses retain a common uniform source pixel scale: never normalize by alpha bounds, rescale head alone, change weapon dimensions in code, or warp a limb. Adult heads and blade lengths agree within 12%; accepted sword lengths differ under 8%. Rear soles are placed on one anchor/ground. Defect matching lower bodies retain the same stance.

Ironclad uses original 1800ms travel/contact clock: ready 0–630ms, contact 630–1260ms, settle 1260–1800ms. Defect uses original 1650ms clock: charge 0–550ms, release 550–1100ms, settle 1100–1650ms. Original cyan projectile launches at 550ms, arrives at 1110ms and retains 70ms per-target stagger. The new human Defect emits from her forward palm; evokes originate at her chest core, never her face/eyes. Frost still centers on her body. Gameplay rules, RNG, hidden information and multi-hit staging are unchanged.

Idle is 8 complete-drawing frames with +/-0.2 degree rigid balance sway around rear sole over 3200ms. It never rescales or morphs a body. Attacks use CSS-stepped full drawings, including on Safari; no new HEVC requirement. Runtime WebP RGB is quality 92 with lossless native alpha; frame/pose canvas is 800 square; high-resolution native sources are retained. Static hero is 1024 square and has the same physical normalized figure size; lobby cutout is 512 square.

## Reproduce and verify

```
python3 scripts/animation/monogatari.py
python3 scripts/animation/monogatari.py --check
```

The check reconstructs runtime bytes in memory, asserts canvas bounds/native alpha, anatomical head/blade tolerance and source/output SHA256 manifest parity. The final manifest is `combat-manifest.json`.

Visual inspection performed on all accepted source images, six registered runtime drawings on neutral gray with a ground guide, and enlarged closed-grip/palm details. Inspectable local artifacts are `artifacts/monogatari-combat/registered-keyframes.jpg` and `*-hands.jpg`. The paired `animated/*-attack.webp` exports provide deterministic full-pose previews. These exports are NOT a claim of full live browser animation QA; actual gameplay recordings, desktop/horizontal phone, cold loading, interruption, reduced motion and multiplayer/reconnect are covered by the coordinator's focused E2E/browser audit.

## Focused animation E2E

`node --experimental-strip-types scripts/verify-monogatari-animation-browser.mjs` runs Chromium and WebKit on desktop and horizontal phone. It records per-engine/screen/skin WebM and a JSON report in `artifacts/monogatari-combat/browser/`. It asserts exactly one decoded actor every sampled frame; every registered pose owns its clock window; delayed pose decode beyond the entire cold attack stays latched to idle; cold Defect projectiles originate at chest while warm ones originate at the forward palm. Real offensive Card events are selected explicitly because Ball Lightning appends a separate channel Orb event. Real Dual Cast verifies two lightning and two dark evoke rays at the chest. Non-staged queued attacks show one latest actor. Restoration, disconnect, death and reduced motion retain safe decoded statures and clear stale attack layers. The cold projectile and pose share one decoded-art latch so late artwork cannot re-aim its flight.

### Final local recording audit (2026-10-11)

The unfiltered focused animation command passed all 8 combinations: Chromium/WebKit × desktop/horizontal-phone × both skins. `report-all.json` records no page/asset errors, one decoded body for every cold/warm action and queued action, all three warm phase drawings, original target lists, projectile clocks, and lifecycle/reduced-motion checks. Lightning and dark Dual Cast each retained both authoritative evoke events and both chest-aligned rays (measured origin error under 0.01 CSS px in these fixtures).

All eight fresh recordings were visually sampled at 2fps and inspected as `*-recording-audit.jpg`: fixed apparent head/body/weapon scale, coherent stance/foot registration, readable anticipation/contact/recovery, no duplicate limbs, no sword/floor penetration, and palm/chest casting without an eye-origin glitch. Enlarged source hand crops and registered pose sheets supplement the small in-game figure. Sampling does not replace the per-frame browser assertions; recordings are local production-screen engine fixtures, not a claim of deployed or live multiplayer validation.

Contact sheets can be reproduced from any recorded case:

```
ffmpeg -hide_banner -loglevel error -y -i CASE.webm \
  -vf 'fps=2,crop=iw*0.85:ih*0.65:iw*0.1:ih*0.2,scale=600:-1,tile=4x8' \
  -frames:v 1 CASE-recording-audit.jpg
```

Artifacts are local under `artifacts/monogatari-combat/browser/`; videos, reports and screenshot names identify their exact engine, screen and skin. Native source/prompt/output provenance stays in the tracked combat manifest and registration files.
