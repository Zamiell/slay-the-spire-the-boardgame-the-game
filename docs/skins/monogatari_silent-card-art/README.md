# Monogatari Silent skin card art

Every Silent card (the 64 base-set cards and the 7 Slayer Pack `slayer_*` cards, 71 in all) has an illustration of the original Monogatari-style Silent heroine of the `monogatari_silent` skin: a tall slender anime girl with a deep green hood and cloak, black hair with a braid, acid-green slit-pupil eyes, a cream scarf, a bandolier of poison vials, a jade snake ring and two poison daggers. The art is generated with `gpt-image-2.5-sunburst`, quality `high`, 1536x1024, through the bundled imagegen CLI (`edit`, two candidates per card, one call per card). It is composited into the existing Silent card scans so the frame, banner, title, cost orb, type tab and rules text stay the scans' own pixels; only the art window changes. Both faces (base and upgraded) of every card are produced at full size and at the 448 px thumbnail size (142 faces, 284 files).

## References, in a fixed order per call

1. Two or three Monogatari series style frames (`styles` per card in `plan.json`): a second-season key-art poster, a close-up frame, and a classroom group frame. They are style authority only (linework, flat cel colour, huge flat eyes, shard-like hair, graphic geometry, cloudless sky or hard shadow cuts); no character, face, costume or prop may be copied. They are copyrighted frames and are not committed; `manifest.json` records only the description and SHA-256 of each.
2. The approved Silent identity sheet (`identityReference`, a generated idle image, not committed; description and SHA-256 in the manifest), which fixes her face, eye colour, hair, outfit, colours and props across all 71 cards.
3. The Silent card scan and its original text-free art (pack cards: the window cut out of the scan), so each card keeps its meaning.

The prompt template, per-card-type composition rule (attack: dynamic diagonal; skill: calm readable; power: centred emblem that survives the oval window) and palette (deep jade and forest greens, black, bone white, acid-green accents; no red, no bronze) live in `scripts/art/skin-cards/recipes.py` (`monogatari`). `plan.json` (in `scripts/art/skin-cards/skins/monogatari_silent/`) holds one scene sentence and the style frames per card. `prompts/` keeps the exact prompt of every card.

Style frames (copyrighted, description and hash only):
- `poster`: Monogatari series second-season key art, extreme low angle, cloudless cobalt sky, white geometric masts (SHA-256 `0a006524048361ec...`)
- `closeup`: Monogatari series close-up frame, huge flat eyes with crisp highlights, painted sea and cloud backdrop (SHA-256 `eae8b06c365b04b5...`)
- `classroom`: Monogatari series group frame, hard diagonal shadow cuts, cracked grey wall with one hot flat colour panel (SHA-256 `1e7fdbc9e0c88f3925...`)
- identity sheet: generated Silent idle image (SHA-256 `35be6266445ef665...`)

## Selection

Each pair of candidates was viewed as composited cards and one was kept per card (`candidate` in `manifest.json`); rejected candidates are not kept. Picks were judged on identity (hood, eyes, braid, vials, ring, daggers), anatomy and grips, scene versus the card's meaning, the art window (nothing important under the banner or the chevron, centred emblems inside the oval for powers), colour variety (purple was avoided so Silent stays distinct from the Watcher skin), and no text or watermarks. Die Die Die was blocked by the input moderation once; its scene sentence was reworded (small throwing knives fanning out in a courtyard) and generated again.

## Commands

Run from the repository root with a Python that has `openai`, Pillow, numpy (and opencv/scipy for validate):

```
python3 scripts/art/skin-cards/generate.py --skin monogatari_silent run --all --candidates 2
python3 scripts/art/skin-cards/generate.py --skin monogatari_silent select <id>=<n> ...
python3 scripts/art/skin-cards/export.py --skin monogatari_silent
python3 scripts/art/skin-cards/composite.py --all --skin monogatari_silent --root public/assets
python3 scripts/art/skin-cards/validate.py --owner silent
```

Selected sources are lossy WebP (at most 150 KiB each) in `scripts/art/sources/monogatari_silent-skin-cards/`; the 748x420 art (at most 40 KiB each) is in `public/assets/skin-card-art/monogatari_silent/silent/`; the composited faces are in `public/assets/skin-cards/monogatari_silent/` and `public/assets/skin-cards-sm/monogatari_silent/`. `manifest.json` records model, quality, size, reference hashes and per card the scene, candidate, source, prompt and exported art SHA-256.

## Validation

`validate.py --owner silent`: art swap over all 142 faces at both sizes changes nothing outside the art window (max difference 0.00); inside-window and edge-band differences are the art swap itself; the flat-colour ring check over the 126 faces of the large rarity groups has a mean ring deviation of 0.27% and a worst of 5.2% (Footwork, a frame variation, no old art left over).
