# Rimuru Tempest skin: character art

Skin id `anime_slime_boss` (the Slime Boss hero's "Rimuru Tempest" skin, 2,500 coins like every skin). A fan
illustration named after Rimuru Tempest (*That Time I Got Reincarnated as a Slime*): the human form of the Slime Boss (lime-green
slime in a small bowler hat), drawn from the user's own reference image (a private generation reference, not committed) and
generated with `gpt-image-2.5-sunburst` at high quality through the bundled imagegen CLI. `manifest.json` records the user's reference and the in-repo format references by description and
SHA-256 (none committed).

- Identity: the approved idle (`scripts/art/sources/anime_slime_boss-char/idle-identity.webp`, `prompts/idle.txt`): very long
  lime-green hair, tiny black bowler mini-hat, gold eyes, black high-collared coat with white shoulder panels over a dark slate
  tunic with a gold zip line, brown belt with silver buckle, grey baggy trousers into dark cuffs, tall brown lace-up boots, a
  glossy translucent lime slime glove on the right fist and a small slime blob floating by the right shoulder. The generation
  was a native-alpha edit of the reference, so it is clean (alpha noise of 8 or less zeroed, no flood-fill matte, no redraw);
  the identity file is the idle cutout.
- `scripts/art/export-anime_slime_boss-char.py` (no API calls, Pillow and numpy) writes the 1152 hero cutout and 512 icon, the
  256 Energy orb, the 512 `light`/`impact` VFX, the 256x384 portrait and 1536x864 wallpaper, the idle
  `scripts/animation/sources/anime_slime_boss/registration.json`, and refreshes the hashes in `manifest.json`.
- Idle framing: crown to near sole is 830px on the 1152 canvas (the Silent-chan and Watcher-chan rule), the near sole on y=1115,
  the stance centre on x=576 (midpoint of the two sole centres). The mini-hat top is the highest painted row (y=273, the
  registration's `hoodTop`); the body box is x 368..758. The far (right) boot stands about 51px higher, so the ground anchor is
  the near (left, lower) boot, `nearSole` (477, 1115).
- Hero-head calibration (`src/ui/hero-art-head.json`, `[animated, static]`): `[0.3316, 0.763]`. The animated slot is the 1152
  canvas `animated/anime_slime_boss-idle.webp` (0.3316, the hat top at y=770), the static slot the cropped
  `characters/anime_slime_boss-hero.webp` (0.763, hat top at y=273); `python3 scripts/calibrate-hero-head.py` measures both.
- Energy orb: a glossy lime slime sphere (core kept clear for the numeral) in a black ring with a gold inner rim, slate
  plates and silver rivets, lime drips on the lower rim and a tiny bowler hat on the top right; the VFX are a goop slash streak
  (`light`) and a goop splash burst (`impact`), both outlined in dark forest green so they read on dark and bright backdrops.
- The wallpaper is painted with her on the right (no mirroring): the start menu dims the left side for its copy. Only the bottom
  of the 3:2 source is cropped (top 1536x864 kept). The portrait is a head-and-shoulders close-up with the slime fist.
- `prompts/` holds every submitted prompt. Pose references (seated facing right, merchant standing, reaching hand and grip
  hand) for the noncombat art are recorded in the manifest and kept outside the repo in
  `/home/hieul/slime-skin-work/char/poses/`.

## Attack animation

A short slime-powered cross punch: nineteen complete drawings (eighteen attack poses and the idle) on a 1195ms clock,
`scripts/animation/skins/anime_slime_boss.json` (format: `docs/skins/attack-animation.md`). She turns to the enemy and sinks into a
step, the floating slime blob streams down her right arm and wraps the fist into a big glossy gauntlet, she coils, leaps in on one
flight drawing, lands, throws the gauntlet arm across her body (`cross0`, `cross`, `thrust`) while the bare hand pulls back, punches
(the one hit, weight 1, vfx `impact`), the gauntlet bursts into a splash while her hair and coat swing forward, then the arm folds
back (`pull`, `recoil`), she rises, hops back and settles onto the exact idle drawing. She always faces right, the face stays calm
and faintly smiling.

**One glove, one arm.** The slime glove and gauntlet are on her RIGHT arm in every drawing, the arm drawn over her torso with its
black sleeve continuous from the white shoulder panel to the cuff and the slime; her LEFT arm is always bare (the far arm, behind
her torso). The first cut had the model draw the gauntlet arm from the far shoulder with the bare arm over her chest in
`thrust`/`punch`/`splash`, and the 50 ms `step` to `thrust` cut read as the glove jumping from one hand to the other. Fixed by
redrawing those with the ARM RULE paragraph (`prompts/attack-thrust.txt` and later), tucking the bare hand at her chin in `leap`, `fly`
and `step` (it reached forward before), and adding `cross0`, `cross` and `pull` so the gauntlet arm is seen travelling forward over the
torso while the bare hand pulls back and returns (every consecutive pair was viewed side by side at large size).

Every drawing is held at least `minHoldMs` (45ms), so there is no `shortHolds` entry. The travel is a straight-line path
(`travel.path`): grounded drawings move the box almost nowhere and the flight drawing `fly` (lift 20) carries 96% of the dash, the
hop back (`hop`, lift 32) carries the return. No cut moves the head more than 110 canvas px or the blob more than 110 px, which is
why `thrust`, `cross0`/`cross`, `pull`, `recoil` and `rise0` exist.

| Key (ms) | Drawing | What happens |
|---|---|---|
| 0 | idle | the registered ready drawing |
| 40 | sink | turns to face the enemy and lowers into a step; the blob drifts toward her right shoulder |
| 90 | gather | deep boxing stance; the blob has stretched into a stream that pours down her right arm onto the glove, which swells |
| 145 | windup | the gauntlet is complete (glossy slime fist and forearm, about 1.5 times the idle glove, no separate blob) and cocked far back; low coiled stance, the bare hand in a guard at her chin |
| 225 | leap | push-off, the rear toe last on the ground; the box starts to travel (225-530ms) |
| 275 | fly | flight (lift 20), body stretched forward, gauntlet cocked back, bare hand at her chin, hair and coat streaming behind |
| 340 | step | landing stride: the far boot has landed ahead, gauntlet cocked behind her hip |
| 390 | cross0 | the gauntlet arm starts to sweep forward, the glove at her rear hip; the bare fist drops from her chin to her chest |
| 435 | cross | the gauntlet crosses in front of her belt with the sleeve cuff visible; the bare hand is tucked behind her hip |
| 485 | thrust | the arm half extended, the gauntlet in front of her chest; the bare hand open behind her |
| 530 | punch | hit (weight 1, `impact`, sound `anime_slime_boss-punch`): the arm straight, the gauntlet at full reach, droplets spraying |
| 620 | splash | the gauntlet bursts into a crown of slime droplets, hair and coat flare forward (sound `anime_slime_boss-splash`) |
| 690 | pull | the gauntlet arm pulls back with the glove deflating; the bare hand comes forward beside her ribs |
| 740 | recoil | the arm folded in front of her chest, the bare fist back in its guard at her chin |
| 795 | rise0 | half risen, the glove back to normal, a small blob forming at her shoulder |
| 850 | rise | nearly upright guard, the blob beside her right shoulder again; the travel back starts (850-1110ms) |
| 910 | hop | the airborne hop back (lift 32), still facing the enemy, hair and coat blown forward |
| 980 | land | touchdown, knees bent |
| 1035 | recover | settling toward the idle stance and the three-quarter front view |
| 1110 | idle | the exact idle drawing (the last 85ms) |

The dash whoosh (`anime_slime_boss-dash`) is cued at 205ms so it crests during the flight; the punch splat plays on the hit and the
splash on the burst drawing. Volumes 0.2, 0.32 and 0.18 are in the config's `sounds`.

Method (the Silent-chan and Watcher-chan pipeline): each drawing is a `gpt-image-2.5-sunburst` edit (high quality, native alpha,
1536x1024) from a layout canvas that holds the registered idle at 1.6x runtime scale (`scripts/animation/sources/anime_slime_boss/attack/inputs/layout-idle.webp`),
the approved identity and the previous approved drawing, normalised onto the same layout; the in-betweens get both neighbours. Three
or four candidates were drawn per prompt and every candidate was viewed against the idle before one was kept; extra rounds are
recorded in the manifest (`leap`: a second floating blob; `cross`: the gauntlet arm hidden behind the torso, three rounds; the arm review
redrew `leap`, `fly`, `step`, `thrust`, `punch`, `splash` and `recoil`). Prompts: `prompts/attack-<pose>.txt`;
hashes and rounds: `attack-manifest.json` (written by `scripts/animation/sources/anime_slime_boss/attack/make-manifest.py`).
The sources are `scripts/animation/sources/anime_slime_boss/attack/<pose>.webp` (WebP q96 with lossless alpha, 2.2 MB for all).

Bake: `scripts/animation/measure-anime_slime_boss.py` (numpy, scipy) measures per drawing the mini-hat top, the centroid of the gold
irises and the floating blob's long axis into `scripts/animation/sources/anime_slime_boss/attack-registration.json`; the head length
is hat top to iris centroid because the model draws the neck, throat and jaw at inconsistent heights (a chin landmark overstated the
head by up to 10% in the side views, which shrank the whole body). `scripts/animation/anime_slime_boss.py` (Pillow only; `--check`
verifies, `--poses a,b` re-encodes only those drawings) scales each drawing by one uniform factor (idle head over drawn head), plants
its near sole on the idle near sole and its lowest row on the ground (y=1136) minus `lift`, writes
`public/assets/combat/characters/animated/anime_slime_boss-<pose>.webp` (`-ready` is the rest drawing: the hero with the 2.3x
overscan undone), the 8-frame `-idle.webp` loop and the audit landmarks into the config. `skin-attack.py --bake-rest` was not run: it
would rewrite `anime_slime_boss-hero.webp` and `anime_slime_boss.webp` from the downscaled rest drawing (a second lossy pass), and
those two belong to the character export. `skin-attack.py --measure anime_slime_boss --write` stores `poseShift` ({}: every
drawing is planted within 1px) and `contactReach` (0.7088, measured from the punch drawing).

Spawn drawing: `public/assets/combat/characters/anime_slime_boss-spawn.webp`, one standing drawing on the 1152 hero canvas (hands raised
forward, a small slime blob budding out of her right palm) planted on the idle's near sole; baked by `anime_slime_boss.py` with
the geometric mean of the head scale and the hat-to-sole height scale, so her stature matches the idle when the two are swapped.

Audit (`audit-poses.py anime_slime_boss`, landmarks in `audit.landmarks`): the head (hat top to iris centroid) is within 0.2% of
the idle in every drawing by construction, planted sole within 1px, no clipping (15px margin; 35 and 47px for the airborne `fly` and `hop`),
no alpha fringe above 0.1%, no detached specks above 260px area (the splash droplets are the detached slime), head step at most 102px, blob step at
most 107px. The only tracked prop is the floating blob (0.65-1.27 of the idle's length; `rise0` has the blob half formed); from `gather` to
`recoil` it is absorbed into the gauntlet, which is bigger than the idle glove by design, so those drawings are in `skip.props`
and the gauntlet is checked on the filmstrip (`artifacts/skin-art/anime_slime_boss-filmstrip.png`) instead. The rear-sole width ratio
is limited to 0.33 (the lunge boots read up to 1.31 of the idle sole) and is skipped for `fly` and `hop`.

### Audit caps

The geometry maxima come from `audit-poses.py`; grounded travel is the largest desktop or horizontal-phone measurement from `verify-skin-attack-browser.mjs`. The hold row records the shortest drawing.

| Metric | Shipped cap | Measured maximum (minimum for holds) |
|---|---|---|
| `headStepPx` | 110 | 102.111 |
| `propStepPx` | 110 | 106.776 |
| `headRatio` | 0.0022 | 0.002 |
| `propRatio` | 0.36 | 0.346 |
| `soleRatio` | 0.33 | 0.308 |
| `groundSpeedPxPerMs` | 0.34 | 0.31 |
| `minHoldMs` | 45 | 45 |
