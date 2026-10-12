# Campfire scenes

A scene is `public/assets/noncombat/campfire/<party>_firecamp.webp`, 3840x2161 WebP. The party joins visual ids in
`VISUAL_IDS` order: all default characters, then skins in registry order. Parties contain one to four distinct visual
ids. The catalogue excludes a base character beside its own skin but retains inherited entries with two different
skins of one base hero. Actual campaign and multiplayer parties require distinct physical characters. The solo `kratos_firecamp.webp` and three-member `silent_defect_kratos_firecamp.webp` illustrate the naming.

The five skins are Kratos, Ironclad-chan, Silent-chan, Defect-chan and Watcher-chan. The catalogue contains 777 party entries plus the empty camp, covering all 724 reachable distinct-character parties
and 53 surplus dual-Ironclad entries. Every reachable combination has its own artwork, including the 143 catalogue additions
mixing Silent-chan/Watcher-chan with Ironclad-chan/Defect-chan.

`docs/skins/fresh-campfires/manifest.json` covers 407 freshly generated scenes, including 264
replacements and 143 additions. Every attempt uses only the original empty camp and original identity assets
for every party member. Prompts and hashes record the accepted attempt; generated party outputs are never model inputs.
Canonical sources retain native 3840x2160 detail. Exports add one duplicate bottom row without resizing the drawing.

```sh
python3 scripts/art/export-fresh-campfires.py
python3 scripts/art/export-fresh-campfires.py --check
node scripts/sync-campfire-scenes.mjs
```

The sync command regenerates `src/game/campfire-scenes.ts`; `--check` rejects a stale catalogue. `verify-assets.mjs`
derives the catalogue inventory independently from the live registry and requires exact coverage. It also verifies native
source/runtime dimensions, byte hashes, accepted prompts and original-reference pixels. Browser checks cover desktop
and horizontal-phone rendering, solo/online skins and remote-asset failure handling.

`campfireParty(visuals, scenes)` selects the exact party when available. For a partial or synthetic catalogue it tries
skin subsets from most to fewest retained skins, preferring earlier registry skins at equal count, then uses the empty
camp. `useCampfireScene` loads the CDN primary, backup origin and finally local empty camp on network failure.

The scene folder keeps the original catalogue's per-scene budget: 128 MiB per 227 scenes. This is a repository budget;
Pages includes only `empty_firecamp.webp`. Other scenes are delivered individually from a SHA-pinned raw origin with
backup delivery, so the 143 additions do not increase the Pages package.
