# Campfire scene

The rest site is composed at runtime from one background and one seated sprite per hero (`src/ui/CampfireScene.tsx`).
It replaced the earlier catalogue of one painted scene per party (777 scenes), which is only in git history.

## Background

`public/assets/noncombat/campfire/camp.webp` is the empty camp painting, 3840x2161, with the fire at x 2000 between
two logs. The scene covers the screen like `background-size: cover`, and every sprite is positioned in percent of the
painting, so heroes stay on the logs at every aspect ratio.

## Sprites

`public/assets/noncombat/campfire/sitters/<visual>.webp` exists for every visual id (character or skin). Each is a
transparent 1408x1808 canvas with the hero facing right, hips where they meet the log at (704, 848), and a
human-sized hero 620 px from seat to crown. The canvas is wide and tall enough for every hero mirrored about the seat;
`export` fails if a figure would touch its edge. The sprite is drawn 22.47% of the camp's width wide
(`campfire.css`). The export removes the model's faint alpha noise, grades figures drawn from daylight idle art
(`prompt: "identity"`) into the camp's firelit night (sprites cut out of the old campfire paintings already carry its
firelight), and bakes a soft contact shadow under the feet.

`scripts/art/campfire-sitters.py export` builds every sprite from its accepted source,
`scripts/art/sources/campfire-sitters/<visual>.webp`, and its entry in `manifest.json` there:

- `seat`: `[x, y]` in source pixels where the hips meet the seat.
- `crown`: the y of the top of the head.
- `size` (optional, default 1): height relative to a human; Slime Boss is 1.15, Guardian 0.85 (its long skeletal legs
  still reach the ground), Hexaghost 0.95.
- `shadow` (optional, default true): `false` drops the contact shadow (Hexaghost floats).
- `grade` (optional): overrides the default, which grades `identity` sources and leaves `cutout` sources as painted.
  Watcher-chan sets `false` so she matches the near-daylight look of the other anime skins; Hexaghost sets `false` so a
  regenerated glow keeps its colour.
- `prompt`, `pose`, `sourceSha256`: provenance. `prompt` names the file in `prompts/` that produced the source:
  `cutout.txt` (the first pass, cut out of the old solo painting alone) or `identity.txt` (the idle art as identity,
  used after the model invented limbs for Slime Boss and Guardian, and for Defect and Watcher-chan's redraws). `pose`
  is the pose reference under the sources folder; `sourceSha256` hashes the accepted source; `note` is the text
  appended to the prompt for a hero whose design the model gets wrong (`generate` reads it from here).

`python3 scripts/art/campfire-sitters.py check` (run by `verify-art-bakes.mjs`) fails when a source no longer matches
its hash or a committed sprite no longer matches a fresh export.

## Seats

Hip positions are in camp pixels. Outer seats are nearer the viewer, slightly larger (scale 1.03, inner 0.97), and
drawn above inner ones (the z-index follows the seat's y). Party members fill the seats in party order:

| Party | Seats |
|---|---|
| 1 | left log centre (1230, 1386) |
| 2 | left log centre, right log centre (2790, 1410) |
| 3 | left outer (1010, 1445), left inner (1450, 1327), right log centre |
| 4 | left outer, left inner, right inner (2560, 1340), right outer (3010, 1474) |

Heroes on the right log are mirrored so they face the fire.

## Adding a skin or character

1. `python3 scripts/art/campfire-sitters.py generate <visual>` asks `gpt-image-2.5-sunburst` (needs `OPENAI_API_KEY`)
   for the hero seated by the fire on a transparent background. The hero's combat idle art
   (`public/assets/combat/characters/<visual>.webp`) is the identity to copy; a second image only shows the pose,
   framing and firelight. Launch heroes use crops of their old solo campfire paintings
   (`scripts/art/sources/campfire-sitters/references/<visual>.webp`); a new hero falls back to the accepted Ironclad
   source, or `--pose <path>` picks another. Candidates land in `$TMPDIR/campfire-sitters/`. The model still invents
   anatomy for unusual heroes (it gave Slime Boss arms and Guardian extra limbs); compare every candidate with the idle
   art and spell the design out in the hero's manifest `note` when it does.
2. Save the accepted candidate as lossless `scripts/art/sources/campfire-sitters/<visual>.webp`, save the pose image
   as `references/<visual>.webp` if it is new, and add its `seat`, `crown`, `prompt: "identity"`, `pose`,
   `sourceSha256` (and `size`, `shadow` or `grade` if needed) to `manifest.json`. If a candidate invents anatomy, add
   a `note` spelling the design out to the hero's entry and generate again; keep the note that produced the accepted
   source.
3. `python3 scripts/art/campfire-sitters.py export` rewrites every sprite; compose a few parties and check the seat.

`verify-assets.mjs` requires a 1408x1808 sprite, an accepted source and a manifest entry for every visual id, so
registering a skin fails until its sprite exists.
