# Fresh campfire sources

The 407 scenes in `manifest.json` replace all Silent-chan and Watcher-chan campfires, plus 64 Guardian parties with Ironclad-chan or Defect-chan: 64 single-skin parties for each, 72 parties
wearing multiple skins from the Kratos/Silent/Watcher set, and 143 combinations with Ironclad-chan or Defect-chan.

Each attempt uses the original empty campfire and one original character identity asset per party member.
`inputs` lists the exact ordered model inputs; `prompt` is the exact accepted prompt. `modelOutputSha256` identifies
the raw native 4K model output before WebP encoding. No previous party image is used as an input. Retries regenerate
from originals with an amended prompt, preserving rejected outputs in the durable audit archive.

The canonical sources are WebP quality 95, method 6 at 3840x2160. Runtime encoding adds a duplicate bottom row without
resampling and saves quality 50, method 6 at 3840x2161. Rebuilding starts from canonical sources, never runtime exports.

```sh
python3 scripts/art/export-fresh-campfires.py
python3 scripts/art/export-fresh-campfires.py --check
```

The check covers every source, runtime export, exact prompt and original input hash and verifies the reference pixels
against the original empty camp/character assets through `campfire_references.py`. The catalogue inventory is derived
independently from the live skin registry by `verify-assets.mjs`. Visual review covers complete rosters, anatomy, props,
seat support, relative scale, and background/linework sharpness; hashes alone do not prove those properties.
