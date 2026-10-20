"""Bake the Sunburst attack drawings of the Rimuru Tempest skin onto the runtime canvas.

Run from any directory with python3 scripts/animation/anime_slime_boss.py (Pillow only); --check verifies without writing.
Each drawing (sources/anime_slime_boss/attack/<pose>.webp, native alpha, 1536x1024, drawn on the layout canvas that holds the registered
idle at 1.6x) is scaled by ONE uniform factor, planted so its near (rear) sole lands on the idle near sole and its lowest row on the
ground (`lift`, in frame px, raises the airborne drawings, the dash and the retreat hop, off it; `shift`, in frame px, moves a flight
drawing that has no sole to plant), and never morphed: the pose never slides, so poseShift stays ~0. The factor is idle head / drawn
head (mini-hat top to the centroid of the irises, measured by measure-anime_slime_boss.py into attack-registration.json). The rest
drawing is the idle hero with its 2.3x overscan undone; the animated idle is a slow rigid sway. Writes audit.landmarks (in runtime
pixels: the head, and the floating slime blob wherever it floats) into skins/anime_slime_boss.json; never the hero or list icon
(the character exporter owns those), and never the spawn drawing (spawn_drawing() below, run with --spawn).
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image

from skin_geometry import dump_config, rear_foot_centre, save_animation, solid_box, sway, write_webp

ROOT = Path(__file__).resolve().parents[2]
SKIN = 'anime_slime_boss'
REGISTRATION = ROOT / 'scripts/animation/sources/anime_slime_boss/attack-registration.json'
CONFIG_PATH = ROOT / f'scripts/animation/skins/{SKIN}.json'
OUT = ROOT / 'public/assets/combat/characters'


def rest_drawing(config):
    """The idle hero (1152 canvas, 2.3x overscan) shrunk back onto the animation canvas."""
    size, scale = config['canvas'], config['displayScale']
    edge = round(size * scale)
    full = Image.new('RGBA', (edge, edge))
    full.alpha_composite(Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA'), ((edge - size) // 2, edge - size))
    return full.resize((size, size), Image.Resampling.LANCZOS)


def baked(source, entry, registration, foot, ground):
    """One uniform scale per drawing; returns the 1152 frame, its scale and the landmarks in frame pixels."""
    layout = registration['layout']
    scale = layout['idleHeadPixels'] / math.dist(entry['hatTop'], entry['eye'])
    factor = scale / layout['scale']
    drawing = source.resize((round(source.width * factor), round(source.height * factor)), Image.Resampling.LANCZOS)
    dx = round(foot - rear_foot_centre(drawing)) + entry.get('shift', 0)
    dy = ground - entry.get('lift', 0) - solid_box(drawing)[3]
    frame = Image.new('RGBA', (1152, 1152))
    frame.alpha_composite(drawing, (dx, dy))
    to_frame = lambda point: [round(point[0] * factor + dx, 1), round(point[1] * factor + dy, 1)]
    marks = {'head': [to_frame(entry['hatTop']), to_frame(entry['eye'])]}
    if entry.get('blob'):
        marks['props'] = {'blob': [to_frame(point) for point in entry['blob']]}
    return frame, round(scale, 4), marks


def spawn_drawing(registration):
    """The static summoning drawing on the hero canvas (the idle hero's scale and near sole), not the animation canvas."""
    entry = registration['spawn']
    hero = Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA')
    foot, ground = rear_foot_centre(hero), solid_box(hero)[3]
    hero_head = registration['heroHeadPixels']
    source = Image.open(ROOT / entry['source']).convert('RGBA')
    # The standing spawn drawing is swapped with the idle for a moment, so it keeps the idle's stature as well as its head: the
    # geometric mean of the head scale and the hat-top-to-sole height scale (the model draws a standing body a few percent short).
    head_scale = hero_head / math.dist(entry['hatTop'], entry['eye'])
    height_scale = (ground - registration['heroHatTopY']) / (solid_box(source)[3] - entry['hatTop'][1])
    factor = math.sqrt(head_scale * height_scale)
    drawing = source.resize((round(source.width * factor), round(source.height * factor)), Image.Resampling.LANCZOS)
    dx = round(foot - rear_foot_centre(drawing))
    dy = ground - solid_box(drawing)[3]
    frame = Image.new('RGBA', hero.size)
    frame.alpha_composite(drawing, (dx, dy))
    return frame


def main(argv):
    config = json.loads(CONFIG_PATH.read_text())
    registration = json.loads(REGISTRATION.read_text())
    check = '--check' in argv
    ready = rest_drawing(config)
    foot, ground = rear_foot_centre(ready), solid_box(ready)[3]
    frames = {'idle': ready}
    idle = registration['idle']
    marks = {'idle': {'head': [idle['hatTop'], idle['eye']], 'props': {'blob': idle['blob']}}}
    for pose, entry in registration['poses'].items():
        source = Image.open(ROOT / entry['source']).convert('RGBA')
        frames[pose], scale, marks[pose] = baked(source, entry, registration, foot, ground)
        print(f'{pose:8} scale {scale}')
    audit = {**config.get('audit', {}), 'landmarks': marks}
    outputs = {pose: OUT / f'animated/{SKIN}-{"ready" if pose == "idle" else pose}.webp' for pose in frames}
    only = argv[argv.index('--poses') + 1].split(',') if '--poses' in argv else None  # re-encode just these drawings (the encodes are slow)
    for pose, path in outputs.items():
        if only is None or pose in only:
            write_webp(path, frames[pose], check=check, quality=88, method=6)
    if only is None:
        rest = [sway(ready, .3 * math.sin(i * math.tau / 8), 1152, config['ground']) for i in range(8)]
        save_animation(OUT / f'animated/{SKIN}-idle.webp', rest, [400] * 8, 0, ROOT, size=1152, check=check)
    if 'spawn' in registration and (only is None or 'spawn' in only):
        write_webp(OUT / f'{SKIN}-spawn.webp', spawn_drawing(registration), check=check, quality=92, method=6)
    if check:
        assert config.get('audit', {}).get('landmarks') == marks, 'audit landmarks are stale; run anime_slime_boss.py'
        print('PASS: Rimuru Tempest drawings match their sources')
        return
    config['audit'] = audit
    CONFIG_PATH.write_text(dump_config(config))


if __name__ == '__main__':
    main(sys.argv[1:])
