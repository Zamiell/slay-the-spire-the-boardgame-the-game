"""Export the committed Rimuru Tempest noncombat artwork into the existing noncombat asset formats (no API calls)."""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/art/sources/anime_slime_boss-noncombat'
NONCOMBAT = ROOT / 'public/assets/noncombat'
SKIN = 'anime_slime_boss'
SAVE = {'quality': 88, 'method': 6}

MERCHANT_CANVAS = (400, 576)
MERCHANT_HEIGHT = 548
MERCHANT_TOP = 10  # leaves 18px (3.125%) of transparent floor under the boots, like Silent-chan

HAND_CANVAS = (384, 1024)
HAND_WRIST_X = 192  # the arm's bottom edge is centred here, so the open and gripping hand swap in place
HAND_SPLIT = 560  # the sheet holds the open hand on its left and the grip on its right; no art lies in columns 518..608


def solid_box(image):
    return image.getchannel('A').point(lambda value: 255 if value > 32 else 0).getbbox()


def export_merchant():
    figure = Image.open(SOURCES / 'merchant.webp').convert('RGBA')
    figure = figure.crop(figure.getchannel('A').getbbox())
    width = round(figure.width * MERCHANT_HEIGHT / figure.height)
    figure = figure.resize((width, MERCHANT_HEIGHT), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', MERCHANT_CANVAS, (0, 0, 0, 0))
    canvas.alpha_composite(figure, ((MERCHANT_CANVAS[0] - width) // 2, MERCHANT_TOP))
    canvas.save(NONCOMBAT / f'merchant/characters/{SKIN}-standing.webp', **SAVE)


def export_hands():
    sheet = Image.open(SOURCES / 'treasure-hands.webp').convert('RGBA')
    for index, pose in enumerate(['hand', 'grip']):
        half = sheet.crop((0, 0, HAND_SPLIT, sheet.height) if index == 0 else (HAND_SPLIT, 0, sheet.width, sheet.height))
        box = half.getchannel('A').getbbox()
        # The arm leaves the sheet's bottom row of art: crop to it so the sleeve reaches the canvas bottom.
        half = half.crop((0, 0, half.width, box[3]))
        scale = HAND_CANVAS[1] / half.height
        arm = half.resize((round(half.width * scale), HAND_CANVAS[1]), Image.Resampling.LANCZOS)
        bottom = np.asarray(arm.getchannel('A'))[-8:] > 32
        wrist = np.nonzero(bottom.any(axis=0))[0]
        canvas = Image.new('RGBA', HAND_CANVAS, (0, 0, 0, 0))
        canvas.alpha_composite(arm, (HAND_WRIST_X - (wrist[0] + wrist[-1]) // 2, 0))
        assert solid_box(canvas)[0] > 0 and solid_box(canvas)[2] < HAND_CANVAS[0], f'{pose} is clipped by the canvas'
        canvas.save(NONCOMBAT / f'treasure/{pose}-{SKIN}.webp', **SAVE)


if __name__ == '__main__':
    export_merchant()
    export_hands()
