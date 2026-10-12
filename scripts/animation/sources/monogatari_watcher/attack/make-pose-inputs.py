"""Rebuild the two inputs the attack drawings were prompted with (Pillow only):

  inputs/layout-<s>.png   the registered idle on a transparent 1536x1024 canvas at s x the animation rest scale
  inputs/guide-<pose>.png a rough stick-figure pose guide with a flat gold bar showing the staff's exact length and line

Run python3 make-pose-inputs.py from any directory. guides.json holds the joint coordinates (pixels of a
1536x1024 canvas drawn for a head 74 px tall and a staff 575 px long, ground y=960, rear foot x=390) and each
pose's `scale` and `x` (where the rear foot lands), exactly as submitted to gpt-image-2.5-sunburst.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
HERO = ROOT / 'public/assets/combat/characters/monogatari_watcher-hero.webp'
HEAD, STAFF, GROUND, BASE_X = 74, 575, 960, 390
BLUE, GOLD, OUTLINE = (60, 90, 200), (222, 178, 60), (120, 90, 20)
BONES = [('hip', 'neck'), ('neck', 'head'), ('neck', 'rsh'), ('rsh', 'rel'), ('rel', 'rh'), ('neck', 'lsh'), ('lsh', 'lel'),
         ('lel', 'lh'), ('hip', 'rk'), ('rk', 'rf'), ('hip', 'lk'), ('lk', 'lf')]


def rest_drawing(overscan=2.3, size=1152):
    edge = round(size * overscan)
    full = Image.new('RGBA', (edge, edge))
    full.paste(Image.open(HERO).convert('RGBA'), ((edge - size) // 2, edge - size))
    return full.resize((size, size), Image.Resampling.LANCZOS)


def layout(scale, x, out):
    ready = rest_drawing()
    figure = ready.crop(ready.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox())
    figure = figure.resize((round(figure.width * scale), round(figure.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (1536, 1024))
    canvas.alpha_composite(figure, (x - figure.width // 2, GROUND - figure.height))
    canvas.save(out)


def staff(draw, butt, degrees, k):
    length = STAFF * k
    a = math.radians(degrees)
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    at = lambda t, w=0: (butt[0] + u[0] * t + v[0] * w, butt[1] + u[1] * t + v[1] * w)
    draw.line([at(0), at(length - 70 * k)], fill=GOLD, width=max(3, int(9 * k)))
    draw.polygon([at(length - 72 * k, 6 * k), at(length - 62 * k, 16 * k), at(length - 18 * k, 20 * k), at(length),
                  at(length - 18 * k, -20 * k), at(length - 62 * k, -16 * k), at(length - 72 * k, -6 * k)], fill=GOLD, outline=OUTLINE)
    ring = at(length - 76 * k)
    draw.ellipse([ring[0] - 9 * k, ring[1] - 9 * k, ring[0] + 9 * k, ring[1] + 9 * k], outline=OUTLINE, width=3)


def guide(pose, spec, out):
    k, x0 = spec['scale'], spec['x']
    at = lambda p: (x0 + (p[0] - BASE_X) * k, GROUND + (p[1] - GROUND) * k)
    joints = {name: at(p) for name, p in spec['joints'].items()}
    image = Image.new('RGB', (1536, 1024), 'white')
    draw = ImageDraw.Draw(image)
    for a, b in BONES:
        draw.line([joints[a], joints[b]], fill=BLUE, width=int((14 if (a, b) == ('hip', 'neck') else 10) * k))
    hx, hy = joints['head']
    h = HEAD * k
    draw.ellipse([hx - h * .4, hy - h * .5, hx + h * .4, hy + h * .5], outline=BLUE, width=6)
    draw.polygon([(hx + h * .12, hy - h * .1), (hx + h * .42, hy + h * .1), (hx + h * .12, hy + h * .5)], fill=(240, 190, 190))
    for foot in ('rf', 'lf'):
        fx, fy = joints[foot]
        draw.polygon([(fx, fy), (fx + 50 * k, fy), (fx + 50 * k, fy - 12 * k), (fx, fy - 12 * k)], fill=BLUE)
    staff(draw, at(spec['butt']), spec['angle'], k)
    for hand, colour in (('rh', (220, 40, 40)), ('lh', (230, 120, 40))):
        hx, hy = joints[hand]
        draw.ellipse([hx - 12, hy - 12, hx + 12, hy + 12], fill=colour)
    draw.line([(0, GROUND), (1536, GROUND)], fill=(200, 200, 200), width=2)
    image.save(out)


def main():
    (HERE / 'inputs').mkdir(exist_ok=True)
    for scale, x, name in ((2.0, 380, 's20'), (1.5, 300, 's15')):
        layout(scale, x, HERE / f'inputs/layout-{name}.png')
    for pose, spec in json.loads((HERE / 'guides.json').read_text()).items():
        guide(pose, spec, HERE / f'inputs/guide-{pose}.png')


if __name__ == '__main__':
    main()
