"""Seated campfire sprites: one transparent figure per visual id, composed over the one camp background at runtime.

  python3 scripts/art/campfire-sitters.py generate <visual> [--n 2] [--pose path]
      Asks gpt-image-2.5-sunburst (transparent background) for the hero seated by the fire. The hero's combat idle art
      (public/assets/combat/characters/<visual>.webp) is the identity the model must copy; the pose image only shows
      the seat, framing and firelight. Launch heroes use crops of their old solo campfire paintings
      (references/<visual>.webp); a new hero defaults to the accepted Ironclad sprite.
      Candidates land in $TMPDIR/campfire-sitters/<visual>-<n>.png. Save the accepted one as lossless
      scripts/art/sources/campfire-sitters/<visual>.webp and record its seat and crown in manifest.json.
  python3 scripts/art/campfire-sitters.py export
      Grades identity sources (or as the manifest's `grade` says), places every accepted source on the shared
      canvas and writes public/assets/noncombat/campfire/sitters/<visual>.webp (see docs/skins/campfire-scenes.md).
  python3 scripts/art/campfire-sitters.py check
      Fails when a source no longer matches its sourceSha256 or a committed sprite no longer matches a fresh export
      (verify-art-bakes.mjs runs it).
"""
import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/art/sources/campfire-sitters'
MANIFEST = SOURCES / 'manifest.json'
OUT = ROOT / 'public/assets/noncombat/campfire/sitters'

# The sprite canvas, wide and tall enough for every hero mirrored about the seat (Guardian's legs and blades are the
# longest, Defect's claws the widest). Keep in sync with .campfire__sitter in src/ui/chrome/campfire.css
# (width 22.47%, translate -50% -46.9%).
CANVAS = (1408, 1808)
SEAT = (704, 848)  # where the hips meet the log, in canvas pixels
HUMAN = 620  # seat-to-crown height of a human-sized hero, in canvas pixels; 380 px of camp.webp (the CSS width derives from it)
GRADE = {'saturation': 0.8, 'gain': (0.74, 0.84, 0.66)}
# check: a painted pixel counts as changed when a channel differs by more than CHECK_CHANNEL; lossy WebP alone changes
# under 1% of painted pixels, while a moved seat, a source, or toggling the grade or the shadow changes about 3% or more
# (except Guardian's shadow, too small to register: 0.6%).
CHECK_CHANNEL = 40
CHECK_SHARE = 0.02
# check: a grade tweak too small for the share test still shifts the mean colour of the opaque figure by 2+ levels;
# encoding alone shifts it under 0.7.
CHECK_MEAN_SHIFT = 1

# The generate prompt. Launch sprites record theirs (and any appended note) in manifest.json: the first pass used
# prompts/cutout.txt (one image, the old solo painting); the idle-art identity prompt replaced it after the model
# invented limbs for Slime Boss and Guardian.
PROMPT_FILE = SOURCES / 'prompts/identity.txt'


def generate(args):
    work = Path(os.environ.get('TMPDIR', tempfile.gettempdir())) / 'campfire-sitters'
    work.mkdir(parents=True, exist_ok=True)
    pose = Path(args.pose) if args.pose else SOURCES / 'references' / f'{args.visual}.webp'
    if not pose.exists():
        pose = SOURCES / 'ironclad.webp'
    images = [ROOT / f'public/assets/combat/characters/{args.visual}.webp', pose]
    # A hero whose design the model gets wrong gets a `note` in its manifest entry, appended to the prompt.
    note = json.loads(MANIFEST.read_text()).get(args.visual, {}).get('note', '')
    fields = []
    for index, image in enumerate(images):
        png = work / f'{args.visual}-input-{index}.png'
        Image.open(image).convert('RGBA').save(png)
        fields += ['-F', f'image[]=@{png};type=image/png']
    result = subprocess.run([
        'curl', '-sS', '--fail-with-body', 'https://api.openai.com/v1/images/edits', '-H', '@-',
        '-F', 'model=gpt-image-2.5-sunburst', '--form-string', f'prompt={PROMPT_FILE.read_text().strip()} {note}'.strip(), '-F', f'n={args.n}',
        '-F', 'size=1024x1536', '-F', 'quality=high', '-F', 'background=transparent', '-F', 'output_format=png', *fields,
    ], input=f'Authorization: Bearer {os.environ["OPENAI_API_KEY"]}\n', capture_output=True, text=True, check=False)
    if result.returncode:
        sys.exit(result.stdout + result.stderr)
    for index, item in enumerate(json.loads(result.stdout)['data']):
        target = work / f'{args.visual}-{index}.png'
        target.write_bytes(base64.b64decode(item['b64_json']))
        print(target)


def clean_alpha(figure):
    """The model leaves faint alpha noise out to the image edges; drop it so bounds and shadows follow the figure."""
    figure.putalpha(figure.getchannel('A').point(lambda value: 0 if value <= 16 else value))
    return figure


def grade(figure):
    """Dim and green a figure painted in daylight (the idle-art identity prompt) into the camp's firelit night."""
    alpha = figure.getchannel('A')
    rgb = ImageEnhance.Color(figure.convert('RGB')).enhance(GRADE['saturation'])
    rgb = Image.merge('RGB', [band.point(lambda value, gain=gain: round(value * gain)) for band, gain in zip(rgb.split(), GRADE['gain'])])
    rgb.putalpha(alpha)
    return rgb


def contact_shadow(figure):
    """The figure's footprint flattened onto the ground under its lowest pixels, blurred soft."""
    alpha = figure.getchannel('A')
    box = alpha.point(lambda value: 255 if value > 128 else 0).getbbox()
    height = max(1, (box[3] - box[1]) // 9)
    footprint = alpha.crop(box).resize((box[2] - box[0], height)).point(lambda value: round(value * 0.6))
    shadow = Image.new('L', figure.size)
    shadow.paste(footprint, (box[0], box[3] - height * 2 // 3))
    # Blur tails under 8/255 are invisible; dropping them keeps the shadow off the canvas edges.
    shadow = shadow.filter(ImageFilter.GaussianBlur(height / 2)).point(lambda value: 0 if value < 8 else value)
    layer = Image.new('RGBA', figure.size, (0, 6, 2, 0))
    layer.putalpha(shadow)
    return layer


def place(visual, entry):
    """The accepted source, graded if needed and scaled so its seat lands on SEAT and a human-sized crown sits HUMAN above it."""
    source = clean_alpha(Image.open(SOURCES / f'{visual}.webp').convert('RGBA'))
    # Cut out of the old campfire paintings, `cutout` sources already carry the camp's firelight.
    if entry.get('grade', entry['prompt'] == 'identity'):
        source = grade(source)
    scale = HUMAN * entry.get('size', 1) / (entry['seat'][1] - entry['crown'])
    figure = source.resize((round(source.width * scale), round(source.height * scale)), Image.LANCZOS)
    canvas = Image.new('RGBA', CANVAS)
    canvas.alpha_composite(figure, (round(SEAT[0] - entry['seat'][0] * scale), round(SEAT[1] - entry['seat'][1] * scale)))
    if entry.get('shadow', True):
        canvas = Image.alpha_composite(contact_shadow(canvas), canvas)
    edges = [canvas.getchannel('A').crop(box).getextrema()[1] for box in
             ((0, 0, CANVAS[0], 1), (0, CANVAS[1] - 1, CANVAS[0], CANVAS[1]), (0, 0, 1, CANVAS[1]), (CANVAS[0] - 1, 0, CANVAS[0], CANVAS[1]))]
    assert max(edges) == 0, f'{visual} is clipped by the sprite canvas; enlarge CANVAS'
    return canvas


def export(args):
    OUT.mkdir(parents=True, exist_ok=True)
    for visual, entry in json.loads(MANIFEST.read_text()).items():
        place(visual, entry).save(OUT / f'{visual}.webp', 'WEBP', quality=88, alpha_quality=90, method=6)


def check(args):
    """Fail when a source no longer matches its recorded hash or a committed sprite no longer matches a fresh export.

    The comparison tolerates lossy WebP and encoder differences between machines. It counts the painted pixels whose
    largest channel difference exceeds CHECK_CHANNEL, which a moved seat, a new source, or toggling the grade or (except
    for Guardian's tiny shadow) the shadow raises far above what encoding alone does; and it compares the mean colour of
    the opaque figure, which catches grade tweaks too small for the first test.
    """
    manifest = json.loads(MANIFEST.read_text())
    problems = [f'{visual}: sprite and manifest entry do not pair up' for visual in
                sorted(set(manifest) ^ {path.stem for path in OUT.glob('*.webp')})]
    for visual, entry in manifest.items():
        if hashlib.sha256((SOURCES / f'{visual}.webp').read_bytes()).hexdigest() != entry['sourceSha256']:
            problems.append(f'{visual}: source does not match its sourceSha256')
        if not (OUT / f'{visual}.webp').exists():
            continue
        committed = np.asarray(Image.open(OUT / f'{visual}.webp').convert('RGBA'), dtype=np.int16)
        fresh = np.asarray(place(visual, entry), dtype=np.int16)
        if committed.shape != fresh.shape:
            problems.append(f'{visual}: canvas {committed.shape[1::-1]} is not {fresh.shape[1::-1]}')
            continue
        painted = (committed[..., 3] > 0) | (fresh[..., 3] > 0)
        changed = (np.abs(committed - fresh).max(axis=2)[painted] > CHECK_CHANNEL).mean()
        if changed > CHECK_SHARE:
            problems.append(f'{visual}: {changed:.1%} of its painted pixels differ from a fresh export')
        opaque = (committed[..., 3] > 128) & (fresh[..., 3] > 128)
        shift = np.abs(committed[..., :3][opaque].mean(axis=0) - fresh[..., :3][opaque].mean(axis=0)).max()
        if shift > CHECK_MEAN_SHIFT:
            problems.append(f'{visual}: its colour differs from a fresh export by {shift:.1f} levels on average')
    if problems:
        sys.exit('stale campfire sitters (run export):\n  ' + '\n  '.join(problems))
    print(f'PASS: {len(manifest)} campfire sitters match their sources and manifest')


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    gen = commands.add_parser('generate')
    gen.add_argument('visual')
    gen.add_argument('--n', type=int, default=2)
    gen.add_argument('--pose')
    gen.set_defaults(run=generate)
    commands.add_parser('export').set_defaults(run=export)
    commands.add_parser('check').set_defaults(run=check)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()
