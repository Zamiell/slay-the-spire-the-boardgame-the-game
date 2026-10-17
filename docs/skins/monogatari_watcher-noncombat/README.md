# Watcher-chan noncombat artwork

Skin id `monogatari_watcher`. This collection contains the merchant pose, reaching/gripping treasure arms and the original
identity. The campfire sprite is documented in `../campfire-scenes.md`.

The merchant pose is a 389x576 transparent standing figure with a violet kimono and complete staff. The 384x1024
treasure arms use the same anchors as the original Watcher. Character poses came from the original character-art run;
alpha below24, detached specks and edge haze were cleaned deterministically before storing the sources.
The pose generation provenance remains in `manifest.json` and `../monogatari_watcher-art/prompts/pose-*.txt`.

Rebuild this collection with Pillow:

```sh
python3 scripts/art/export-monogatari_watcher-noncombat.py
```

`verify-assets.mjs` checks inventory, dimensions, transparency and size.
`verify-merchant-overflow-browser.mjs` and `verify-treasure-animation-browser.mjs`
check merchant arrival and treasure pickup on desktop and horizontal phone.
