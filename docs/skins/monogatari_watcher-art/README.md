# Monogatari Watcher skin: character art

Skin id `monogatari_watcher` (Watcher's "Monogatari" skin). An original anime heroine in the Monogatari series
(SHAFT) style, generated with `gpt-image-2.5-sunburst` at high quality through the bundled imagegen CLI.
The copyrighted style references are never committed; `manifest.json` records each by description and SHA-256.

- Identity: the approved idle (`scripts/art/sources/monogatari_watcher-char/idle-identity.webp`). Its flat
  background is removed without another API call (`scripts/art/cutout-monogatari_watcher-idle.py`), giving
  `idle-cutout.webp`.
- `export-monogatari_watcher-char.py` (no API calls, Pillow and numpy; the cutout script also needs scipy) writes the 1152 hero cutout and 512 icon,
  the 256 Energy orb, the 512 `light`/`impact` VFX, the 256x384 portrait and 1536x864 wallpaper, the idle
  `registration.json`, and refreshes the hashes in `manifest.json`.
- Idle framing: crown to front sole is 830px on the 1152 canvas (about 0.72 stage-actor widths), the front sole on
  y=1115 (the Kratos hero line), the stance centre on x=576. The highest painted row (hairpin and staff tip) is y=265, so the long staff never touches the canvas edge.
- Hero-head calibration (`src/ui/hero-art-head.json`, `[animated, static]`): `[0.3351, 0.77]`. The animated slot is the
  1152 canvas `animated/monogatari_watcher-idle.webp` (0.3351), the static slot the cropped
  `characters/monogatari_watcher-hero.webp` (0.77); `python3 scripts/calibrate-hero-head.py` measures both.
- `prompts/` holds every submitted prompt. Pose references (seated, reaching, merchant) for later noncombat art are
  recorded in the manifest and kept outside the repo.

## Attack animation

A short staged staff combo (config `scripts/animation/skins/monogatari_watcher.json`, format in
`docs/skins/attack-animation.md`, 1.54 s). She faces the enemy on the right, the staff in her right (near) hand; the
face stays serene and the blindfold closed. Two rules from the animation audit shape the clock: no staff end moves
more than 173 canvas px (about 4 head lengths) and no head more than 84 px between consecutive drawings, and the box
only travels fast while an airborne drawing is shown (a planted foot never moves faster than 0.44 px/ms). Every drawing
is held at least `minHoldMs` (45 ms): the four-step draw-down was 20 ms a drawing, which a device under 50 fps skips (the
staff base and tip then jump 120-173 px), so it now takes 180 ms and every later key moved 100 ms; the first idle key is the
drawing already on screen and is exempt, and `shortHolds` is empty (no flight drawing is shorter than 50 ms):

| ms | drawing | what it shows |
|---|---|---|
| 0 | idle | the exact idle drawing |
| 20 | `ready0` | the staff tilts out of the vertical, butt still at the ground, feet together |
| 65 | `ready1` | staff at about -59 degrees, right hand slid to the hip |
| 110 | `ready2` | beginning to sink, staff at about -28 degrees |
| 155 | `ready3` | shallow crouch, staff nearly horizontal, narrow stance |
| 200 | `anticipation` | the low guard: sinks and leans in, staff lowered (the box starts to move at 220 ms) |
| 250 | `leap` | push-off: both feet leave the ground (rear toes last), staff carried low (airborne, lift 24) |
| 300 | `glide` | the flying dash, body stretched forward, no foot near the ground (lift 70) |
| 355 | `descend` | coming down, front toes reaching (lift 40) |
| 405 | `brake` | landing in front of the enemy, front foot planted far forward, a short slide (at most 0.4 px/ms) |
| 465 | `windup` | coil, staff drawn back to the strike line |
| 540 | `thrust` | lunge, staff at full reach: the contact drawing, 60% of the damage |
| 810 | `swing` | the staff driven down out of the thrust, halfway to the sweep |
| 860 | `sweep` | the staff through the downward arc: 40% |
| 960 | `sweepmid` | straightening out of the sweep, staff halfway up |
| 1010 | `rise` | standing out of the lunge, front foot sliding back, staff level |
| 1080 | `hop1` | takeoff of a hop backwards (the box travels 1080-1290 ms), ribbons lagging to the right (lift 44) |
| 1150 | `hop2` | descending half of the hop, staff in a 42 degree guard (lift 30) |
| 1220 | `land` | touchdown on both soles, knees soft |
| 1290 | `recovery` | both soles down, diagonal two-hand guard |
| 1360 | `guard2` | the staff swinging back toward the vertical |
| 1410 | `settle` | staff vertical, left hand lowered, one step from idle |
| 1470 | idle | the exact idle drawing |

The hit beats moved with the longer draw-down, 100 ms later each: 540 ms (thrust, 60%) and 860 ms (sweep, 40%). Every sound
cue moved by the same 100 ms, keeping its place in the drawing it belongs to: the first whoosh is cued on `anticipation`
(200 ms, was 100 ms), the other two whooshes 400 to 500 ms and 725 to 825 ms, the
thrust 440 to 540 ms and the chime 760 to 860 ms. Each sound file is a self-contained cue, so no `sfx/` file changed. The sweep's `light` flash is pinned: it grows from
the sweep drawing's staff tip (config `hits[1].pin`, whose `dx`/`up` the bake recomputes from the baked staff landmarks)
instead of the target's centre. The travel is the config's `travel.path` (straight segments, fast only during `leap`,
`glide`, `descend`, `hop1` and `hop2`): the out dash is 250-405 ms, the back hop 1080-1220 ms, and both landings
slide at most a few tens of px.

- Drawings: `public/assets/combat/characters/animated/monogatari_watcher-<pose>.webp` (1152 canvas, the idle at the
  animation rest scale: head 46 px, staff 362 px, feet on y=1136), the rest drawing `-ready.webp` (the hero with its 2.3x
  overscan undone) and the 8-frame `-idle.webp` loop. `-hero.webp` and the list icon are the character export's and
  are not rewritten.
- Sources: `scripts/animation/sources/monogatari_watcher/attack/<pose>.webp` (lossless 1536x1024 model outputs,
  native alpha), `<pose>-prompt.txt`, `inputs/` (the layout canvases with the registered idle and the stick-figure
  guides with an exact-length gold staff that were passed as images 1 and 3; `make-pose-inputs.py` redraws equivalents)
  and `docs/skins/monogatari_watcher-art/attack-manifest.json` (hashes, candidate counts, rejected rounds).
- Drawing method (Kratos lessons applied): each pose is an `edit` from the registered idle on a layout canvas, the
  approved identity, a pose guide, and the previous approved drawing. The model ignores absolute size, draws heads
  1.3-1.8x large and a diagonal staff 0.6-0.9x short without the guide, so every drawing is measured: the blindfold
  cloth height (the head landmark, constant in every pose) and the leaf-tip-to-butt staff length, found by
  `scripts/animation/measure-monogatari_watcher.py` (numpy, scipy, Pillow) into `registration.json`. The bake
  `scripts/animation/monogatari_watcher.py` (Pillow) scales each drawing by the geometric mean of its head and
  staff scales (they must agree within 20%; the kept drawings agree within 10%), plants its rear sole on the idle's
  planted sole and its lowest row on the ground line, and writes the per-pose landmarks into the config's
  `audit.landmarks`. The five flight drawings (`leap`, `glide`, `descend`, `hop1`, `hop2`) have no foot on the idle stance, so they are
  planted by the crown column the neighbouring drawings hold (`CROWN_PLANTED` in the bake) and lifted off the ground
  by the config's `audit.airborne` values. The bake also writes each drawing's head column (`headX`) so the audit can
  measure head and staff steps between consecutive drawings. `--check` fails when they drift.
- Audit (`audit-poses.py monogatari_watcher`): every drawing is within 5% of the idle head, within 6% of the idle
  staff, no staff end moves more than 173 px and no head more than 84 px between consecutive drawings, 15 px from the canvas edge, no detached specks; the pale-edge detector counts the idle's bare skin and blindfold edges, so its `fringeShare` limit is 0.12 (the idle measures 0.0951; the attack drawings are at most 0.001). The source cutout and rendered sprite were checked on dark backgrounds for a white matte. The sole-width ratio is limited in the config (`soleRatio` 0.41; the two-hand recovery is excluded because a toe-down or heel-up foot is not a scale cue, head and staff are) while the planted rear sole is checked within 6 px of the idle's (found with the config's `measure` rows, flight drawings excepted). Review the filmstrip and a frame-by-frame view,
  not only the numbers.
- Measuring: `skin-attack.py --measure monogatari_watcher --write` works with the config's `measure` block
  (`idleRows` 8 and `poseRows` 24 find the same rear sole the bake plants; `unplanted` lists the flight drawings that
  are skipped). It writes an empty `poseShift` and `contactReach` (1.0342, the thrust leaf tip). `foot_runs` ignores
  runs thinner than 9 px, so the idle's staff butt is no longer mistaken for a foot.
- Sound cues (`sfx/<name>.mp3`, written by `scripts/audio/generate-combat-sfx.py monogatari_`): `monogatari_watcher-whoosh`
  (0.14, a short airy staff swish with a faint gold-ring chime, ~250 ms, cued at 200, 500 and 825 ms),
  `monogatari_watcher-thrust` (0.30, a crisp wooden staff impact with a bright bell-metal ring-out, ~500 ms, at 540 ms
  with the thrust hit) and `monogatari_watcher-chime` (0.20, a lighter wood tap with a high glassy chime, ~350 ms, at
  860 ms with the sweep hit). VFX: `monogatari_watcher/impact` on the thrust (angle -8) and `light` on the sweep (angle -15, pinned to the staff tip: its thin tail end is the pivot).

### Audit caps

The geometry maxima come from `audit-poses.py`; grounded travel is the largest desktop or horizontal-phone measurement from `verify-skin-attack-browser.mjs`. The hold row records the shortest drawing outside the explicitly reasoned flight exceptions.

| Metric | Shipped cap | Measured maximum (minimum for holds) |
|---|---|---|
| `headStepPx` | 84 | 83.616 |
| `propStepPx` | 173 | 172.642 |
| `headRatio` | 0.05 | 0.048 |
| `propRatio` | 0.055 | 0.052 |
| `soleRatio` | 0.41 | 0.409 |
| `groundSpeedPxPerMs` | 0.44 | 0.4 |
| `minHoldMs` | 45 | 45 |
