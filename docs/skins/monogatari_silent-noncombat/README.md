# Silent-chan noncombat artwork

Skin id `monogatari_silent`. This collection contains the merchant pose, reaching/gripping treasure arms, original identity, archived character poses, and 64 campfire parties containing this skin and zero to three default characters. Several-skin
parties are covered by `../multi-skin-noncombat/` and `../mixed-skin-noncombat/`.

The merchant pose is a 384x576 transparent canvas with the figure 548px tall. The 384x1024 treasure arms retain
the black sleeve, ivory wraps, bare hand and jade snake ring. Character poses came from the original character-art run,
with alpha below 8 and detached specks removed.
The pose generation provenance remains in `manifest.json` and `prompts/pose-*.txt`.

Every campfire scene is a fresh native 3840x2160 output from `gpt-image-2` (bundled imagegen CLI, edit, quality high).
Every attempt uses the original empty campfire and the original identity assets of every named party member.
Generated party scenes are never model inputs, including on retries. Exact accepted prompts, original input hashes, raw
output hashes and source/runtime hashes are in `../fresh-campfires/manifest.json`.

Sources are native 3840x2160 WebP quality 95, method 6. Runtime exports add one duplicate bottom row to match the
existing 3840x2161 convention, without resizing the drawing, and encode WebP quality 50, method 6. Exports are byte
reproducible from committed sources. `export-fresh-campfires.py --check` checks all 407 fresh scenes and verifies each
reference against its original character or empty-camp asset.

Rebuild this collection or check all fresh scenes with Pillow:

```sh
python3 scripts/art/export-monogatari_silent-noncombat.py
python3 scripts/art/export-fresh-campfires.py --check
```

`verify-assets.mjs` checks inventory, dimensions, transparency, size and original-input provenance.
`verify-art-scenes-browser.mjs`, `verify-merchant-overflow-browser.mjs` and `verify-treasure-animation-browser.mjs`
check campfire rendering, merchant arrival and treasure pickup on desktop and horizontal phone.
