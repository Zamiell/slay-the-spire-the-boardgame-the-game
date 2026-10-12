# Monogatari Silent skin: character art

Skin id `monogatari_silent` (Silent's "Monogatari" skin). An original anime heroine in the Monogatari series
(SHAFT) style, generated with `gpt-image-2.5-sunburst` at high quality through the bundled imagegen CLI.
The copyrighted style references are never committed; `manifest.json` records each by description and SHA-256.

- Identity: the approved idle (`scripts/art/sources/monogatari_silent-char/idle-identity.webp`, a green-hooded rogue
  with acid-green slit-pupil eyes, vial bandolier, jade snake ring and poison daggers). A deterministic flood-fill
  matte left pale speckle fringe on the scarf and braid, so `idle-cutout.webp` is the same idle redrawn pose for pose
  with `--background transparent` (`prompts/idle-cutout.txt`); the alpha noise of 8 or less is zeroed.
- `scripts/art/export-monogatari_silent-char.py` (no API calls, Pillow and numpy) writes the 1152 hero cutout and 512
  icon, the 256 Energy orb, the 512 `light`/`impact` VFX, the 256x384 portrait and 1536x864 wallpaper, the idle
  `scripts/animation/sources/monogatari_silent/registration.json`, and refreshes the hashes in `manifest.json`.
- Idle framing: crown to near sole is 830px on the 1152 canvas (about 0.72 stage-actor widths, the same as the
  Watcher skin and between Ironclad and the default Watcher), the near sole on y=1115 (the Kratos hero line), the stance
  centre on x=576. The hood tip is the highest painted row (y=241). The far boot stands about 110px higher (low camera
  angle), so the ground anchor is the near boot.
- Hero-head calibration (`src/ui/hero-art-head.json`, `[animated, static]`): `[0.3438, 0.7908]`. The animated slot is the
  1152 canvas `animated/monogatari_silent-idle.webp` (0.3438), the static slot the cropped
  `characters/monogatari_silent-hero.webp` (0.7908); `python3 scripts/calibrate-hero-head.py` measures both.
- The wallpaper source is mirrored on export: the start menu dims the left side for its copy, so the heroine stands on
  the right like the other wallpapers, and only the bottom is cropped.
- `prompts/` holds every submitted prompt. Pose references (seated, reaching hand and grip, merchant) for later
  noncombat art are recorded in the manifest and kept outside the repo.

## Attack animation

A short poison-dagger strike: twenty-three complete drawings on a 1280ms clock, `scripts/animation/skins/monogatari_silent.json`
(format: `docs/skins/attack-animation.md`). She sinks, takes off and flies in on three flight drawings, lands, thrusts the
ring-hand dagger, snaps it into a rising cut that leaves one acid-green crescent, brings the arm down through three
in-betweens while the cloak and scarf swing forward, rises, hops back and settles onto the exact idle drawing.

Footwork rule: the travel is a straight-line path (`travel.path`) that gives each key its own speed. Drawings with a planted
foot move the box almost nowhere (a few head lengths over the whole stance, at most 0.45 px/ms on screen, enforced by
`audit.tolerances.groundSpeedPxPerMs` in the real-engine verifier: measured 0.36 px/ms on the desktop and 0.41 px/ms on the horizontal
phone, both during `land`); the dash is carried by the flight drawings (`dash1b`, `dash2`, `air`, `air2` out and `skip`,
`skipb` back, declared in `audit.airborne` with their `lift`), which cover about 28 head lengths in 115ms each way. Every drawing is held
at least `minHoldMs` (45ms) except the five flight drawings listed in `shortHolds` with their reasons (`dash1b` 20ms, `dash2` 35ms,
`air` and `air2` 30ms, `skipb` 40ms), so a device under 50fps never skips a grounded drawing; the grounded drawings of the
first clock (20-35ms each) were lengthened to 45ms, which moved every later key by up to 140ms, the hits and cues with them.

Cut rule: no cut moves the head more than 110 frame px (`headStepPx` 110) or either end of the near-hand dagger more than 155 frame px
(`propStepPx`, about two and a half head lengths; most cuts are under 130). The audit tracks the NEAR (ring-hand) dagger in every drawing,
tip first; the first audit tracked whichever blade was longer, which hid the real jumps. The earlier clock cut `slash` to `follow`
in one step (the dagger tip 5.7 head lengths away) and `dash3` to `skip` ran the box 225 to 917px in one or two drawings; the
three `swing` drawings, `thrust`, `air`/`air2` and `dash1b` are the in-betweens that fix that.

| Key (ms) | Drawing | What happens |
|---|---|---|
| 0 | idle | the registered ready drawing |
| 25 | coil | first sink out of the idle: knees bend, lean 12 degrees, the daggers start to turn reverse-grip |
| 70 | crouch | coiled lean on the planted boot, both daggers reverse-grip behind her hips |
| 115 | dash1 | push-off stride: the far foot has landed ahead, the near leg trails with its toe down, both daggers swept back; the box starts to move |
| 160 | dash1b | take-off: the rear toe has just left the ground (lift 10), the right arm swinging forward |
| 180 | dash2 | flight: both feet off the ground (lift 24), legs swapped, the right dagger trailing back |
| 215 | air | still flying (lift 16), the legs reach for the landing, the right arm hanging down with the dagger straight down |
| 245 | air2 | before touchdown (lift 10), the right arm swung forward, dagger down and forward |
| 275 | dash3 | landing stride: the near foot lands under her, both daggers forward; the slide is the only travel left |
| 320 | lunge | long low leap, the right dagger cocked forward at her hip, the left arm reaching forward |
| 365 | thrust | the right arm half extended, elbow bent, the fist in front of her chest |
| 410 | stab | hit 1 (weight 0.4, `impact`): right arm straight, dagger at full reach, left dagger thrown back |
| 530 | slash | hit 2 (weight 0.6, `light`): the same wrist flicks the dagger up and forward, one flat acid-green crescent trail |
| 585 | swing1 | the cut is over, the arm comes down out of it: bent elbow, fist at chin height, dagger level, the trail gone |
| 630 | swing2 | fist in front of her waist, dagger pointing forward and down |
| 675 | swing3 | the dagger flips to the reverse grip, pointing straight down at her hip |
| 720 | follow | both daggers swept back, the cloak, scarf and braid surge forward past her |
| 810 | rise0 | first moment up out of the stride, torso still leaning about 38 degrees, the cloak starting to fall back |
| 855 | rise | half risen, both daggers reverse-grip along her hips; the travel back starts |
| 900 | skip | the hop back, airborne with the shins tucked (lift 24); the cloak, scarf and braid are blown forward |
| 975 | skipb | the descent (lift 12): legs straightening for the landing |
| 1015 | land | both boots down, knees bent to about 85% of the idle height |
| 1065 | recover | she rises to about 92% of the idle height, the cloak settling; the travel ends at 1140ms |
| 1140 | idle | exact idle drawing (the last 140ms) |

The first eight in-betweens (`coil`, `dash1`-`dash3`, `rise0`, `rise`, `skip`, `land`) and the eight added later (`dash1b`, `air`,
`air2`, `thrust`, `swing1`-`swing3`, `skipb`) were made like the first six (`crouch`, `lunge`, `stab`, `slash`, `follow`, `recover`):
`gpt-image-2.5-sunburst` (edit, high, native alpha), one drawing at a time. Each prompt
(`scripts/animation/sources/monogatari_silent/combo/<pose>-prompt.txt`) supplies a 1536x1024 layout canvas with the registered idle
at 1.6x runtime scale (`layout-idle.webp`), the idle cutout shrunk to the same scale as identity, and the neighbouring approved
drawings normalised onto the same layout (scaled by the bake factor and planted on the same ground point), so body, hands, ring
and dagger designs carry over; the in-betweens get both the drawing before and the drawing after them, are asked for a true
half-way position and name the dagger position in head lengths. Four candidates were drawn per prompt and every candidate was viewed,
with the fists cropped at 3x to check the ring (only the right hand wears it). Rejected drafts: a stab with the ring on both
hands, a slash that swapped the ring to the other hand, a crouch with one dagger hand hidden behind the torso, a first coil
as deep as the crouch, a first rise nearly upright, two rounds of `air` with a ring on both hands, a first `air` whose arm still
trailed back (so the dagger jump to `dash3` was 5 head lengths), and a first `thrust` with a straight arm. The model draws every pose at its own scale
(1.4-2x the idle), so `scripts/animation/monogatari_silent.py` registers each drawing by one uniform factor, the idle head (hood
tip to chin tip, hand-inspected in `attack-registration.json`) over the drawn head, the geometric mean with the rear-sole width
for the two flat-booted drawings, then plants the near (rear) boot on the idle boot and the lowest row on the ground minus its
`lift`; `air` and `air2` have no sole to plant, so their registration carries a horizontal `shift` that puts the head between the
flights' neighbours. Her low camera angle puts the far boot higher than the near boot in every drawing; the near boot is the planted anchor.
`skin-attack.py --measure monogatari_silent` reports `poseShift` {} (every planted drawing is within 1px) and a contact reach of
0.6858 canvas edges, the stab and slash dagger tips 7 canvas px apart. `slash` and `stab` are unchanged drawings: the hits now land at 410ms and 530ms (320ms and 440ms before the grounded drawings
were lengthened to the minimum hold).

Audit (`audit-poses.py monogatari_silent`, landmarks in `audit.landmarks`): head length 0.99-1.03 of the idle in every drawing,
planted sole within 0.5px, no clipping (15px margin; 25-39px for the airborne drawings), no alpha fringe above 0.1%, no detached
specks, head step at most 110px, near-dagger step at most 150px, and every drawing viewed one by one on a filmstrip and in sheets.
Dagger blade length is 0.89-1.32 of the idle's, whose near dagger is foreshortened toward the camera: the profile drawings
are 15-30% longer on screen than the idle's (`propRatio` 0.32). The rear-sole width ratio is limited to 0.36 because several
drawings lift the rear heel and plant the toe, so the sole band measures the whole boot (and is not checked for the flight, landing
and swing drawings, whose boots are airborne, trailing or toe-down; their scale is held by the head and dagger lengths).

### Attack sounds (spec for the sound generator)

Four original procedural cues, played at their drawing's first frame (`staged-attacks.ts` volumes in the config):

| Sound | Time | Volume | Spec |
|---|---|---|---|
| `monogatari_silent-whisper` | 275ms (dash3, cue; 227ms before the grounded drawings were held 45ms) | 0.14 | blade whisper: 0.28s of band-passed noise (centre 3.5kHz, rising to 5kHz), sine-squared envelope, faint 3.2kHz metallic shimmer |
| `monogatari_silent-stab` | 410ms (hit 1; 320ms before the minimum hold) | 0.20 | stab/impact tick: 0.16s, a sharp noise click (decay 80/s), a 140Hz to 60Hz thump (decay 30/s) and a 0.08s wet poison sizzle (noise above 6kHz) |
| `monogatari_silent-slash` | 530ms (hit 2; 440ms before the minimum hold) | 0.18 | rising blade slice: 0.26s noise swept 2kHz to 6kHz with a fast attack, a short 2.4kHz ring tail (decay 22/s) |
| `monogatari_silent-cloak` | 720ms (follow, cue; 600ms before the minimum hold) | 0.10 | cloak flutter: 0.40s of low-passed noise (cut 900Hz) amplitude-modulated at 22Hz, decaying |

### Audit caps

The geometry maxima come from `audit-poses.py`; grounded travel is the largest desktop or horizontal-phone measurement from `verify-skin-attack-browser.mjs`. The hold row records the shortest drawing outside the explicitly reasoned flight exceptions.

| Metric | Shipped cap | Measured maximum (minimum for holds) |
|---|---|---|
| `headStepPx` | 110 | 109.812 |
| `propStepPx` | 151 | 150.082 |
| `headRatio` | 0.035 | 0.032 |
| `propRatio` | 0.32 | 0.315 |
| `soleRatio` | 0.36 | 0.357 |
| `groundSpeedPxPerMs` | 0.45 | 0.41 |
| `minHoldMs` | 45 | 45 |
