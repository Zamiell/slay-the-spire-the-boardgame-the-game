# Kratos skin merchant and treasure artwork

Generated with `gpt-image-2.5-sunburst` through the imagegen skill's bundled CLI
(`edit`, high quality). Kratos is the Ironclad skin, so every file is named by the skin id and
used wherever an Ironclad wearing the skin would use the Ironclad file. Existing merchant poses provide the
style/composition references; the committed Kratos combat cutout and selection
portrait provide his identity. Exact prompts are in `prompts/` and input/output
provenance is in `manifest.json`. The campfire sprite is documented in `../campfire-scenes.md`.

- `public/assets/noncombat/merchant/characters/kratos-standing.webp`: transparent
  standing pose, automatically used by the existing merchant arrival screen.
- `public/assets/noncombat/treasure/{hand,grip}-kratos.webp`: matched transparent
  reaching/gripping poses for the existing relic pickup animation.
- `scripts/art/sources/kratos-noncombat/`: lossless model artwork and the cropped
  canonical Kratos reference. Other characters' assets are unchanged.

Rebuild runtime files with Pillow:

```sh
python3 scripts/art/export-kratos-noncombat.py
```

The merchant export preserves native alpha and caps its longest edge at 576px.
Treasure hands are cropped from a single two-column model sheet and exported
to the existing 384×1024 canvas, preserving native alpha and both pose anchors.

Focused validation: `verify-assets.mjs` owns inventory, decoding, dimensions,
transparency and size; `verify-merchant-overflow-browser.mjs` checks the Kratos arrival image
before entering the shop on desktop and horizontal phone.
`verify-treasure-animation-browser.mjs` checks both Kratos hand poses during
actual pickup, with desktop/horizontal-phone screenshots in Chromium/WebKit
and existing ownership, remote-claim, final-transition and reconnect safeguards.
