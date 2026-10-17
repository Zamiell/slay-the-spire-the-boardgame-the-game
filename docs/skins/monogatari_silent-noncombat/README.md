# Silent-chan noncombat artwork

Skin id `monogatari_silent`. This collection contains the merchant pose, reaching/gripping treasure arms and the original
identity. The campfire sprite is documented in `../campfire-scenes.md`.

The merchant pose is a 384x576 transparent canvas with the figure 548px tall. The 384x1024 treasure arms retain
the black sleeve, ivory wraps, bare hand and jade snake ring. Character poses came from the original character-art run,
with alpha below 8 and detached specks removed.
The pose generation provenance remains in `manifest.json` and `prompts/pose-*.txt`.

Rebuild this collection with Pillow:

```sh
python3 scripts/art/export-monogatari_silent-noncombat.py
```

`verify-assets.mjs` checks inventory, dimensions, transparency and size.
`verify-merchant-overflow-browser.mjs` and `verify-treasure-animation-browser.mjs`
check merchant arrival and treasure pickup on desktop and horizontal phone.
