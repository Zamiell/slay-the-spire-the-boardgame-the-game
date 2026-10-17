# Monogatari noncombat/menu art pipeline

Production generation used the unmodified bundled `image_gen.py edit` CLI with
`--model gpt-image-2.5-sunburst --quality high --no-augment`. The user's explicit
model choice authorizes this CLI path. Every cutout requested native
`--background transparent`; wallpaper requested `--background opaque`.
The sources retain generated native alpha without chroma-key extraction.

## Exact generation inputs

Prompts are in `prompts/noncombat/`. Style inputs are the three user attachments
in their supplied order (`IMG_0894.jpeg`, `IMG_0893.jpeg`, `IMG_0892.webp`), hashed
in `noncombat-style-references.json`; they are not redistributed. Identity means
repaired Ironclad (`scripts/art/sources/monogatari/ironclad-idle-grip-repaired.png`)
or initial Defect sheet (`defect-design-draft.png`); the later Defect merchant
output instead uses the finalized single pose
`scripts/animation/sources/monogatari/defect-idle.png`.

| Source/prompt stem | Size | Ordered `--image` inputs |
|---|---|---|
| `{char}-cutouts` | 1024x1024 | Identity, all 3 style samples, original solo campfire |
| `{char}-treasure` | 1024x1536 | Identity, all 3 style samples, original treasure `hand-{char}.webp` |
| `{char}-wallpaper` | 1536x1024 | Identity, all 3 style samples, original character wallpaper |
| `{char}-merchant` | 1024x1536 | Identity, all 3 style samples, original merchant standing |

The original solo campfire scenes used as `{char}-cutouts` inputs were removed with the per-party campfire catalogue;
they remain in git history.

Repeat a generation using:

```sh
python3 "$HOME/.codex/skills/.system/imagegen/scripts/image_gen.py" edit \
  --model gpt-image-2.5-sunburst --quality high --background transparent \
  --size <size-from-table> --image <each-ordered-input> \
  --prompt-file docs/monogatari-skins/prompts/noncombat/<stem>.txt \
  --out scripts/art/sources/monogatari/noncombat/<stem>.png --no-augment
```

Generation is not deterministic, so the lossless selected sources are committed.
The production **export** is deterministic and never needs another API call:

```sh
python3 scripts/art/export-monogatari-noncombat.py
```

The exporter produces ten menu/merchant/treasure files. All source/output/reference/prompt hashes are in
`noncombat-manifest.json`.

## Visual audit and repairs

- Initial four-quadrant sheets have clean faces but standing boots crossed the
  panel boundary. They are used **only for cropped portraits**. Production
  merchant art was regenerated into dedicated images.
- Native alpha was inspected numerically and each selected source was viewed.
- Main thread owns actual desktop/horizontal-phone E2E screenshots and animation
  recordings; these source previews alone do not claim runtime validation.

### Treasure connected-component correction

Animation audit found a neighboring forearm triangle in the Ironclad grip sheet
and a neighboring thumb speck in Defect's grip. Focused isolated Sunburst
regeneration produced clean variants but changed wrist placement; those variants
were rejected to avoid treasure-animation scale/pivot drift. The exporter now
extracts each original grip from source x=32..512 and pads exactly32 transparent
pixels at its left to retain the original512x1536 registration. The legitimate
hands begin at least80 pixels from that edge; **no hand/arm pixel is removed**.
This crops only adjacent-sheet bleed while preserving native alpha and all
prominent content. All four treasure exports assert exactly one connected
component larger than16pixels at alpha>=32; anti-alias noise below that limit is
not considered a physical fragment. The final repeatable hashes include this fix.
