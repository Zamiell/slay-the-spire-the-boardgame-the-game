#!/usr/bin/env python3
"""Export the monogatari_watcher skin's character art from the committed model sources; no API calls are made here.

Writes the combat idle cutout and list icon, the Energy orb, the attack VFX, the character-select portrait and
wallpaper, the idle registration JSON and docs/skins/monogatari_watcher-art/manifest.json (needs Pillow and numpy).
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/art/sources/monogatari_watcher-char'
DOCS = ROOT / 'docs/skins/monogatari_watcher-art'
ASSETS = ROOT / 'public/assets'
SKIN = 'monogatari_watcher'

# Landmarks of idle-cutout.webp (1024x1536), measured on the approved idle: crown of the hair, chin, staff tip, front sole.
SRC_CROWN, SRC_CHIN, SRC_TIP, SRC_SOLE, SRC_STAFF_BUTT, SRC_BODY_X = 58, 244, 23, 1507, 1470, 520
HEAD_TO_SOLE = 830  # px on the 1152 canvas: about 0.72 stage-actor widths, between Ironclad (0.63) and the default Watcher (0.89)
CANVAS, GROUND_Y, STANCE_X = 1152, 1115, 576  # Kratos' hero canvas and its ground line (bottom of the soles at 1115)


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
    scale = HEAD_TO_SOLE / (SRC_SOLE - SRC_CROWN)
    figure = resize(cutout, (round(cutout.width * scale), round(cutout.height * scale)))
    hero = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    hero.alpha_composite(figure, (round(STANCE_X - SRC_BODY_X * scale), round(GROUND_Y - SRC_SOLE * scale)))
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
    return scale, hero


def export_registration(scale, hero):
    data = np.asarray(hero).astype(int)
    painted = data[..., 3] > 96
    hair = (data[..., 0] < 90) & (data[..., 1] < 80) & (data[..., 2] > 70) & painted
    hair_y, hair_x = np.where(hair[:420])
    gold = (data[..., 0] > 180) & (data[..., 1] > 130) & (data[..., 2] < 110) & painted
    gold_y, gold_x = np.where(gold)
    shaft = gold_x < 480
    box = painted_box(hero)
    registration = {
        'note': 'monogatari_watcher idle registered on the 1152x1152 hero canvas (x right, y down, canvas pixels). '
                'crown = top of the hair mass, not the hairpin; headBox is the hair mass above the shoulders; '
                'staffTip/staffButt are the gold shaft extremes; frontSole/rearSole are the lowest painted row of each '
                'bare foot. The cutout source (idle-cutout.webp, 1024x1536) is scaled by `scale` and planted so the '
                'front sole lands on groundY and the stance centre on stanceCenterX. headPixels is crown to chin.',
        'canvas': [CANVAS, CANVAS],
        'scale': round(scale, 6),
        'sourceLandmarks': {'crownY': SRC_CROWN, 'staffTipY': SRC_TIP, 'frontSoleY': SRC_SOLE,
                            'staffButtY': SRC_STAFF_BUTT, 'bodyX': SRC_BODY_X},
        'groundY': GROUND_Y,
        'stanceCenterX': STANCE_X,
        'headPixels': round((SRC_CHIN - SRC_CROWN) * scale, 1),
        'heightPixels': HEAD_TO_SOLE,
        'poses': {'idle': {
            'source': 'scripts/art/sources/monogatari_watcher-char/idle-cutout.webp',
            'crown': [round(float(hair_x[hair_y < hair_y.min() + 3].mean()), 1), int(hair_y.min())],
            'headBox': [int(hair_x.min()), int(hair_y.min()), int(hair_x.max()), int(hair_y.max())],
            'staffTip': [round(float(gold_x[shaft][gold_y[shaft] == gold_y[shaft].min()].mean()), 1), int(gold_y[shaft].min())],
            'staffButt': [round(float(gold_x[gold_y == gold_y.max()].mean()), 1), int(gold_y.max())],
            'frontSole': [int(np.where(painted[box[3]])[0].mean()), box[3]],
            'bodyBox': list(box),
        }},
    }
    out = ROOT / 'scripts/animation/sources/monogatari_watcher/registration.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(registration, indent=2) + '\n')
    return out


def export_orb():
    source = Image.open(SOURCE / 'energy-orb.webp').convert('RGBA')
    x0, y0, x1, y1 = painted_box(source, 24)
    crop = source.crop((x0, y0, x1 + 1, y1 + 1))
    scale = 248 / max(crop.size)
    orb = resize(crop, (round(crop.width * scale), round(crop.height * scale)))
    canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(orb, ((256 - orb.width) // 2, (256 - orb.height) // 2))
    save_webp(canvas, ASSETS / f'combat/energy-orbs/{SKIN}.webp')


def export_vfx():
    for name in ('light', 'impact'):
        source = Image.open(SOURCE / f'vfx-{name}.webp').convert('RGBA')
        save_webp(resize(source, (512, 512)), ASSETS / f'combat/vfx/actions/{SKIN}/{name}.webp')


def export_menu():
    portrait = Image.open(SOURCE / 'portrait.webp').convert('RGB').resize((256, 384), Image.LANCZOS)
    out = ASSETS / f'menu/character-select/portrait-{SKIN}.png'
    portrait.save(out, optimize=True)
    # The wallpaper keeps the figure and the sky: crop only the bottom, like the Kratos export.
    wallpaper = Image.open(SOURCE / 'wallpaper.webp').convert('RGB').crop((0, 0, 1536, 864))
    wallpaper.save(ASSETS / f'menu/character-select/character-{SKIN}-wallpaper.webp', 'WEBP', quality=90, method=6)


def main():
    scale, hero = export_idle()
    registration = export_registration(scale, hero)
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
