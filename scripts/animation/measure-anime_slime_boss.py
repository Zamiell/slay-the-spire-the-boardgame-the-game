"""Measure the landmarks of the Rimuru Tempest attack drawings into sources/anime_slime_boss/attack-registration.json.

Run with python3 scripts/animation/measure-anime_slime_boss.py (Pillow, numpy and scipy); anime_slime_boss.py then bakes from the file.
Per drawing (sources/anime_slime_boss/attack/<pose>.webp, 1536x1024, native alpha, drawn on the layout canvas that holds the registered
idle at 1.6x runtime scale) it finds, in source pixels:
  hatTop  the topmost pixel of the black mini-hat (the highest dark blob that is wider than tall),
  eye     the centroid of the gold iris pixels under the hat. Hat top to eye is the head length: the model draws the neck, throat and
          jaw at inconsistent heights (a chin landmark overstated the head by up to 10% in the side views), the irises are constant,
  blob    the two ends of the long axis of the floating slime blob (the largest detached lime component), or null while the blob
          has been absorbed into the gauntlet (the gauntlet is bigger than the idle glove by design, so it is not a tracked prop).
The idle is measured on the layout canvas given to the model (inputs/layout-idle.webp, the hero shrunk to 1.6x runtime scale), the same
way as every drawing, then mapped to the runtime rest drawing's pixels; the spawn drawing gets the same
hat and eye landmarks, and heroHeadPixels is the idle head on the 1152 hero canvas that it is scaled to.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
from anime_slime_boss import CONFIG_PATH, OUT, REGISTRATION, ROOT, SKIN  # noqa: E402
from skin_geometry import rear_foot_centre, solid_box  # noqa: E402

LAYOUT = ROOT / 'scripts/animation/sources/anime_slime_boss/attack/inputs/layout-idle.webp'


def hat_top(array):
    alpha = array[..., 3] > 200
    dark = alpha & (array[..., :3].max(2) < 70)
    labels, count = ndi.label(dark)
    best = None
    for index, box in enumerate(ndi.find_objects(labels), 1):
        height, width = box[0].stop - box[0].start, box[1].stop - box[1].start
        area = int((labels[box] == index).sum())
        if area > 100 and width > height * .8 and (best is None or box[0].start < best[0]):
            best = (box[0].start, index)
    assert best, 'no mini-hat found'
    ys, xs = np.nonzero(labels == best[1])
    top = ys.argmin()
    return int(xs[top]), int(ys[top])


def eye_centroid(array, hat, scale=1.0, loose=False):
    red, green, blue = (array[..., i].astype(int) for i in range(3))
    gold = (array[..., 3] > 200) & (red > 150) & (green > 95) & (green < 200) & (blue < 110) & (red > green * 1.08) & (red - blue > 90)
    if loose:
        gold = (array[..., 3] > 200) & (red > 120) & (green > 80) & (blue < 120) & (red >= green * 1.04) & (red - blue > 55)
    box = np.zeros_like(gold)
    x, y = hat
    box[round(y + 20 * scale):round(y + 130 * scale), max(0, round(x - 110 * scale)):round(x + 110 * scale)] = True
    ys, xs = np.nonzero(gold & box)
    assert len(xs) >= 6, 'no iris pixels found'
    return float(xs.mean()), float(ys.mean())


def blob_axis(array, min_area):
    solid = array[..., 3] > 32
    labels, count = ndi.label(solid, structure=np.ones((3, 3)))
    areas = ndi.sum(solid, labels, range(1, count + 1))
    order = np.argsort(-areas)
    for index in order[1:]:
        if areas[index] >= min_area:
            ys, xs = np.nonzero(labels == index + 1)
            points = np.stack([xs, ys], 1).astype(float)
            centre = points.mean(0)
            axis = np.linalg.svd(points - centre, full_matrices=False)[2][0]
            along = (points - centre) @ axis
            return [points[along.argmax()].round(1).tolist(), points[along.argmin()].round(1).tolist()]
    return None


def main():
    config = json.loads(CONFIG_PATH.read_text())
    registration = json.loads(REGISTRATION.read_text())
    layout = registration['layout']
    # The idle is measured on the layout canvas the model was given (the hero scaled by layout.scale / displayScale, near sole on
    # rearSoleX/ground), exactly like every drawing, then mapped to the runtime rest drawing.
    array = np.array(Image.open(LAYOUT).convert('RGBA'))
    hat = hat_top(array)
    eye = eye_centroid(array, hat)
    size, display = config['canvas'], config['displayScale']
    to_hero = layout['scale'] / display
    hero_foot, hero_ground = rear_foot_centre(Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA')), solid_box(Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA'))[3]
    edge = round(size * display)
    to_rest = lambda point: [round((((point[0] - (layout['rearSoleX'] - hero_foot * to_hero)) / to_hero) + (edge - size) // 2) / (edge / size), 1),
                             round((((point[1] - (layout['ground'] - hero_ground * to_hero)) / to_hero) + edge - size) / (edge / size), 1)]
    registration['idle'] = {'hatTop': to_rest(hat), 'eye': to_rest(eye), 'blob': [to_rest(point) for point in blob_axis(array, 900)]}
    registration['layout']['idleHeadPixels'] = round(math.dist(hat, eye), 1)
    for pose, entry in registration['poses'].items():
        array = np.array(Image.open(ROOT / entry['source']).convert('RGBA'))
        hat = hat_top(array)
        eye = eye_centroid(array, hat)
        entry['hatTop'], entry['eye'] = list(hat), [round(eye[0], 1), round(eye[1], 1)]
        entry['blob'] = blob_axis(array, 900) if entry.get('trackBlob') else None
        print(f'{pose:8} hat {hat} eye {entry["eye"]} head {math.dist(hat, eye):.1f} blob {entry["blob"]}')
    spawn = registration['spawn']
    array = np.array(Image.open(ROOT / spawn['source']).convert('RGBA'))
    hat = hat_top(array)
    eye = eye_centroid(array, hat)
    spawn['hatTop'], spawn['eye'] = list(hat), [round(eye[0], 1), round(eye[1], 1)]
    registration['heroHeadPixels'] = round(registration['layout']['idleHeadPixels'] * config['displayScale'] / layout['scale'], 1)
    registration['heroHatTopY'] = hat_top(np.array(Image.open(OUT / f'{SKIN}-hero.webp').convert('RGBA')))[1]
    REGISTRATION.write_text(json.dumps(registration, indent=1) + '\n')


if __name__ == '__main__':
    main()
