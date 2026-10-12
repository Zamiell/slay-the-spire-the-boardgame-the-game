# Multi-skin campfire scenes

This collection contains 72 parties wearing two or three of Kratos, Silent-chan and Watcher-chan. Parties mixing
Silent-chan or Watcher-chan with Ironclad-chan or Defect-chan are in `../mixed-skin-noncombat/`.

Every campfire scene is a fresh native 3840x2160 output from `gpt-image-2` (bundled imagegen CLI, edit, quality high).
Every attempt uses the original empty campfire and the original identity assets of every named party member.
Generated party scenes are never model inputs, including on retries. Exact accepted prompts, original input hashes, raw
output hashes and source/runtime hashes are in `../fresh-campfires/manifest.json`.

Sources are native 3840x2160 WebP quality 95, method 6. Runtime exports add one duplicate bottom row to match the
existing 3840x2161 convention, without resizing the drawing, and encode WebP quality 50, method 6. Exports are byte
reproducible from committed sources. `export-fresh-campfires.py --check` checks all 407 fresh scenes and verifies each
reference against its original character or empty-camp asset.

```sh
python3 scripts/art/export-multi-skin-noncombat.py
python3 scripts/art/export-fresh-campfires.py --check
```

The first command rebuilds this collection. See `../campfire-scenes.md` for naming, delivery and inventory.
