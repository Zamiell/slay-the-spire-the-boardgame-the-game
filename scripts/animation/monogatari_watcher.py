"""Register the Sunburst attack drawings of the Monogatari Watcher skin and bake them without morphing limbs.

Run from any directory with python3 scripts/animation/monogatari_watcher.py (Pillow).
Every drawing (sources/monogatari_watcher/attack/<pose>.webp, native alpha, 1536x1024) is scaled by ONE uniform
factor, the geometric mean of its head scale (blindfold cloth height against the registered idle) and its staff
scale (leaf tip to butt against the registered idle), planted so its rear sole lands on the idle rear sole and its
lowest row on the ground, and centred nowhere else: the pose never slides, so poseShift stays 0.
registration.json (measure-monogatari_watcher.py) supplies the landmarks; skins/monogatari_watcher.json the clock.
The rest drawing (`monogatari_watcher-ready.webp`) is the idle hero with its 2.3x overscan undone. Writes the
animated idle loop but never the hero or list icon (the character export owns those). Pass --check to only verify.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image

from skin_geometry import dump_config, rear_foot_centre, save_animation, solid_box, sway, write_webp

ROOT = Path(__file__).resolve().parents[2]
REGISTRATION = ROOT / 'scripts/animation/sources/monogatari_watcher/registration.json'
CONFIG_PATH = ROOT / 'scripts/animation/skins/monogatari_watcher.json'
OUT = ROOT / 'public/assets/combat/characters'
SKIN = 'monogatari_watcher'
SCALE_AGREEMENT = (.8, 1.25)
# The idle stands on one foot (the other hangs behind it) and its staff butt hovers just above the ground, so the idle
# sole is found in its lowest rows. In an attack drawing the rear foot is the leftmost foot-wide run of solid columns in the
# lowest rows, whether or not its heel is lifted. Both drawings put that foot on one column; the config's "measure" block
# (idleRows, poseRows, unplanted) tells skin-attack.py --measure to do the same.
# In flight no foot stays on the idle stance, so these drawings keep the head over the column the neighbouring drawings hold
# (canvas px of the crown) instead; the box travel carries the whole figure.
CROWN_PLANTED = {'leap': 700, 'glide': 720, 'descend': 740, 'hop1': 620, 'hop2': 600}


def resized(image, scale):
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def rest_drawing(config):
    """The idle hero (1152 canvas, 2.3x overscan) shrunk back onto the animation canvas."""
    size, scale = config['canvas'], config['displayScale']
    edge = round(size * scale)
    full = Image.new('RGBA', (edge, edge))
    full.paste(Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA'), ((edge - size) // 2, edge - size))
    return full.resize((size, size), Image.Resampling.LANCZOS)


def hero_to_rest(config):
    size, scale = config['canvas'], config['displayScale']
    edge = round(size * scale)
    return lambda x, y: ((x + (edge - size) // 2) / (edge / size), (y + edge - size) / (edge / size))


def place(mark, ready_mark, ready, config):
    """One uniform scale per drawing; returns the frame and its baked landmarks."""
    size = config['canvas']
    source = Image.open(ROOT / mark['source']).convert('RGBA')
    head_scale = ready_mark['clothHeight'] / mark['clothHeight']
    staff_scale = ready_mark['staffLength'] / mark['staffLength']
    agreement = head_scale / staff_scale
    low, high = SCALE_AGREEMENT
    assert low <= agreement <= high, f'{mark["source"]}: head and staff disagree on body scale ({agreement:.2f})'
    scale = math.sqrt(head_scale * staff_scale)
    image = resized(source, scale)
    box = solid_box(image)
    ready_box = solid_box(ready)
    measure = config['measure']
    x = round(rear_foot_centre(ready, measure['idleRows']) - rear_foot_centre(image, measure['poseRows']))
    if mark['name'] in CROWN_PLANTED:
        x = round(CROWN_PLANTED[mark['name']] - mark['crown'][0] * scale)
    y = ready_box[3] - box[3] - config['audit'].get('airborne', {}).get(mark['name'], 0)
    frame = Image.new('RGBA', (size, size))
    frame.alpha_composite(image, (x, y))
    placed = solid_box(frame)
    assert min(placed[0], placed[1], size - placed[2], size - placed[3]) >= 8, f'{mark["source"]}: drawing touches the canvas edge {placed}'

    def at(point):
        return [round(point[0] * scale + x, 1), round(point[1] * scale + y, 1)]

    crown = at(mark['crown'])
    head = [crown[1], round(crown[1] + ready_mark['headPixels'] / ready_mark['clothHeight'] * mark['clothHeight'] * scale, 1)]
    return frame, {'scale': round(scale, 4), 'headScale': round(head_scale, 4), 'staffScale': round(staff_scale, 4),
                   'head': head, 'headX': crown[0], 'staff': [at(mark['staffTip']), at(mark['staffButt'])]}


def landmarks(config, reg, frames):
    """Inspected head and staff landmarks of every baked drawing for scripts/animation/audit-poses.py."""
    attack = reg['attack']
    to_rest = hero_to_rest(config)
    idle = reg['poses']['idle']
    crown, tip, butt = (to_rest(*idle[key]) for key in ('crown', 'staffTip', 'staffButt'))
    marks = {'idle': {'head': [round(crown[1], 1), round(crown[1] + attack['ready']['headPixels'], 1)], 'headX': round(crown[0], 1),
                      'props': {'staff': [[round(v, 1) for v in tip], [round(v, 1) for v in butt]]}}}
    for name, (_, measured) in frames.items():
        marks[name] = {'head': measured['head'], 'headX': measured['headX'], 'props': {'staff': measured['staff']}}
    return marks


def pinned(hit, config, frames):
    """A pinned flash grows from the staff tip of its drawing: right of the contact line and up from the ground, in actor edges."""
    if 'pin' not in hit:
        return hit
    size, scale = config['canvas'], config['displayScale']
    tip = frames[hit['at']][1]['staff'][0]
    contact = frames[config['contactPoses'][0]][1]['staff'][0]
    return {**hit, 'pin': {**hit['pin'], 'dx': round((tip[0] - contact[0]) * scale / size, 3), 'up': round((size - tip[1]) * scale / size, 4)}}


def main():
    reg = json.loads(REGISTRATION.read_text())
    config = json.loads(CONFIG_PATH.read_text())
    attack, ready = reg['attack'], rest_drawing(config)
    assert set(CROWN_PLANTED) == set(config['measure']['unplanted']), 'CROWN_PLANTED and the config "measure.unplanted" must name the same drawings'
    frames = {name: place({**mark, 'name': name}, attack['ready'], ready, config) for name, mark in attack['poses'].items()}
    for name, (_, measured) in frames.items():
        attack['poses'][name]['baked'] = measured
    synced = {**config, 'hits': [pinned(hit, config, frames) for hit in config['hits']],
              'audit': {**config.get('audit', {}), 'landmarks': landmarks(config, reg, frames)}}
    check = '--check' in sys.argv
    animated = OUT / 'animated'
    write_webp(animated / f'{SKIN}-ready.webp', ready, check=check, quality=90, method=6)
    sways = [sway(ready, .3 * math.sin(i * math.tau / 8), config['canvas'], config['ground']) for i in range(8)]
    save_animation(animated / f'{SKIN}-idle.webp', sways, [400] * 8, 0, ROOT, size=config['canvas'], check=check)
    for name, (frame, _) in frames.items():
        write_webp(animated / f'{SKIN}-{name}.webp', frame, check=check, quality=90, method=6)
        print(f'{name}: scale {frames[name][1]["scale"]} head x{frames[name][1]["headScale"]} staff x{frames[name][1]["staffScale"]}')
    if check:
        assert synced == config and json.loads(REGISTRATION.read_text()) == reg, 'registration or audit landmarks are stale; rerun monogatari_watcher.py'
        print('PASS: Monogatari Watcher drawings and landmarks match their sources')
        return
    CONFIG_PATH.write_text(dump_config(synced))
    REGISTRATION.write_text(json.dumps(reg, indent=2) + '\n')


if __name__ == '__main__':
    main()
