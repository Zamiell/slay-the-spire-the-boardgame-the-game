// Slow art audits: re-run every bake script in --check mode, decode every frame and pixel-probe the art. They prove
// committed art still matches the pipeline that made it, so affected-verifiers selects this script only when an art
// pipeline input changes (artBakeInput: animation scripts and sources, the campfire sitter and skin-card art scripts and
// sources, calibration scripts, combat art, sounds, skin art provenance).
// verify-assets.mjs keeps the fast inventory, dimension and budget checks.
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { SKIN_IDS } from '../src/game/skins.ts'
import { scratchDir } from './lib/test-skins.mjs'
import { SKIN_CARD_FACES } from '../src/game/skin-card-faces.ts'
import { suite, check, assert, assertDeepEqual, assertEqual, report } from './lib/harness.mjs'
import {
  repoRoot,
  listing,
  cardRoot,
  iconRoot,
  enemyRoot,
  combatEnemyRoot,
  combatCharacterRoot,
  combatVfxRoot,
  combatActionVfxRoot,
  combatPileRoot,
  combatStageRoot,
  statusIconRoot,
  powerIconRoot,
  relicIconRoot,
  potionIconRoot,
  campfireRoot,
  sfxRoot,
  cardFiles,
  iconFiles,
  enemyFiles,
  combatEnemyFiles,
  combatRiggedFiles,
  combatCharacterFiles,
  combatVfxFiles,
  combatActionVfxFiles,
  combatPileFiles,
  statusIconFiles,
  powerIconFiles,
  relicIconFiles,
  requiredRelicIconFiles,
  potionIconFiles,
  REQUIRED_ICONS,
  stagedSkins,
  skinConfigs,
} from './lib/asset-inventory.mjs'

suite('art bakes')

check('every Safari hardware-video companion was encoded from the current rigged animation', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'scripts/animation/safari-video-sources.json'), 'utf8'))
  const expected = combatRiggedFiles.map((file) => `public/assets/combat/rigged/${file}`).sort()
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  for (const relative of expected) {
    const source = join(repoRoot, relative)
    const video = source.replace(/\.webp$/, '.mov')
    assertEqual(manifest[relative].encoder, 'hevc-alpha-vfr-q100-v1', `${relative} Safari encoder`)
    assertEqual(manifest[relative].source, hash(source), `${relative} Safari source hash`)
    assertEqual(manifest[relative].video, hash(video), `${relative} Safari video hash`)
  }
})

check('every sound effect decodes', () => {
  for (const file of [...listing(sfxRoot, '.ogg'), ...listing(sfxRoot, '.mp3')].map((name) => join(sfxRoot, name))) {
    const result = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ], { encoding: 'utf8' })
    assert(result.status === 0 && Number(result.stdout) > 0, result.stderr || `${file} did not decode`)
  }
})

check('skin card art matches its provenance manifest', () => {
  for (const skin of SKIN_IDS) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, `docs/skins/${skin}-card-art/manifest.json`), 'utf8'))
    assertEqual(manifest.cards.length, SKIN_CARD_FACES[skin].art.length, `${skin} manifest covers every illustration`)
    const sha = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
    // Grid skins record the shared inputs of their card pipeline once, at the top of the manifest.
    for (const record of [manifest.catalogue, manifest.registration, ...(manifest.masks ?? [])].filter(Boolean)) {
      assertEqual(sha(record.path), record.sha256, `${skin} manifest: ${record.path}`)
    }
    for (const card of manifest.cards) {
      assert(card.output.path.startsWith(`public/assets/skin-card-art/${skin}/`), `${card.id} output outside skin-card-art/${skin}`)
      for (const record of [card.source, card.prompt, card.output,
        ...(card.regeneration?.inputs ?? []).filter((input) => input.path)]) {
        assert(!record.path.startsWith('/') && !record.path.split('/').includes('..'), `unsafe path ${record.path}`)
        assertEqual(sha(record.path), record.sha256, record.path)
      }
    }
  }
})

check('every rig animation keeps its baked timing, alpha bounds, body size and contact metadata', () => {
  const result = spawnSync('python3', ['scripts/animation/review-rigs.py', '--check-only'], {
    cwd: repoRoot, encoding: 'utf8',
  })
  assert(result.status === 0, result.stderr || result.stdout || 'rig audit requires Python and Pillow')
})

check('Elite and Boss intent placement matches their art', () => {
  const result = spawnSync('python3', ['scripts/calibrate-elite-intent.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'run python3 scripts/calibrate-elite-intent.py')
})

check('held potions and Orbs sit on each hero\'s head', () => {
  const result = spawnSync('python3', ['scripts/calibrate-hero-head.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'run python3 scripts/calibrate-hero-head.py')
})

check('bundled combat cutouts are transparent figures, not tiles', () => {
  const files = [
    ...combatEnemyFiles.map((file) => join(combatEnemyRoot, file)),
    ...combatCharacterFiles.filter((file) => file !== 'slime_boss-spawn.webp').map((file) => join(combatCharacterRoot, file)),
  ]
  const probe = `
import sys, json, re
from PIL import Image
faults = []
for name in sys.argv[1:]:
    im = Image.open(name).convert("RGBA")
    alpha = im.getchannel("A")
    w, h = im.size
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]
    label = name.rsplit("/", 1)[-1]
    bbox = alpha.point(lambda value: 255 if value >= 16 else 0).getbbox()
    if max(corners) > 8:
        faults.append(f"{label}: corners are opaque {corners}")
    elif sum(1 for value in alpha.getdata() if value < 16) / (w * h) < 0.05:
        faults.append(f"{label}: less than 5% of its canvas is transparent")
    elif bbox is None or min(bbox[2] - bbox[0], bbox[3] - bbox[1]) < 0.30 * min(w, h) or max(bbox[2] - bbox[0], bbox[3] - bbox[1]) < 0.55 * max(w, h):
        faults.append(f"{label}: visible art is undersized ({bbox})")
    heat = re.fullmatch(r"hexaghost-heat-(\d)\.webp", label)
    if heat:
        pixels = im.load()
        green = {(x, y) for y in range(h) for x in range(w)
                 if pixels[x, y][3] > 80 and pixels[x, y][1] > 170
                 and pixels[x, y][1] > pixels[x, y][0] * 1.25
                 and pixels[x, y][1] > pixels[x, y][2] * 1.25}
        components = 0
        while green:
            stack = [green.pop()]
            area = 0
            while stack:
                x, y = stack.pop()
                area += 1
                for point in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if point in green:
                        green.remove(point)
                        stack.append(point)
            components += area > 500
        if components != int(heat.group(1)):
            faults.append(f"{label}: expected {heat.group(1)} visible flames, found {components}")
print(json.dumps(faults))
`
  const pixelResult = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(pixelResult.status === 0, pixelResult.stderr || 'combat cutout pixel audit requires python3 + Pillow')
  const pixelFaults = JSON.parse(pixelResult.stdout.trim().split('\n').pop())
  assert(pixelFaults.length === 0, `combat cutouts have opaque backgrounds:\n    ${pixelFaults.join('\n    ')}`)
})

check('Kratos attack art provenance and measured pose shifts', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'docs/skins/kratos-art.json'), 'utf8'))
  const digest = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
  for (const entry of manifest.generated) {
    assertEqual(digest(entry.source), entry.sha256, entry.source)
    assertEqual(digest(entry.prompt), entry.promptSha256, entry.prompt)
    for (const reference of entry.inputs) assertEqual(digest(reference.path), reference.sha256, reference.path)
  }
  for (const entry of manifest.runtime) assertEqual(digest(entry.path), entry.sha256, entry.path)
  // The CSS rear-foot shifts and the travel's blade-tip reach in skins/kratos.json are measured from the drawings.
  const measured = spawnSync('python3', ['scripts/animation/kratos.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(measured.status === 0, measured.stderr || measured.stdout)
})

check('Silent-chan, Watcher-chan and Slimeboss-chan attack art provenance, and every anime skin bake matches its sources', () => {
  const digest = (path) => createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex')
  const read = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
  const generated = {
    monogatari_silent: read('docs/skins/monogatari_silent-art/manifest.json').attack.generated,
    monogatari_watcher: read('docs/skins/monogatari_watcher-art/attack-manifest.json').generated,
    anime_slime_boss: read('docs/skins/anime_slime_boss-art/attack-manifest.json').generated,
  }
  for (const [skin, entries] of Object.entries(generated)) {
    const config = readFileSync(join(repoRoot, `scripts/animation/skins/${skin}.json`), 'utf8')
    // One manifest entry per drawn pose of the animation clock (the idle key is the separate `ready` drawing).
    const drawn = [...new Set(JSON.parse(config).keys.map(([, pose]) => pose))].filter((pose) => pose !== 'idle').sort()
    // A skin of Slime Boss also records its summon drawing (`spawn`), which is not a pose of the clock.
    const posed = entries.filter((entry) => entry.name !== 'spawn')
    assertDeepEqual(posed.map((entry) => entry.name).sort(), drawn, `${skin}: attack provenance entries vs the poses of its animation config`)
    for (const entry of entries) {
      for (const hashed of [entry.source, entry.prompt, entry.output, ...entry.inputs.filter((input) => input.path)]) {
        assert(!hashed.path.startsWith('/') && !hashed.path.split('/').includes('..'), `${skin}: unsafe provenance path ${hashed.path}`)
        assertEqual(digest(hashed.path), hashed.sha256, hashed.path)
      }
      if (posed.includes(entry)) assert(config.includes(`"${entry.name}"`), `${skin}: ${entry.name} is not a pose of the animation config`)
    }
  }
  // Each bake step regenerates its runtime WebP from the committed sources and fails if any byte differs.
  for (const script of ['monogatari.py', 'monogatari_silent.py', 'monogatari_watcher.py', 'anime_slime_boss.py']) {
    const baked = spawnSync('python3', [`scripts/animation/${script}`, '--check'], { cwd: repoRoot, encoding: 'utf8' })
    assert(baked.status === 0, `${script} --check: ${baked.stderr || baked.stdout}`)
  }
})

check('every staged attack has current generated CSS, and its drawings keep native alpha, planted feet and unclipped overscan', () => {
  const generated = spawnSync('python3', ['scripts/animation/skin-attack.py', '--check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(generated.status === 0, generated.stderr || generated.stdout)
  for (const skin of stagedSkins) {
    const config = skinConfigs[skin]
    const poses = [...new Set(config.keys.map(([, pose]) => pose === 'idle' ? 'ready' : pose))]
    const airborne = config.audit?.airborne ?? {}
    const result = spawnSync('python3', ['-c', `
from PIL import Image, ImageChops
from pathlib import Path
import json
skin, poses, canvas, ground, airborne = json.loads(${JSON.stringify(JSON.stringify([skin, poses, config.canvas, config.ground, airborne]))})
root = Path('public/assets/combat/characters/animated')
idle = Image.open(root / f'{skin}-idle.webp')
assert idle.info['loop'] == 0 and idle.n_frames > 1
ready = Image.open(root / f'{skin}-ready.webp')
assert ImageChops.difference(idle.getchannel('A'), ready.getchannel('A')).getbbox() is None
images = [(idle, 0)] + [(Image.open(root / f'{skin}-{pose}.webp'), airborne.get(pose, 0)) for pose in poses]
for image, lift in images:
    assert image.size == (canvas, canvas), (image.filename, image.size)
    for i in range(image.n_frames):
        image.seek(i)
        alpha = image.getchannel('A')
        assert alpha.histogram()[0] > image.width * image.height / 2
        box = alpha.point(lambda a: 255 if a > 32 else 0).getbbox()
        assert box and min(box[0],box[1],image.width-box[2],image.height-box[3]) >= 4
        assert abs(box[3] - (ground - lift)) <= 4, (image.filename, box)
print('PASS')
`], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, `${skin}: ${result.stderr || result.stdout}`)
  }
})

check('every attack drawing keeps the idle\'s head and prop scale, and the audit rejects an enlarged pose', () => {
  // audit-poses.py reads each skin's audit block: head length and every prop within the config's tolerance of the idle's
  // (default 10%), landmarks that still sit on the drawing, planted soles, no clipping, fringes or detached specks.
  const audited = Object.entries(skinConfigs).filter(([skin, config]) => stagedSkins.includes(skin) && config.audit?.landmarks)
  assertDeepEqual(audited.map(([skin]) => skin).sort(), stagedSkins.filter((skin) => skin !== 'kratos').sort(), 'audited staged skins')
  for (const [skin] of audited) {
    const audit = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet'], { cwd: repoRoot, encoding: 'utf8' })
    assert(audit.status === 0, `${skin} attack audit:\n${audit.stdout.split('\n').filter((line) => line.startsWith('FAIL')).join('\n')}`)
  }
  // Mutation: a skin that caps the jump of its props between drawings (propStepPx) must fail when the cap shrinks to 20 px.
  for (const [skin] of audited.filter(([, config]) => config.audit.tolerances?.propStepPx)) {
    const audit = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', '--tol', 'propStepPx=20'], { cwd: repoRoot, encoding: 'utf8' })
    assert(audit.status !== 0 && /jumps \d+px between consecutive drawings/.test(audit.stdout), `${skin}: a 20px propStepPx cap passed the attack audit`)
  }
  // Mutation: the first contact drawing of each audited skin enlarged by 15% about its planted foot must fail the audit.
  const scratch = scratchDir('attack-audit')
  try {
    for (const [skin, config] of audited) {
      const pose = config.contactPoses[0]
      const made = spawnSync('python3', ['-c', `
import shutil, sys
sys.path.insert(0, 'scripts/animation')
from pathlib import Path
from PIL import Image
from skin_geometry import rear_foot_centre, solid_box
skin, pose, out = sys.argv[1:4]
source = Path('public/assets/combat/characters/animated')
for file in source.glob(skin + '-*.webp'): shutil.copy(file, out)
path = Path(out) / f'{skin}-{pose}.webp'
image = Image.open(path).convert('RGBA')
foot, ground = rear_foot_centre(image), solid_box(image)[3]
big = image.resize((round(image.width * 1.15), round(image.height * 1.15)), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', image.size)
canvas.alpha_composite(big, (round(foot - foot * 1.15), round(ground - ground * 1.15)))
canvas.save(path, quality=95)
`, skin, pose, scratch.dir], { cwd: repoRoot, encoding: 'utf8' })
      assert(made.status === 0, made.stderr)
      const audit = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', '--dir', scratch.dir], { cwd: repoRoot, encoding: 'utf8' })
      assert(audit.status !== 0 && new RegExp(`FAIL ${pose}:`).test(audit.stdout), `${skin}: a ${pose} drawing enlarged by 15% passed the attack audit`)
    }
  } finally { scratch.remove() }
})

check('every attack audit cap is exercised by a mutation, equals the measured maximum its README table documents, and cannot be loosened', () => {
  // Each audit cap is a number a person chose: shrinking it below the art must fail the real audit (so a check that was
  // disabled or never wired up shows here), and it is held to the measured maximum recorded in the skin's README table
  // (`### Audit caps`: cap | shipped | measured): the shipped cap may be tightened freely but never exceed the documented
  // one, and may not sit more than 10% above what the art measures, so there is no slack to hide a regression in.
  const DEFAULTS = { headRatio: 0.1, propRatio: 0.1, soleRatio: 0.2 }
  const MUTATIONS = {
    headStepPx: [['headStepPx=10'], /the head jumps \d+px between consecutive drawings/],
    propStepPx: [['propStepPx=10'], /the \w+ (tip|butt) jumps \d+px between consecutive drawings/],
    headRatio: [['headRatio=0.001'], /FAIL \w+: head \d/],
    propRatio: [['propRatio=0.001'], /FAIL \w+: prop "\w+" \d/],
    soleRatio: [['soleRatio=0.001'], /FAIL \w+: rear sole .* body scale drift/],
  }
  const scratch = scratchDir('attack-caps')
  try {
    for (const skin of stagedSkins.filter((id) => skinConfigs[id].audit?.landmarks)) {
      const config = skinConfigs[skin]
      const tolerances = config.audit.tolerances ?? {}
      const report = join(scratch.dir, `${skin}.json`)
      const clean = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', '--report', report], { cwd: repoRoot, encoding: 'utf8' })
      assert(clean.status === 0, `${skin}: ${clean.stdout}`)
      const measured = JSON.parse(readFileSync(report, 'utf8')).measured
      const readme = readFileSync(join(repoRoot, `docs/skins/${skin}-art/README.md`), 'utf8')
      const table = Object.fromEntries([...readme.split('### Audit caps')[1]?.split(/\n#{1,3} /)[0].matchAll(/^\| `(\w+)` \| ([\d.]+) \| ([\d.]+) \|$/gm) ?? []]
        .map(([, name, shipped, maximum]) => [name, { shipped: Number(shipped), maximum: Number(maximum) }]))
      const hold = config.minHoldMs ?? 45
      const holds = config.keys.slice(1).map(([time, pose], index) => [pose, (config.keys[index + 2]?.[0] ?? config.durationMs) - time])
        .filter(([pose]) => !(pose in (config.shortHolds ?? {}))).map(([, ms]) => ms)
      const rows = {
        ...Object.fromEntries(Object.keys(MUTATIONS).map((name) => [name, { cap: tolerances[name] ?? DEFAULTS[name], actual: measured[name] }])),
        groundSpeedPxPerMs: { cap: tolerances.groundSpeedPxPerMs },
        minHoldMs: { cap: hold, actual: Math.min(...holds), floor: true },
      }
      for (const [name, { cap, actual, floor }] of Object.entries(rows)) {
        assert(cap !== undefined, `${skin}: audit.tolerances.${name} is not set`)
        const doc = table[name]
        assert(doc, `${skin}: docs/skins/${skin}-art/README.md has no "| \`${name}\` | shipped | measured |" row under "### Audit caps"`)
        if (floor) {
          assert(cap >= doc.shipped && doc.shipped <= doc.maximum, `${skin}: ${name} ${cap} is below the documented ${doc.shipped}`)
          assert(actual >= doc.maximum, `${skin}: the shortest hold ${actual}ms is below the documented ${doc.maximum}ms`)
          continue
        }
        assert(cap <= doc.shipped, `${skin}: ${name} cap ${cap} exceeds the documented ${doc.shipped}: tighten the config, or justify a looser cap in the README table`)
        assert(doc.shipped <= doc.maximum * 1.1 + 1e-9, `${skin}: documented ${name} cap ${doc.shipped} is more than 10% above its documented maximum ${doc.maximum}`)
        assert(cap <= doc.maximum * 1.1 + 1e-9, `${skin}: ${name} cap ${cap} leaves more than 10% slack over the documented maximum ${doc.maximum}`)
        if (actual !== undefined) assert(actual <= doc.maximum + 1e-9, `${skin}: measured ${name} ${actual} exceeds the documented maximum ${doc.maximum}`)
      }
      for (const [name, [flags, expected]] of Object.entries(MUTATIONS)) {
        const run = spawnSync('python3', ['scripts/animation/audit-poses.py', skin, '--no-sheet', ...flags.flatMap((flag) => ['--tol', flag])], { cwd: repoRoot, encoding: 'utf8' })
        assert(run.status !== 0 && expected.test(run.stdout), `${skin}: shrinking ${name} did not fail the attack audit with ${expected}\n${run.stdout.split('\n').slice(-4).join('\n')}`)
      }
    }
    // The minimum hold: every shipped clock passes, and a clock with a shorter hold, an unlisted short drawing, a short drawing
    // with no reason, a non-flight shortHolds entry or a flight drawing under 20ms fails both the audit and the generator.
    const result = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.path.insert(0, 'scripts/animation')
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
attack, audit = load('skin_attack', 'scripts/animation/skin-attack.py'), load('audit_poses', 'scripts/animation/audit-poses.py')
for skin in sys.argv[1:]:
    config = json.load(open(f'scripts/animation/skins/{skin}.json'))
    assert not attack.hold_problems(config), config
    keys = config['keys']
    def shorten(c, index, hold):
        c['keys'] = [[time - (keys[index + 1][0] - keys[index][0] - hold) * (i > index), pose] for i, (time, pose) in enumerate(keys)]
        c['durationMs'] -= keys[index + 1][0] - keys[index][0] - hold
        return c
    grounded = next(i for i, (_, pose) in enumerate(keys) if 0 < i < len(keys) - 1 and pose not in config.get('shortHolds', {}) and pose not in config['audit'].get('airborne', {}))
    cases = {
        'a grounded drawing held 30ms': shorten(json.loads(json.dumps(config)), grounded, 30),
        'minHoldMs raised past every hold': {**config, 'minHoldMs': 1000},
        'an unreasoned shortHolds entry': {**config, 'shortHolds': {**config.get('shortHolds', {}), 'nope': ''}},
        'a non-flight shortHolds entry': {**config, 'shortHolds': {**config.get('shortHolds', {}), keys[grounded][1]: 'because'}},
    }
    flight = next((i for i, (_, pose) in enumerate(keys) if pose in config.get('shortHolds', {})), None)
    if flight is not None:
        cases['a flight drawing held 10ms'] = shorten(json.loads(json.dumps(config)), flight, 10)
        unlisted = json.loads(json.dumps(config)); unlisted['shortHolds'].pop(keys[flight][1])
        cases['a short flight drawing with no shortHolds entry'] = unlisted
    for label, bad in cases.items():
        assert attack.hold_problems(bad), f'{skin}: {label} passed the hold check'
        assert any('holds' in e or 'shortHolds' in e for e in audit.audit(bad, attack.CHARACTERS / 'animated')[0]), f'{skin}: {label} passed the audit'
        try: attack.validate({**bad, 'contactReach': 0})
        except AssertionError as error:
            assert any(word in str(error) for word in ('holds', 'shortHolds', 'shorter than 20ms')), f'{skin}: {label} failed the generator for another reason: {error}'
            continue
        raise SystemExit(f'{skin}: {label} passed the generator')
print('PASS')
`, ...stagedSkins.filter((id) => skinConfigs[id].audit?.landmarks)], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, result.stderr.trim().split('\n').at(-1) || result.stdout)
  } finally { scratch.remove() }
})

check('stored poseShift and contactReach match a fresh measurement of every Monogatari attack drawing, and drift fails', () => {
  // Kratos is held to the same by kratos.py --check above. --measure --check is read-only.
  const measured = stagedSkins.filter((skin) => skin !== 'kratos')
  for (const skin of measured) {
    const result = spawnSync('python3', ['scripts/animation/skin-attack.py', '--measure', skin, '--check'], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, `${skin}: ${result.stderr.trim().split('\n').at(-1) || result.stdout}`)
  }
  // Mutations: a pose shifted by 60 canvas px (either way) or a contact reach off by 0.3 must be reported stale by the
  // measurement check, and a 60px shift of a contact drawing must fail the planted-sole audit.
  const mutated = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.path.insert(0, 'scripts/animation')
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
attack, audit = load('skin_attack', 'scripts/animation/skin-attack.py'), load('audit_poses', 'scripts/animation/audit-poses.py')
for skin in sys.argv[1:]:
    config = json.load(open(f'scripts/animation/skins/{skin}.json'))
    shifts, reach, _ = attack.measure(config, attack.baked({**config, 'contactReach': 0}))
    assert not attack.stale_measurements(config, shifts, reach), f'{skin}: unmutated config reported stale'
    pose = config['contactPoses'][0]
    for delta in (60, -60):
        bad = {**config, 'poseShift': {**config.get('poseShift', {}), pose: config.get('poseShift', {}).get(pose, 0) + delta}}
        assert attack.stale_measurements(bad, shifts, reach), f'{skin}: a {delta:+d}px poseShift on {pose} passed the measurement check'
        errors = audit.audit(bad, attack.CHARACTERS / 'animated')[0]
        assert any(error.startswith(f'{pose}: planted rear sole') for error in errors), f'{skin}: a {delta:+d}px poseShift on {pose} passed the planted-sole audit'
    assert attack.stale_measurements({**config, 'contactReach': config['contactReach'] + 0.3}, shifts, reach), f'{skin}: a +0.3 contactReach passed'
print('PASS')
`, ...measured], { cwd: repoRoot, encoding: 'utf8' })
  assert(mutated.status === 0, mutated.stderr.trim().split('\n').at(-1) || mutated.stdout)
})

check('the staged attack generator rejects malformed configs and accepts the test skins', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.path.insert(0, 'scripts/animation')
spec = importlib.util.spec_from_file_location('skin_attack', 'scripts/animation/skin-attack.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
for name in ('test_combo', 'test_strike'):
    config = json.load(open(f'scripts/animation/test-skins/{name}.json')); config['contactReach'] = 1
    module.validate(config)
good = json.load(open('scripts/animation/test-skins/test_combo.json')); good['contactReach'] = 1
cases = {
    'hit weights that do not add up': lambda c: c['hits'][0].update(weight=.5),
    'unknown hit style': lambda c: c['hits'][0].update(style='zap'),
    'hit sound without a volume': lambda c: c['hits'][0].update(sound='nope'),
    'hit on an unknown pose': lambda c: c['hits'][0].update(at='nope'),
    'hits out of time order': lambda c: c['hits'].reverse(),
    'clock that does not end idle': lambda c: c['keys'][-1].__setitem__(1, 'slam'),
    'travel back before out': lambda c: c['travel'].update(back=[10, 20]),
    'too many keys': lambda c: c['keys'].__setitem__(slice(1, 1), [[i + 1, 'slam'] for i in range(20)]),
    'contact pose that is not drawn': lambda c: c.update(contactPoses=['nope']),
    'shift for an unknown pose': lambda c: c.update(poseShift={'nope': 1}),
}
for label, mutate in cases.items():
    bad = json.loads(json.dumps(good)); mutate(bad)
    try: module.validate(bad)
    except AssertionError: continue
    raise SystemExit(f'accepted: {label}')
print('PASS')
`], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || result.stdout)
})

check('combat animation effects are visible effects on transparent canvases', () => {
  const files = [...combatVfxFiles.map((file) => join(combatVfxRoot, file)), ...combatActionVfxFiles.map((file) => join(combatActionVfxRoot, file))]
  const probe = `
import sys, json
from PIL import Image
faults = []
for name in sys.argv[1:]:
    alpha = Image.open(name).convert("RGBA").getchannel("A")
    w, h = alpha.size
    values = list(alpha.getdata())
    label = name.rsplit("/", 1)[-1]
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]
    transparent = sum(value < 16 for value in values) / len(values)
    visible = sum(value >= 16 for value in values) / len(values)
    if max(corners) > 8:
        faults.append(f"{label}: corners are opaque {corners}")
    elif transparent < 0.5:
        faults.append(f"{label}: only {transparent * 100:.1f}% transparent")
    elif visible < 0.005:
        faults.append(f"{label}: only {visible * 100:.1f}% visible")
print(json.dumps(faults))
`
  const pixelResult = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(pixelResult.status === 0, pixelResult.stderr || 'combat VFX pixel audit requires python3 + Pillow')
  assertDeepEqual(JSON.parse(pixelResult.stdout.trim().split('\n').pop()), [],
    'combat VFX must be visible effects on transparent canvases')
})

check('generated status, relic, and potion icons have transparent backgrounds', () => {
  const files = [
    ...statusIconFiles.map((name) => join(statusIconRoot, name)),
    ...requiredRelicIconFiles.map((name) => join(relicIconRoot, name)),
    ...potionIconFiles.map((name) => join(potionIconRoot, name)),
    join(iconRoot, 'hexaghost-flame.png'),
    join(iconRoot, 'hermit-chamber.png'),
    join(iconRoot, 'hermit-chamber-loaded.png'),
  ]
  const probe = `
import sys, json
from PIL import Image
faults = []
restored_relics = {
    "battle_buddies.png", "black_powder.png", "chronometer.png", "clasped_locket.png",
    "dented_plate.png", "dueling_glove.png", "forbidden_fruit.png", "fuel_canister.png",
    "greed_ooze.png", "knowing_skull.png", "kunai.png", "makeshift_battery.png",
    "pantograph.png", "potion_belt.png", "sack_of_gems.png", "shot_glass.png",
    "shuriken.png", "snecko_egg.png", "straight_razor.png", "teleportation_stone.png",
    "the_broken_seal.png", "thimble_helm.png", "unceasing_top.png", "wheel_of_change.png",
}
for name in sys.argv[1:]:
    alpha = Image.open(name).convert("RGBA").getchannel("A")
    w, h = alpha.size
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]
    visible = sum(1 for value in alpha.getdata() if value > 32) / (w * h)
    bbox = alpha.point(lambda value: 255 if value > 32 else 0).getbbox()
    if max(corners) > 8 or visible < 0.01:
        faults.append(f"{name}: corners={corners}, visible={visible:.3f}")
    elif "/potion-icons/" in name.replace("\\\\", "/") and bbox and min(bbox[0], bbox[1], w - bbox[2], h - bbox[3]) < 8:
        faults.append(f"{name}: alpha bounds {bbox} still contain the old inventory tile")
    elif name.replace("\\\\", "/").split("/")[-1] in restored_relics and (visible > 0.5 or not bbox or min(bbox[0], bbox[1], w - bbox[2], h - bbox[3]) < 8):
        faults.append(f"{name}: visible={visible:.3f}, alpha bounds={bbox}; relic still looks like a framed tile")
print(json.dumps(faults))
`
  const result = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || 'generated icon audit requires python3 + Pillow')
  const faults = JSON.parse(result.stdout.trim().split('\n').pop())
  assertDeepEqual(faults, [], 'generated icons need transparent corners and visible art')
})

// Bytes are not pixels. Every broken conversion this pipeline can produce —
// keying disabled, luminance inverted, alpha left faint — yields a file well
// over any size threshold while rendering as a white tile or as nothing at
// all. An invisible icon does not look broken, and this pass removed the text
// captions that used to cover for one.
check('every icon is a symbol on transparent paper, not a tile', () => {
  if (iconFiles.length === 0) return // not synced

  // Measured with Pillow, which this pipeline already requires to build the
  // icons in the first place. Hand-rolling a PNG decoder here would be more
  // code than the check.
  const probe = `
import sys, json
from PIL import Image
faults = []
for name in sys.argv[1:]:
    im = Image.open(name).convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    label = name.rsplit("/", 1)[-1]
    if max(corners) > 8:
        faults.append(f"{label}: corners are opaque {corners} - the paper was not keyed out")
        continue
    opaque = [px[x, y] for y in range(h) for x in range(w) if px[x, y][3] > 200]
    fraction = len(opaque) / (w * h)
    if fraction < 0.02:
        faults.append(f"{label}: only {fraction * 100:.1f}% opaque - effectively invisible")
        continue
    # The paper is white, so ANY opaque near-white pixel means it survived the
    # keying. Measured: a correctly keyed icon has none at all; leaving the
    # paper in gives 50-67%. The corners alone cannot catch this, because the
    # extracted images already have transparent margins.
    paper = sum(1 for p in opaque if min(p[0], p[1], p[2]) > 230) / len(opaque)
    if paper > 0.15:
        faults.append(f"{label}: {paper * 100:.0f}% of the symbol is white paper - it renders as a tile")
print(json.dumps(faults))
`
  const files = REQUIRED_ICONS.map((name) => join(iconRoot, `${name}.png`)).filter((file) =>
    existsSync(file),
  )
  const result = spawnSync('python3', ['-c', probe, ...files], { encoding: 'utf8' })
  assert(result.status === 0, result.stderr || result.error?.message || 'icon pixel audit requires python3 + Pillow')
  const faults = JSON.parse(result.stdout.trim().split('\n').pop())
  assert(faults.length === 0, `icon conversion is wrong:\n    ${faults.join('\n    ')}`)
})

check('every artwork file fully decodes', () => {
  for (const [dir, extension, count] of [
    [cardRoot, 'webp', cardFiles.length],
    [enemyRoot, 'webp', enemyFiles.length],
    [combatEnemyRoot, 'webp', combatEnemyFiles.length],
    [combatCharacterRoot, 'webp', combatCharacterFiles.length],
    [combatVfxRoot, 'webp', combatVfxFiles.length],
    [combatPileRoot, 'webp', combatPileFiles.length],
    [combatStageRoot, 'webp', existsSync(join(combatStageRoot, 'stage-act-1.webp')) ? 1 : 0],
    [iconRoot, 'png', iconFiles.length],
    [statusIconRoot, 'png', statusIconFiles.length],
    [powerIconRoot, 'png', powerIconFiles.length],
    [relicIconRoot, 'png', relicIconFiles.length],
    [potionIconRoot, 'png', potionIconFiles.length],
    [campfireRoot, 'webp', listing(campfireRoot, '.webp').length],
    [join(campfireRoot, 'sitters'), 'webp', listing(join(campfireRoot, 'sitters'), '.webp').length],
  ]) {
    if (count === 0) continue
    const result = spawnSync('ffmpeg', [
      '-v', 'error', '-pattern_type', 'glob', '-i', join(dir, `*.${extension}`), '-f', 'null', '-',
    ], { encoding: 'utf8' })
    assert(result.status === 0, result.stderr || `could not decode ${dir}/*.${extension}`)
  }
})

check('every campfire sitter matches its accepted source, manifest entry and export', () => {
  const result = spawnSync('python3', ['scripts/art/campfire-sitters.py', 'check'], { cwd: repoRoot, encoding: 'utf8' })
  assert(result.status === 0, result.stderr || result.stdout)
})

report('art bakes')
