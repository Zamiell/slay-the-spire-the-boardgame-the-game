# Rimuru Tempest noncombat artwork

Skin id `anime_slime_boss`. The treasure arms, the merchant figure and the campfire sprite, all the same character as the
idle (`../anime_slime_boss-art/README.md`): very long lime-green hair, tiny black bowler, gold eyes, black coat with white
shoulder panels over a slate tunic, brown belt, grey trousers, tall brown boots, glossy lime slime accents. Generated with
`gpt-image-2.5-sunburst` (high quality, native transparent background) from the committed idle art; `manifest.json` records
prompts, references, model-output and source/output SHA-256 for every file, `prompts/` holds the submitted prompts.

- **Treasure hands** (`noncombat/treasure/{hand,grip}-anime_slime_boss.webp`, 384x1024): a bare pale hand with a little glossy
  slime dripping from the fingertips, in the slate tunic sleeve with its folded black cuff and the hem of the black coat
  sleeve with the white panel edge. One sheet holds both poses; the exporter splits it in the empty gap and puts both wrists on
  x=192 and the sleeve on the canvas bottom, so the open and gripping hands swap in place like the other skins.
- **Merchant** (`noncombat/merchant/characters/anime_slime_boss-standing.webp`, 400x576): standing relaxed facing the viewer, the
  slime-gloved hand loose at her side and the small slime blob by her shoulder. 548px tall with the boots 18px above the bottom
  edge: the transparent floor gap is 3.125%, so `merchant-arrival.css` needs
  `figure[data-character='anime_slime_boss'] img { transform: translateY(3.12%); }` (`verify-assets.mjs` accepts 0.06% either way).
- **Campfire** (`noncombat/campfire/sitters/anime_slime_boss.webp`, 1408x1808): seated on an invisible seat, facing right
  and looking at the fire, a small slime blob resting on her knee. Source
  `scripts/art/sources/campfire-sitters/anime_slime_boss.webp`, entry in that folder's `manifest.json` (seat `[420, 850]`,
  crown `14`, `grade: false` like Watcher-chan, with the `note` that spells out her design). It is built by
  `scripts/art/campfire-sitters.py`, see `../campfire-scenes.md`. `export` rewrites every sprite, so after running it keep only
  `anime_slime_boss.webp` unless the other sources changed.

Selected treasure and merchant sources are lossless WebP under `scripts/art/sources/anime_slime_boss-noncombat/`
(alpha of 16 or less zeroed, detached specks under 60px removed; the floating slime blob is kept). Rebuild the treasure
and merchant files with Pillow and NumPy, no API calls:

```sh
python3 scripts/art/export-anime_slime_boss-noncombat.py
```

`verify-assets.mjs` checks inventory, dimensions, transparency and size. `verify-merchant-overflow-browser.mjs` and
`verify-treasure-animation-browser.mjs` check merchant arrival and treasure pickup on desktop and horizontal phone once the
skin is registered.
