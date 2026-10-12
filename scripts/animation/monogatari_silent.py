"""Bake the Sunburst attack drawings of the Monogatari Silent skin onto the runtime canvas.

Run from any directory with python3 scripts/animation/monogatari_silent.py (Pillow only); --check verifies without writing.
Each drawing (sources/monogatari_silent/combo/<pose>.webp, native alpha, 1536x1024, drawn on the layout canvas that holds the
registered idle at 1.6x) is scaled by ONE uniform factor, planted so its rear sole lands on the idle rear sole and its lowest
row on the ground (`lift`, in frame px, raises the airborne drawings, the sprint's flight and the retreat hop, off it; `shift`, in frame
px, places a flight drawing that has no sole to plant between its neighbours), and never morphed: the pose never slides, so poseShift stays ~0. The factor is idle head / drawn head
(hood tip to chin tip, so a tilted head counts at its true length); for the two drawings whose rear boot stands flat
(`soleMean`) it is the geometric mean with the rear-sole width scale. attack-registration.json holds the hand-inspected
landmarks (the dagger is the NEAR, ring-hand one, tip first, in every drawing). The rest drawing is the idle hero with its 2.3x overscan undone; the animated idle is a slow rigid sway.
Writes audit.landmarks (in runtime pixels) into skins/monogatari_silent.json; never the hero or list icon (the character
exporter owns those).
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image

from skin_geometry import dump_config, rear_foot_centre, save_animation, solid_box, sole_width, sway, write_webp

ROOT = Path(__file__).resolve().parents[2]
SKIN = 'monogatari_silent'
REGISTRATION = ROOT / 'scripts/animation/sources/monogatari_silent/attack-registration.json'
CONFIG_PATH = ROOT / f'scripts/animation/skins/{SKIN}.json'
OUT = ROOT / 'public/assets/combat/characters'
ORDER = ['coil', 'crouch', 'dash1', 'dash1b', 'dash2', 'air', 'air2', 'dash3', 'lunge', 'thrust', 'stab', 'slash', 'swing1', 'swing2', 'swing3', 'follow',
         'rise0', 'rise', 'skip', 'skipb', 'land', 'recover']
IDLE_DAGGER = ((423, 699), (353, 747))  # the idle near dagger's blade on the hero canvas (foreshortened toward the camera)


def rest_drawing(config):
    """The idle hero (1152 canvas, 2.3x overscan) shrunk back onto the animation canvas."""
    size, scale = config['canvas'], config['displayScale']
    edge = round(size * scale)
    full = Image.new('RGBA', (edge, edge))
    full.alpha_composite(Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA'), ((edge - size) // 2, edge - size))
    return full.resize((size, size), Image.Resampling.LANCZOS)


def hero_to_rest(config):
    size, scale = config['canvas'], config['displayScale']
    edge = round(size * scale)
    return lambda x, y: [round((x + (edge - size) // 2) / (edge / size), 1), round((y + edge - size) / (edge / size), 1)]


def baked(source, landmarks, registration, foot, ground):
    """One uniform scale per drawing; returns the 1152 frame, its scale and the landmarks in frame pixels."""
    layout = registration['layout']
    head_scale = layout['idleHeadPixels'] / math.dist(landmarks['hoodTop'], landmarks['chin'])
    scale = head_scale
    if landmarks['soleMean']:
        scale = math.sqrt(head_scale * layout['idleSolePixels'] / sole_width(source))
    factor = scale / layout['scale']
    size = (round(source.width * factor), round(source.height * factor))
    drawing = source.resize(size, Image.Resampling.LANCZOS)
    dx = round(foot - rear_foot_centre(drawing)) + landmarks.get('shift', 0)
    dy = ground - landmarks.get('lift', 0) - solid_box(drawing)[3]
    frame = Image.new('RGBA', (1152, 1152))
    frame.alpha_composite(drawing, (dx, dy))
    to_frame = lambda point: [round(point[0] * factor + dx, 1), round(point[1] * factor + dy, 1)]
    marks = {'head': [to_frame(landmarks['hoodTop']), to_frame(landmarks['chin'])],
             'props': {'dagger': [to_frame(point) for point in landmarks['dagger']]}}
    return frame, round(scale, 4), marks


def main(argv):
    config = json.loads(CONFIG_PATH.read_text())
    registration = json.loads(REGISTRATION.read_text())
    ready = rest_drawing(config)
    foot, ground = rear_foot_centre(ready), solid_box(ready)[3]
    to_rest = hero_to_rest(config)
    frames = {'idle': ready}
    marks = {'idle': {'head': [to_rest(581, 241), to_rest(561.5, 381.6)],
                      'props': {'dagger': [to_rest(*point) for point in IDLE_DAGGER]}}}
    for pose in ORDER:
        landmarks = registration['poses'][pose]
        source = Image.open(ROOT / landmarks['source']).convert('RGBA')
        frames[pose], scale, marks[pose] = baked(source, landmarks, registration, foot, ground)
        print(f'{pose:8} scale {scale}')
    audit = {**config.get('audit', {}), 'landmarks': marks}
    outputs = {pose: OUT / f'animated/{SKIN}-{"ready" if pose == "idle" else pose}.webp' for pose in frames}
    check = '--check' in argv
    for pose, path in outputs.items():
        write_webp(path, frames[pose], check=check, quality=88, method=6)
    rest = [sway(ready, .3 * math.sin(i * math.tau / 8), 1152, config['ground']) for i in range(8)]
    save_animation(OUT / f'animated/{SKIN}-idle.webp', rest, [400] * 8, 0, ROOT, size=1152, check=check)
    if check:
        assert config.get('audit', {}).get('landmarks') == marks, 'audit landmarks are stale; run monogatari_silent.py'
        print('PASS: Monogatari Silent drawings match their sources')
        return
    config['audit'] = audit
    CONFIG_PATH.write_text(dump_config(config))


if __name__ == '__main__':
    main(sys.argv[1:])
