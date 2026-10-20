# Slimeboss-chan skin card art

Every Slime Boss card that is not a Slime creature card (54 cards: 18 attacks, 26 skills, 10 powers) has an illustration of Slimeboss-chan in the `anime_slime_boss` skin: the human form of the Slime Boss, a young heroine with very long lime-green hair, a tiny black bowler mini-hat, gold-yellow eyes, a black high-collared coat with white shoulder panels over a slate tunic with a gold zip line, a brown belt, grey trousers and tall brown boots, with a glossy lime-green slime glove and lime-green slimes. The art is generated with `gpt-image-2.5-sunburst`, quality `high`, 1536x1024, through the bundled imagegen CLI (`edit`, two candidates per card). It is composited into the existing Slime Boss card scans so the frame, banner, title, cost orb, type tab and rules text stay the scans' own pixels; only the art window changes. Both faces of every card (base and upgraded) are produced at full size and at 448 px (108 faces, 216 files).

## Not skinned

The 13 Slime creature cards keep their default face in this skin: Armored, Bruiser, Evolution, Leeching, Massive, Muscle, Psychic, Royal, Scrappy, Spike, Spreading, Sticky and Taunting Slime. They are the slimes the heroine commands, and in combat the slimes keep their default art, so the cards that show them do too. The catalogue (`scripts/art/skin-cards/cards/slime_boss.json`) lists only attack, skill and power cards, `sync-skin-card-faces.mjs` lists whatever exists under `skin-cards/anime_slime_boss`, and `scripts/verify-assets.mjs` (`UNSKINNED_CARD_TYPES`) expects every non-slime card to be skinned and every slime card to resolve to its default scan, art and thumbnail.

## References, in a fixed order per call

1. The user's character design sheet (`reference.png`): the style authority (clean thin dark linework, flat cel colour with one soft shadow step, large almond eyes, long straight hair in flat-shaded clumps) and the identity.
2. The approved idle identity drawing (generated, flattened on a dark background): face, hair, hat, outfit, glossy slime glove and the small floating slime blob.
3. The Slime Boss card scan and its original text-free art (the window cut out of the scan), so each card keeps its meaning.

The references are never committed; `manifest.json` records description and SHA-256 only. Slimes are always glossy translucent lime-green blobs (the same lime as her hair) without faces, hats or other colours; enemies are grey stone knight statues. The prompt template (`anime_slime_boss` in `scripts/art/skin-cards/recipes.py`), the palette and the composition rule per card type (attack: dynamic diagonal; skill: calm and readable; power: centred emblem inside the oval) live there; `scripts/art/skin-cards/skins/anime_slime_boss/plan.json` holds one scene sentence per card; `prompts/` keeps the exact prompt of every card.

## Selection

Each pair of candidates was viewed as composited cards (base face, 448 px) and one was kept per card (`candidate` in `manifest.json`); rejected candidates are not kept. Picks were judged on identity (hat, hair, eyes, outfit, glove), anatomy, scene versus the card's meaning, the art window (nothing important under the banner or the chevron, centred emblems inside the oval for powers), lime-green slime colour and no text. Rally the Troops and Vicious Tackle use the third candidate, the prototype run that was made first with the same prompt.

## Masks and registration

Slime Boss is an owner of the shared pipeline: `build_masks.py --owner slime_boss` derived the registrations (keys `slime_boss__*`, stored in their own `scripts/art/skin-cards/slime-boss-registration.json`, like `defect-registration.json`, so the shared `registration.json` stays byte-identical to the one the Ironclad provenance manifest hashes; `registration_file` in `skincards.py` picks the file by key prefix) and the six `masks/slime_boss/` window masks from the 108 scans (starter, normal and rare frames; the starter grey banner scans register at NCC 0.74 to 0.77, checked visually). `dump-cards.mjs slime_boss` writes the catalogue. `manifest.json` records the catalogue, the registration file and the six masks by SHA-256 (`recordPipelineInputs` in `plan.json`), which `verify-art-bakes.mjs` checks.

## Commands

Run from the repository root with a Python that has `openai`, Pillow, numpy (and opencv/scipy for masks and validate); `STS_SKIN_WORK` is the folder holding `cards/refs/` (see `plan.json`), `STS_SKIN_ART_WORK` the scratch folder:

```
python3 scripts/art/skin-cards/generate.py --skin anime_slime_boss run --all --candidates 2
python3 scripts/art/skin-cards/generate.py --skin anime_slime_boss select <id>=<n> ...
python3 scripts/art/skin-cards/export.py --skin anime_slime_boss
python3 scripts/art/skin-cards/composite.py --all --skin anime_slime_boss --root public/assets
python3 scripts/art/skin-cards/validate.py --owner slime_boss
node scripts/sync-skin-card-faces.mjs
```

Selected sources are lossy WebP (at most 150 KiB each) in `scripts/art/sources/anime_slime_boss-skin-cards/`; the 748x420 art (at most 40 KiB each) is in `public/assets/skin-card-art/anime_slime_boss/slime_boss/`; the composited faces are in `public/assets/skin-cards/anime_slime_boss/` and `public/assets/skin-cards-sm/anime_slime_boss/`.

## Validation

`validate.py --owner slime_boss`: art swap over all 108 scans at both sizes changes nothing outside the art window (max difference 0.00); the flat-colour ring check has a mean ring deviation of 1.43% and a worst of 12.1% (Level Up, rare power frame variation, no old art left over). `composite.py` re-run into a scratch root after the registration split reproduces all 216 shipped faces byte for byte. The delivered faces differ from the scans outside the window only by WebP re-encoding (worst mean absolute difference 1.2 of 255).
