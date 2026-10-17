# Noncombat asset failure modes (written before exporter implementation)

- Menu portrait or wallpaper loses the approved face, costume or mask identity.
- Wallpaper's character lands beneath left-side menu copy or is cropped at the head.
- Merchant standing cutout clips boots, sword or hair, or opaque matte is mistaken for alpha.
- Treasure hands have extra fingers, disconnected wrists, wrong glove/metal material, or inconsistent open/grip placement.
- Seated campfire sprite has extra limbs or invented anatomy against the idle art, an off-log pelvis, floating feet, or a
  figure clipped by its canvas; mirrored on the right log it no longer faces the fire.
- Asset dimensions/provenance are absent, alpha gets keyed away, or rebuild needs another generation call.

Mitigation: native alpha cutouts and fixed sheet crop regions; the campfire uses one seated sprite per visual id built by
`scripts/art/campfire-sitters.py` (idle art as identity reference, seat/crown annotation, `export` canvas-edge assert,
`check` against sources) and composed at runtime (`docs/skins/campfire-scenes.md`). Retain hashes, references, exact
prompts and repeatable exporters. Main thread performs runtime E2E and animation recordings.

## Focused online regression failure contract (before verifier implementation)

- Owned skin entry/lobby portrait does not match the selected hero, or a live default/skin change is not published.
- Server seat or run player changes gameplay character when its skin changes.
- Teammate skin changes the Silent viewer's own hand faces; opponent/teammate private hand/draw/deck leaks through snapshot data.
- Combat page reload loses the public skin or exposes private hand state.
- Campfire seats the wrong sitter (the base hero instead of the skin), a sitter fails to decode, or the seated party changes on reconnect.
- Desktop or horizontal-phone rendering has uncaught browser errors, clipped backgrounds or missing evidence.
- E2E does not retain recordings, screenshots, assertions and exact viewport/scenario report for repeatability.
