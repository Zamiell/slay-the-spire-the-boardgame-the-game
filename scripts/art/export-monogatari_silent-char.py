#!/usr/bin/env python3
"""Export the monogatari_silent skin's character art from the committed model sources; no API calls are made here.

Writes the combat idle cutout and list icon, the Energy orb, the attack VFX, the character-select portrait and
wallpaper, the idle registration JSON and refreshes the hashes in docs/skins/monogatari_silent-art/manifest.json
(needs Pillow and numpy).
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/art/sources/monogatari_silent-char'
DOCS = ROOT / 'docs/skins/monogatari_silent-art'
ASSETS = ROOT / 'public/assets'
SKIN = 'monogatari_silent'

# Landmarks of idle-cutout.webp (1024x1536), measured on the approved idle: hood top, crown of the hair under the hood,
# chin, lowest (near) sole, the two boots' sole centres, near/far dagger tips.
SRC_HOOD_TOP, SRC_CROWN, SRC_CHIN = 12, 87, 253
SRC_NEAR_SOLE_X, SRC_FAR_SOLE_X = 370, 820
SRC_CROWN_X, SRC_CHIN_X = 620, 570
CROWN_TO_SOLE = 830  # px on the 1152 canvas, about 0.72 stage-actor widths, the same as the monogatari_watcher skin
CANVAS, GROUND_Y, STANCE_X = 1152, 1115, 576  # Kratos' hero canvas, its ground line and the stance centre
# Energy orb: the window around the jade core (core centre ~(480, 458), ring bbox 58..1007 x 30..948 in the source).
ORB_CENTER, ORB_HALF = (500, 470), 520


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def resize(image, size):
    """Lanczos on premultiplied colour, so transparent pixels never bleed a halo into the edge."""
    data = np.asarray(image.convert('RGBA')).astype(np.float32)
    alpha = data[..., 3:] / 255
    premultiplied = np.dstack([data[..., :3] * alpha, data[..., 3:]])
    channels = [np.asarray(Image.fromarray(premultiplied[..., i]).resize(size, Image.LANCZOS)) for i in range(4)]
    out = np.dstack(channels)
    safe = np.clip(out[..., 3:] / 255, 1e-6, 1)
    rgb = np.clip(out[..., :3] / safe, 0, 255)
    rgb[out[..., 3] < 1] = 0
    return Image.fromarray(np.dstack([rgb, out[..., 3:]]).clip(0, 255).astype(np.uint8), 'RGBA')


def painted_box(image, threshold=96):
    ys, xs = np.where(np.asarray(image)[..., 3] > threshold)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def save_webp(image, path, **kwargs):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'WEBP', quality=92, alpha_quality=100, method=6, **kwargs)


def export_idle():
    cutout = Image.open(SOURCE / 'idle-cutout.webp').convert('RGBA')
    sole = painted_box(cutout)[3]
    scale = CROWN_TO_SOLE / (sole - SRC_CROWN)
    stance_src = (SRC_NEAR_SOLE_X + SRC_FAR_SOLE_X) / 2
    figure = resize(cutout, (round(cutout.width * scale), round(cutout.height * scale)))
    origin = (round(STANCE_X - stance_src * scale), round(GROUND_Y - sole * scale))
    hero = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    hero.alpha_composite(figure, origin)
    save_webp(hero, ASSETS / f'combat/characters/{SKIN}-hero.webp')
    hero = Image.open(ASSETS / f'combat/characters/{SKIN}-hero.webp')
    x0, y0, x1, y1 = painted_box(hero)
    # The list icon is the whole figure, bottom aligned like kratos.webp.
    crop = hero.crop((x0, y0, x1 + 1, y1 + 1))
    height = 500
    icon_figure = resize(crop, (round(crop.width * height / crop.height), height))
    icon = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    icon.alpha_composite(icon_figure, ((512 - icon_figure.width) // 2, 512 - 6 - height))
    save_webp(icon, ASSETS / f'combat/characters/{SKIN}.webp')
    return scale, sole, origin, hero


def export_registration(scale, sole, origin, hero):
    def at(x, y):
        return [round(origin[0] + x * scale, 1), round(origin[1] + y * scale, 1)]

    data = np.asarray(hero)
    painted = data[..., 3] > 96
    box = painted_box(hero)
    bottom = np.where(painted[box[3]])[0]
    # Lowest painted row of each boot: the near boot is the lower one, the far boot rests higher (low camera angle).
    stance = round(STANCE_X)
    far = painted[:, stance:].copy()
    far[:int(origin[1] + 1300 * scale)] = False
    far_y, far_x = np.where(far)
    registration = {
        'note': 'monogatari_silent idle registered on the 1152x1152 hero canvas (x right, y down, canvas pixels). '
                'hoodTop is the highest painted row (the hood tip); crown is the top of the hair mass under the hood '
                'and chin the tip of the chin, so headPixels is crown to chin and hoodPixels hood top to chin. nearSole is '
                'the lowest painted row of the lower (camera-side) boot and is planted on groundY; farSole is the lowest '
                'row of the other boot, which stands higher because of the low camera angle. The cutout source '
                '(idle-cutout.webp, 1024x1536) is scaled by `scale`, crown to near sole is 830px and the stance centre '
                '(midpoint of the two sole centres) is on stanceCenterX. Landmarks marked source are mapped from hand-measured '
                'source rows through the same scale and offset.',
        'canvas': [CANVAS, CANVAS],
        'scale': round(scale, 6),
        'offset': list(origin),
        'sourceLandmarks': {'hoodTopY': SRC_HOOD_TOP, 'crownY': SRC_CROWN, 'chinY': SRC_CHIN, 'nearSoleY': sole,
                            'nearSoleX': SRC_NEAR_SOLE_X, 'farSoleX': SRC_FAR_SOLE_X},
        'groundY': GROUND_Y,
        'stanceCenterX': STANCE_X,
        'headPixels': round((SRC_CHIN - SRC_CROWN) * scale, 1),
        'hoodPixels': round((SRC_CHIN - SRC_HOOD_TOP) * scale, 1),
        'heightPixels': CROWN_TO_SOLE,
        'poses': {'idle': {
            'source': 'scripts/art/sources/monogatari_silent-char/idle-cutout.webp',
            'hoodTop': [int(np.where(painted[box[1]])[0].mean()), box[1]],
            'crown': at(SRC_CROWN_X, SRC_CROWN),
            'chin': at(SRC_CHIN_X, SRC_CHIN),
            'nearSole': [int(bottom.mean()), box[3]],
            'farSole': [int(far_x.mean()) + stance, int(far_y.max())],
            'bodyBox': list(box),
        }},
    }
    out = ROOT / 'scripts/animation/sources/monogatari_silent/registration.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(registration, indent=2) + '\n')
    return out


def export_orb():
    source = Image.open(SOURCE / 'energy-orb.webp').convert('RGBA')
    cx, cy = ORB_CENTER
    window = source.crop((cx - ORB_HALF, cy - ORB_HALF, cx + ORB_HALF, cy + ORB_HALF))
    save_webp(resize(window, (256, 256)), ASSETS / f'combat/energy-orbs/{SKIN}.webp')


def export_vfx():
    for name in ('light', 'impact'):
        source = Image.open(SOURCE / f'vfx-{name}.webp').convert('RGBA')
        save_webp(resize(source, (512, 512)), ASSETS / f'combat/vfx/actions/{SKIN}/{name}.webp')


def export_menu():
    portrait = Image.open(SOURCE / 'portrait.webp').convert('RGB').resize((256, 384), Image.LANCZOS)
    portrait.save(ASSETS / f'menu/character-select/portrait-{SKIN}.png', optimize=True)
    # The start menu dims its left side for the copy, so the art is mirrored to put the heroine on the right like the
    # other wallpapers, and only the bottom is cropped (the hood stays whole).
    wallpaper = Image.open(SOURCE / 'wallpaper.webp').convert('RGB').transpose(Image.FLIP_LEFT_RIGHT).crop((0, 0, 1536, 864))
    wallpaper.save(ASSETS / f'menu/character-select/character-{SKIN}-wallpaper.webp', 'WEBP', quality=90, method=6)


def main():
    scale, sole, origin, hero = export_idle()
    registration = export_registration(scale, sole, origin, hero)
    export_orb()
    export_vfx()
    export_menu()
    manifest_path = DOCS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    outputs = {}
    for entry in manifest['assets']:
        entry['output']['sha256'] = sha(ROOT / entry['output']['path'])
        entry['source']['sha256'] = sha(ROOT / entry['source']['path'])
        outputs[entry['output']['path']] = entry['output']['sha256']
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {len(outputs)} assets and {registration.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
