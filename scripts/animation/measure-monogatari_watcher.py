"""Measure the landmarks of the Monogatari Watcher attack drawings and store them in registration.json.

Run when a drawing changes, with a Python that has numpy, scipy and Pillow:
  python3 scripts/animation/measure-monogatari_watcher.py
Per drawing it records the blindfold cloth height (the head-scale landmark: the cloth is drawn the same
size in every pose), the crown (top of the hair mass, not the hairpin) and the straight golden staff
(leaf tip to butt, found by a line fit through the gold pixels). monogatari_watcher.py bakes with them.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/animation/sources/monogatari_watcher'
REGISTRATION = SOURCES / 'registration.json'
HAIR = dict(r=120, g=90, b=200)


def channels(image):
    pixels = np.asarray(image.convert('RGBA')).astype(int)
    return [pixels[..., index] for index in range(4)]


def gold(image):
    r, g, b, a = channels(image)
    return (a > 128) & (r > 150) & (b < 135) & (r - b > 75) & (g - b > 35) & (g > .62 * r)


def staff_of(image, tolerance=5, seed=1):
    """Leaf tip and butt of the golden staff: the longest straight gold line, bridged across hands and collars."""
    rng = np.random.default_rng(seed)
    ys, xs = np.nonzero(gold(image))
    points = np.stack([xs, ys], 1).astype(float)
    best = None
    for _ in range(600):
        i, j = rng.choice(len(points), 2, replace=False)
        direction = points[j] - points[i]
        norm = np.hypot(*direction)
        if norm < 100:
            continue
        direction /= norm
        count = (np.abs((points - points[i]) @ np.array([-direction[1], direction[0]])) < tolerance).sum()
        if best is None or count > best[0]:
            best = (count, points[i], direction)
    _, origin, direction = best
    for _ in range(3):
        near = points[np.abs((points - origin) @ np.array([-direction[1], direction[0]])) < tolerance]
        origin = near.mean(0)
        direction = np.linalg.svd(near - origin, full_matrices=False)[2][0]
    if direction[0] < 0:
        direction = -direction
    across = (points - origin) @ np.array([-direction[1], direction[0]])
    along = (points - origin) @ direction
    rod = along[np.abs(across) < tolerance]
    rod_length = rod.max() - rod.min()
    # The leaf head is wider than the rod; bridge hands and collars with the rod-length gaps of a gold run.
    kept = np.sort(along[np.abs(across) < max(tolerance + 3, .055 * rod_length)])
    runs = np.split(kept, np.where(np.diff(kept) > .2 * rod_length)[0] + 1)
    run = max(runs, key=len)
    low, high = origin + direction * run[0], origin + direction * run[-1]
    span = run[-1] - run[0]
    band = np.abs(across) < max(tolerance + 3, .055 * rod_length)
    end_width = lambda low, high: np.ptp(across[band & (along >= low) & (along <= high)])
    leaf_end = 'hi' if end_width(run[-1] - .12 * span, run[-1]) > end_width(run[0], run[0] + .12 * span) else 'lo'
    tip, butt = (high, low) if leaf_end == 'hi' else (low, high)
    return tip, butt, float(np.hypot(*(tip - butt)))


def cloth_and_crown(image):
    """Blindfold cloth bounding box (the white band next to the gold eye sigil) and the top of the hair mass."""
    r, g, b, a = channels(image)
    white = (a > 200) & (np.minimum(np.minimum(r, g), b) > 228) & (np.ptp([r, g, b], axis=0) < 14)
    labels, count = ndimage.label(white, structure=np.ones((3, 3)))
    sigil = gold(image)
    best = None
    for index in range(1, count + 1):
        cloth = labels == index
        if cloth.sum() < 150:
            continue
        near = (sigil & ndimage.binary_dilation(cloth, iterations=10)).sum()
        if near >= 20 and (best is None or near > best[0]):
            best = (near, cloth)
    assert best, 'no blindfold found'
    cloth = best[1]
    ys, xs = np.nonzero(cloth)
    box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    hair = (a > 200) & (b > r + 15) & (b > g + 25) & (r < HAIR['r']) & (b < HAIR['b']) & (g < HAIR['g'])
    hair_labels, _ = ndimage.label(hair, structure=np.ones((3, 3)))
    ids = np.unique(hair_labels[ndimage.binary_dilation(cloth, iterations=14) & hair])
    mask = np.isin(hair_labels, ids[ids > 0])
    hy, hx = np.nonzero(mask)
    height = box[3] - box[1] + 1
    near = (abs(hx - xs.mean()) < 6 * height) & (hy > ys.mean() - 8 * height) & (hy < ys.mean() + height)
    crown_y = int(hy[near].min())
    return box, [round(float(hx[near][hy[near] == crown_y].mean()), 1), crown_y]


def measure(path):
    image = Image.open(path).convert('RGBA')
    box, crown = cloth_and_crown(image)
    tip, butt, length = staff_of(image)
    return {'clothHeight': box[3] - box[1] + 1, 'crown': crown,
            'staffTip': [round(float(v), 1) for v in tip], 'staffButt': [round(float(v), 1) for v in butt],
            'staffLength': round(length, 1)}


def main():
    registration = json.loads(REGISTRATION.read_text())
    idle = measure(SOURCES / '../../../art/sources/monogatari_watcher-char/idle-cutout.webp')
    # The cutout is drawn at `scale` on the 1152 hero canvas and the hero is 2.3x the animated rest drawing.
    shrink = registration['scale'] / 2.3
    attack = registration.setdefault('attack', {})
    attack['ready'] = {'clothHeight': round(idle['clothHeight'] * shrink, 2), 'staffLength': round(idle['staffLength'] * shrink, 1),
                       'headPixels': round(registration['headPixels'] / 2.3, 2)}
    attack['poses'] = {}
    for path in sorted((SOURCES / 'attack').glob('*.webp')):
        attack['poses'][path.stem] = {'source': str(path.relative_to(ROOT)), **measure(path)}
        print(path.stem, attack['poses'][path.stem])
    REGISTRATION.write_text(json.dumps(registration, indent=2) + '\n')
    print('ready', attack['ready'])


if __name__ == '__main__':
    main()
