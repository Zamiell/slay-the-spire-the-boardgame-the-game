"""Bake the audited Sunburst drawings without morphing limbs or scaling bodies.

Run from any directory with python3 scripts/animation/kratos.py.
Pass --check to verify skins/kratos.json's measured pose shifts and contact reach without writing anything.
Native alpha stays intact; registration.json supplies inspected head landmarks and skins/kratos.json the clock.
The CSS and TypeScript tables are generated from that config by scripts/animation/skin-attack.py.
"""
import json
import math
import statistics
import sys
from pathlib import Path

from PIL import Image

from skin_geometry import SOLE_BAND, bake_rest_art, dump_config, foot_runs, sole_width, solid_box

ROOT = Path(__file__).resolve().parents[2]
REG = json.loads((ROOT / 'scripts/animation/sources/kratos/combo-v3/registration.json').read_text())
CONFIG_PATH = ROOT / 'scripts/animation/skins/kratos.json'
CFG = json.loads(CONFIG_PATH.read_text())
OUT = ROOT / 'public/assets/combat/characters'
SIZE = CFG['canvas']
# Head landmarks alone let a drawing with a small head inflate the whole body, so each
# combo-v3 drawing is also measured by its planted rear sole against the median rear sole
# of the kept combo-v2 drawings. The image model draws slightly smaller heads in dynamic
# poses, so the two scales may disagree by up to 20% and the geometric mean splits it.
SCALE_AGREEMENT = (.8, 1.2)


def resized(image, scale):
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def trim_chain(image, trim):
    """Shorten a straight thrown chain by whole links so every hit lands on one blade line.

    Everything right of `x` is the chain and its blade alone; the strip of `length` source
    pixels after `x` is removed and the blade end slides back along the chain's slope.
    """
    cut, length = trim['x'], trim['length']
    strip = image.getchannel('A').point(lambda a: 255 if a > 128 else 0).crop((cut, 0, cut + length, image.height))
    heights = [strip.crop((x, 0, x + 1, strip.height)).histogram()[255] for x in range(length)]
    assert max(heights) <= 24, f'chainTrim strip at x={cut} holds more than a chain'
    out = Image.new('RGBA', image.size)
    out.alpha_composite(image.crop((0, 0, cut, image.height)))
    out.alpha_composite(image.crop((cut + length, 0, image.width, image.height)),
                        (cut, -round(length * trim['slope'])))
    return out


def place(name, kept_sole=None):
    """One uniform scale per drawing; returns the frame, rear-foot centre, rear-sole width and reach."""
    mark = REG['poses'][name]
    source = Image.open(ROOT / mark['source']).convert('RGBA')
    if 'chainTrim' in mark:
        source = trim_chain(source, mark['chainTrim'])
    if 'skull' in mark:
        # Original combo-v2 drawings: crown-to-jaw skull landmark, stance centred on the canvas.
        scale = REG['skullPixels'] / (mark['skull'][1] - mark['skull'][0])
        x, y = SIZE / 2 - mark['stanceCenter'] * scale, CFG['ground'] - mark['foot'] * scale
    else:
        # Combo-v3 drawings: the geometric mean of the head and planted-sole scales.
        head_scale = REG['headPixels'] / (mark['head'][1] - mark['head'][0])
        agreement = kept_sole / sole_width(resized(source, head_scale))
        low, high = SCALE_AGREEMENT
        assert low <= agreement <= high, f'{name}: head and sole disagree on body scale ({agreement:.2f})'
        scale = head_scale * math.sqrt(agreement)
    image = resized(source, scale)
    box = solid_box(image)
    if 'skull' not in mark:
        x, y = SIZE / 2 - (box[0] + box[2]) / 2, CFG['ground'] - box[3]
    x, y = round(x), round(y)
    frame = Image.new('RGBA', (SIZE, SIZE))
    frame.alpha_composite(image, (x, y))
    rear = foot_runs(image, box, SOLE_BAND)[0]
    return frame, (rear[0] + rear[1]) / 2 + x, sole_width(image), box[2] + x


def layout():
    """Registered frames and the CSS shift that plants every drawing on the idle rear sole.

    Every drawing is centred in its own canvas so long chains fit; the shift puts its rear
    sole back where the idle rear sole stands, so Kratos never slides while he is out. The
    contact drawings are drawn to one reach, so planting them also lines up the blade tips.
    """
    kept = {name: place(name) for name, mark in REG['poses'].items() if 'skull' in mark}
    kept_sole = statistics.median(sole for _, _, sole, _ in kept.values())
    placed = {name: kept.get(name) or place(name, kept_sole) for name in REG['poses']}
    idle_rear = placed['idle'][1]
    offsets = {name: round(idle_rear - rear) for name, (_, rear, _, _) in placed.items()
               if 'skull' not in REG['poses'][name]}
    tips = [placed[name][3] + offsets[name] for name in CFG['contactPoses']]
    assert max(tips) - min(tips) <= REG['contactTolerance'], f'contact reach differs: {tips}'
    # Blade-tip line from the actor centre, in multiples of the contained canvas edge on screen.
    contact_reach = round((sum(tips) / len(tips) - SIZE / 2) * CFG['displayScale'] / SIZE, 4)
    return {name: frame for name, (frame, *_) in placed.items()}, offsets, contact_reach


def sync_config(offsets, contact_reach):
    """skins/kratos.json carries the measured shifts and reach; --check fails when they drift."""
    measured = {**CFG, 'poseShift': offsets, 'contactReach': contact_reach}
    if '--check' in sys.argv:
        assert measured == CFG, 'skins/kratos.json poseShift/contactReach are stale; rerun kratos.py'
        print('PASS: Kratos pose shifts and contact reach match the registered drawings')
        return
    CONFIG_PATH.write_text(dump_config(measured))


def main():
    poses, offsets, contact_reach = layout()
    sync_config(offsets, contact_reach)
    if '--check' in sys.argv:
        return
    bake_rest_art(poses['idle'], CFG, OUT, ROOT)
    keys = [(time, name) for time, name in CFG['keys']]
    assert len(keys) <= 20, 'User keyframe budget'
    times = [time for time, _ in keys]
    durations = [b - a for a, b in zip(times, times[1:] + [CFG['durationMs']])]
    assert sum(durations) == CFG['durationMs']
    assert keys[0][1] == keys[-1][1] == 'idle'
    # This unshipped review preview applies the on-screen shifts on a wider canvas.
    pad = -min(0, *offsets.values())
    preview = []
    for _, name in keys:
        frame = Image.new('RGBA', (SIZE + pad + max(0, *offsets.values()), SIZE))
        frame.alpha_composite(poses[name], (pad + offsets.get(name, 0), 0))
        preview.append(frame)
    (ROOT / 'artifacts/kratos-art').mkdir(parents=True, exist_ok=True)
    preview[0].save(ROOT / 'artifacts/kratos-art/kratos-attack.webp', save_all=True, append_images=preview[1:],
                    duration=durations, loop=0, quality=80, method=1)
    for name, pose in poses.items():
        pose.save(OUT / f'animated/kratos-{"ready" if name == "idle" else name}.webp', quality=88, method=6)
    vfx = ROOT / 'public/assets/combat/vfx/actions/kratos'
    vfx.mkdir(parents=True, exist_ok=True)
    for name in ['light', 'impact']:
        Image.open(ROOT / REG['vfx'][name]).resize((512, 512), Image.Resampling.LANCZOS).save(
            vfx / f'{name}.webp', quality=88, method=6)
    # A contrasting contact sheet makes every delivered drawing reviewable.
    sheet = Image.new('RGBA', (SIZE * 5, SIZE * math.ceil(len(poses) / 5)), '#15556c')
    for i, pose in enumerate(poses.values()):
        sheet.alpha_composite(pose, ((i % 5) * SIZE, (i // 5) * SIZE))
    sheet.convert('RGB').save(ROOT / 'artifacts/kratos-art/registered-keyframes.jpg')


if __name__ == '__main__':
    main()
