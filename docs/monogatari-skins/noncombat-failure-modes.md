# Noncombat asset failure modes (written before exporter implementation)

- Menu portrait or wallpaper loses the approved face, costume or mask identity.
- Wallpaper's character lands beneath left-side menu copy or is cropped at the head.
- Merchant standing cutout clips boots, sword or hair, or opaque matte is mistaken for alpha.
- Treasure hands have extra fingers, disconnected wrists, wrong glove/metal material, or inconsistent open/grip placement.
- Seated character has extra limbs, off-log pelvis, floating feet or intersects flames.
- Party composition depicts a replaced original character alongside its skin, omits a member, or uses empty fallback.
- Party key differs from VISUAL_IDS ordering or same-character skins appear together.
- Background/character scale diverges between party sizes or silhouettes overlap excessively.
- Export changes the existing original scenes or produces nondeterministic hashes.
- Asset dimensions/provenance are absent, alpha gets keyed away, or rebuild needs another generation call.

Mitigation: native alpha cutouts, fixed sheet crop regions and seating anchors, enumerate only valid character-distinct 1–4 parties containing anime skin; preserve all existing scenes. Inspect contact sheets for solo, pair and full-party and retain hashes, references, crop transforms, exact prompts and repeatable exporter. Main thread performs runtime E2E and animation recordings.

## Focused online regression failure contract (before verifier implementation)

- Owned skin entry/lobby portrait does not match the selected hero, or a live default/skin change is not published.
- Server seat or run player changes gameplay character when its skin changes.
- Teammate skin changes the Silent viewer's own hand faces; opponent/teammate private hand/draw/deck leaks through snapshot data.
- Combat page reload loses the public skin or exposes private hand state.
- Campfire uses original or empty fallback instead of its full skin-party scene, fails image decoding, or loses the scene on reconnect.
- Desktop or horizontal-phone rendering has uncaught browser errors, clipped backgrounds or missing evidence.
- E2E does not retain recordings, screenshots, assertions and exact viewport/scenario report for repeatability.
