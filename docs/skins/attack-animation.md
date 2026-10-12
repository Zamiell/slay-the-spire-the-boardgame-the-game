# Staged skin attacks

A skin can draw its own attack: a short run of complete drawings shown on a clock, a travel
to the target, weighted hits that land on named beats, and sound cues. Hit logic never
changes (cards, Block, powers and relics are the hero's); the skin only decides when each
part of the damage becomes visible. One generic implementation plays every skin; a skin is
a config plus its drawings.

```
scripts/animation/skins/<skin>.json   the config (hand-authored; shifts and reach are measured)
        |  python3 scripts/animation/skin-attack.py
        v
src/ui/styles/staged-attacks.css       clock, travel, pose opacity, row layering (all skins)
src/ui/combat-screen/staged-attacks.ts poses, cues, hits and sound volumes (all skins)
```

`node scripts/verify-all.mjs` (through `verify-assets.mjs`) fails when either generated file
is stale, when a skin has the `stagedAttack` trait without a config, or the reverse.
`verify-skin-attack-browser.mjs` plays every such skin (and two synthetic test skins) on
desktop and a horizontal phone in Chromium and WebKit.

## Config format

```jsonc
{
  "skin": "kratos",              // the skin id; the file is named after it
  "canvas": 1152,                // every drawing is one square canvas of this many px
  "displayScale": 2.3,           // the canvas is drawn this many actor-box edges wide: transparent overscan for the weapon
  "ground": 1136,                // y of the ground line in every drawing (the feet stand here)
  "durationMs": 2400,            // the whole attack; it ends back on the idle drawing
  "travel": { "out": [60, 300], "back": [2000, 2280] },   // dash to the target between these times, then back (optional "path", below)
  "contactReach": 1.1726,        // weapon-tip line, in canvas edges right of the actor centre (measured)
  "contactPoses": ["left-extended", "right-extended", "slam"], // drawings that reach it
  "poseShift": { "left-cast": 152 },   // per-pose horizontal planting shift in canvas px (measured)
  "keys": [[0, "idle"], [60, "anticipation"], ..., [2280, "idle"]], // ascending [ms, pose]; first and last are idle
  "cues":  [{ "at": "left-cast", "sound": "kratos-chain" }],       // optional sound beats
  "hits":  [{ "at": "left-extended", "weight": 0.1, "style": "strike", "angle": -25, "vfx": "light", "sound": "kratos-light" },
            { "at": "slam", "weight": 0.8, "style": "slam", "vfx": "impact", "sound": "kratos-slam" }],
  "sounds": { "kratos-chain": 0.19, "kratos-light": 0.16, "kratos-slam": 0.32 } // sfx/<name>.mp3 and its volume
}
```

- **Poses.** `keys` names the drawings in the order they appear; the same pose may repeat. The key
  `idle` is the rest drawing and is saved as `<skin>-ready.webp`; every other pose is
  `combat/characters/animated/<skin>-<pose>.webp`. A drawing replaces the previous one outright; the
  generator never blends limbs. At most 24 keys, none shorter than 20 ms (browsers stretch shorter frames).
- **Minimum hold.** Every drawing is shown at least `minHoldMs` (default 45): on a device under about 50 fps a shorter drawing is
  skipped and the cut pops (a 20 ms draw-down once made a staff end jump 120-173 px). The first key is the idle drawing already on
  screen, so its length is exempt. A flight drawing (listed in `audit.airborne`) may be shorter, never under 20 ms, only when
  `"shortHolds": {"<pose>": "<reason>"}` names it with a reason. `skin-attack.py` (validate, run by `--check`) and `audit-poses.py`
  (both through `hold_problems` in `skin_geometry.py`) fail a clock with a shorter hold; `verify-assets.mjs` proves both.
- **Travel.** The actor leaves its seat between `out[0]` and `out[1]`, stays at the target until
  `back[0]`, and returns by `back[1]`.
  By default one ease-in-out curve spans each leg. A skin whose drawings do not all have a foot planted adds
  `"path": {"out": [[ms, f], ...], "back": [[ms, f], ...]}`: `f` is the fraction of the way to the target (`out` runs from
  `[out[0], 0]` to `[out[1], 1]`, `back` from `[back[0], 1]` to `[back[1], 0]`, monotonic) and the box moves in straight
  segments between the waypoints, so each key of the clock can set its own speed: fast while a flight drawing is shown,
  near zero while a drawing with a planted foot is. The generator then writes a linear travel animation. The travel parks the line `contactReach` canvas edges right of the
  actor centre on the target's body, so the weapon, not the body, reaches the target.
- **Planting.** Every drawing is centred in its own canvas, so `poseShift` moves its rear sole back onto the
  idle rear sole (the skin never slides while it is out). `contactReach` is the weapon-tip line of the
  `contactPoses` after planting; the poses must agree within 12 canvas px.
  A skin whose drawings are not all planted the same way (a flight drawing has no foot on the idle stance) may add a
  `"measure": {"idleRows", "poseRows", "unplanted": [pose]}` block: the rows of the lowest band searched for the rear sole of the
  idle and of the other drawings (default 22), and the drawings `--measure` leaves out of `poseShift`. `foot_runs` skips runs
  thinner than 9 px, so a weapon butt is never taken for a foot.
  A drawing that is deliberately lifted off the ground (a leap, a hop) is listed in `audit.airborne` as `{pose: lift in canvas px}`:
  the bake (`monogatari_watcher.py`) places its lowest row that far above `ground`, `audit-poses.py` and `verify-assets.mjs` expect
  exactly that, and the browser verifier treats it as a flight drawing (below).
- **Hits.** `at` is a pose (the first moment it is shown) or a time in ms. `weight` is that hit's share of the
  damage (all weights add up to 1); the visible HP drop and the damage number of each hit wait for its beat, and a
  lethal target falls after the last one. `style` is `strike` (a flash rotated by `angle`, 280 ms, on the target's
  body) or `slam` (a ground shock under the target, 550 ms). `vfx` is `combat/vfx/actions/<skin>/<vfx>.webp`
  (512x512, native alpha). A `strike` may carry `"pin": {"dx", "up", "pivot": [x, y]}` to grow from the weapon instead of the
  target's centre: the flash's `pivot` (percent of the image, e.g. its tail end) sits `dx` actor edges right of the target's body
  and `up` actor edges above the ground line under it, and the flash turns and scales about that point. Compute `dx`/`up` from
  the hit drawing's weapon tip (`dx` against the contact drawing's tip, `up` from the canvas bottom), as `monogatari_watcher.py` does. `sound` names an entry of `sounds`. One hit with weight 1 is a valid attack.
- **Sounds.** `sounds` maps each `sfx/<name>.mp3` the attack plays to its volume. Cues and hits play at their beat;
  Cleave-like plays with several targets lower the volume per voice.
- **Reduced motion and cold plays.** Reduced motion shows `combat/characters/<skin>-hero.webp` (the idle
  drawing with the overscan undone) and none of the effects. A play that starts before every drawing is
  decoded keeps the animated idle (`animated/<skin>-idle.webp`) and a box-edge travel for the whole attack.

## Making a skin's attack

1. Draw the poses on one canvas with the feet on `ground`: at least anticipation, a lunge or windup, one or more
   strike drawings and a recovery (four to six drawings is a complete short strike; Kratos uses fifteen). Keep the
   body at no more than about 40% of the canvas height, because `displayScale` (2.3) draws it that much larger.
2. Save them as `public/assets/combat/characters/animated/<skin>-<pose>.webp` (`<skin>-ready.webp` is the rest drawing).
3. Write `scripts/animation/skins/<skin>.json` with the clock, hits and sounds; `contactReach` may start as `0`.
4. `python3 scripts/animation/skin-attack.py --bake-rest <skin>` writes the idle loop, the reduced-motion hero and the
   list icon from the ready drawing (`animated/<skin>-idle.webp`, `<skin>-hero.webp`, `<skin>.webp`).
5. `python3 scripts/animation/skin-attack.py --measure <skin> --write` stores `poseShift` and `contactReach` in the config
   (`--measure` alone prints them). Re-run it after redrawing any pose.
6. `python3 scripts/animation/skin-attack.py` regenerates the CSS and the table; `--check` verifies them.
7. Add `combat/vfx/actions/<skin>/<vfx>.webp` and `sfx/<name>.mp3` for every name the config uses, set the
   `stagedAttack` trait in `src/game/skins.ts`, and run `node scripts/verify-skin-attack-browser.mjs --skin=<skin>`.

Kratos is the first config. Its drawings are baked by `scripts/animation/kratos.py` (head and sole scale
registration, chain trimming), which also writes the measured `poseShift` and `contactReach` into
`skins/kratos.json`; `kratos.py --check` fails when they drift. Other skins measure their baked
drawings with `skin-attack.py --measure`.

## Pose audit

`python3 scripts/animation/audit-poses.py <skin> [--no-sheet]` holds a skin's drawings to its config's `audit` block, which
`verify-assets.mjs` runs for every skin that has one (Kratos predates it). Per drawing it checks, against the idle: head length
(default tolerance 0.10) and every prop's length (default 0.10, or the config's stated `propRatio` where a weapon is foreshortened
in the idle), the rear sole's width and drift (relaxable per skin), the lowest row against the ground (a declared `airborne`
lift for leaps), canvas margins, pale alpha fringes and detached specks. It also checks that the recorded landmarks still lie on
the drawing: a prop's endpoints touch solid pixels and the hood tip sits on the silhouette (`skip.hoodTip` for a pose whose
cloak covers it), so a drawing enlarged after its landmarks were inspected fails. Between consecutive drawings it limits the
head's jump (`headStepPx`; a vertical head landmark `[crownY, chinY]` needs `headX`, the crown column), how far either end of any prop
moves (`propStepPx`, applied to the tip and the butt: the staff is gripped by the hands, so a capped tip also caps the hands' swing),
luminance changes and cross-fades of nearly disjoint silhouettes shown too briefly. `verify-assets.mjs`
also proves the gate by enlarging each skin's first contact drawing by 15% about its planted foot and requiring the audit to fail.
The filmstrip (`--sheet`, default `artifacts/skin-art/<skin>-filmstrip.png`) is for looking at every frame; the numbers
supplement it, never replace it.

## Test skins

`scripts/animation/test-skins/test_combo.json` (a many-pose combo with three hits, cues and a slam) and
`test_strike.json` (a five-pose strike with one hit) are never registered. `skin-attack.py --fixture <dir>` draws them
as solid shapes into a scratch directory with their generated CSS and table; the browser verifier serves those
through a Vite plugin (`scripts/lib/skin-attack-fixture.mjs`, `scripts/lib/test-skins.mjs`), so the generic code
path is covered whether or not a real skin uses a given shape of attack.

## Ground speed

A drawing with a planted foot must not skate. `audit.tolerances.groundSpeedPxPerMs` (optional; the Watcher-chan config sets 0.5) caps the
speed of the actor's box, in screen px per ms, during every drawing that is not listed in `audit.airborne`; flight drawings are free to
travel fast. `verify-skin-attack-browser.mjs` measures it on the real engine: it freezes the play, steps the animation clock
4 ms at a time over the whole attack, reads the box's transform and the visible drawing at each step, and fails with the drawing,
its time and the speed when a grounded drawing exceeds the cap (in every engine and viewport, with the actor out at a real enemy).
Re-time `travel.path` rather than relaxing the cap: put the dash into the flight drawings and keep the landing slide short.
