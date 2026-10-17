#!/usr/bin/env python3
"""Deterministically export approved Sunburst sources. Never calls generation API."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/art/sources/monogatari/noncombat'
DOCS = ROOT / 'docs/monogatari-skins'
PUBLIC = ROOT / 'public/assets'
RESAMPLE = Image.Resampling.LANCZOS


def record(path):
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'bytes': path.stat().st_size}


def native(path):
    image = Image.open(path)
    assert image.mode == 'RGBA', (path, image.mode)
    assert image.getchannel('A').getextrema()[0] == 0, f'{path}: no native transparent pixels'
    return image


def tight(image):
    # Bounds use opaque body pixels so model-produced near-transparent fringe never changes scale.
    box = image.getchannel('A').point(lambda p: 255 if p >= 32 else 0).getbbox()
    assert box, 'Empty cutout'
    return image.crop((max(0, box[0] - 4), max(0, box[1] - 4), min(image.width, box[2] + 4),
                       min(image.height, box[3] + 4)))


def save(image, path, quality=88):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.tmp')
    if path.suffix == '.png':
        image.save(temporary, 'PNG', optimize=True)
    else:
        image.save(temporary, 'WEBP', quality=quality, method=6)
    temporary.replace(path)
    return record(path)


def solid_components(image):
    """Fail export if adjacent sheet art left a disconnected solid fragment."""
    width, height = image.size
    pixels = bytearray(1 if value >= 32 else 0 for value in image.getchannel('A').tobytes())
    components = 0
    for index in range(len(pixels)):
        if not pixels[index]:
            continue
        pixels[index] = 0
        pending, area = [index], 0
        while pending:
            current = pending.pop()
            area += 1
            x, y = current % width, current // width
            neighbors = [current - 1 if x else -1, current + 1 if x + 1 < width else -1,
                         current - width if y else -1, current + width if y + 1 < height else -1]
            for neighbor in neighbors:
                if neighbor >= 0 and pixels[neighbor]:
                    pixels[neighbor] = 0
                    pending.append(neighbor)
        if area > 16:
            components += 1
    return components


def export_person(character):
    skin = f'monogatari_{character}'
    sheet = native(SOURCE / f'{character}-cutouts.png')
    assert sheet.size == (1024, 1024)
    portrait = sheet.crop((0, 0, 512, 512))
    # Crop the bust like the original tall portraits; never crop the face or mask horns.
    portrait = ImageOps.fit(portrait, (256, 384), RESAMPLE, centering=(.58, .5))
    canvas = Image.new('RGB', (256, 384), '#18212b' if character == 'defect' else '#26191f')
    canvas.paste(portrait, (0, 0), portrait.getchannel('A'))
    outputs = [save(canvas, PUBLIC / f'menu/character-select/portrait-{skin}.png')]
    wallpaper = Image.open(SOURCE / f'{character}-wallpaper.png').convert('RGB')
    assert wallpaper.size == (1536, 1024)
    outputs.append(save(wallpaper.crop((0, 0, 1536, 864)),
                        PUBLIC / f'menu/character-select/character-{skin}-wallpaper.webp', 90))
    merchant = tight(native(SOURCE / f'{character}-merchant.png'))
    merchant = merchant.resize((round(merchant.width * 576 / merchant.height), 576), RESAMPLE)
    assert max(merchant.size) <= 576
    outputs.append(save(merchant, PUBLIC / f'noncombat/merchant/characters/{skin}-standing.webp'))
    hands = native(SOURCE / f'{character}-treasure.png')
    assert hands.size == (1024, 1536)
    for index, pose in enumerate(['hand', 'grip']):
        hand = hands.crop((index * 512, 0, (index + 1) * 512, 1536))
        if pose == 'grip':
            # Leftmost strip belongs to the neighboring sheet pose; actual grip starts >=80px.
            cropped = hand.crop((32, 0, 512, 1536))
            hand = Image.new('RGBA', (512, 1536))
            hand.paste(cropped, (32, 0))
        hand = hand.resize((384, 1024), RESAMPLE)
        assert solid_components(hand) == 1, f'{skin} {pose}: disconnected hand/forearm fragments'
        outputs.append(save(hand, PUBLIC / f'noncombat/treasure/{pose}-{skin}.webp'))
    return outputs


def main():
    other = [item for char in ['ironclad', 'defect'] for item in export_person(char)]
    manifest = {'model': 'gpt-image-2.5-sunburst', 'quality': 'high', 'nativeAlphaPreserved': True,
                'rebuild': 'python3 scripts/art/export-monogatari-noncombat.py',
                'generation': 'Bundled imagegen skill CLI edit with persisted prompts and supplied references',
                'sources': [record(p) for p in sorted(SOURCE.glob('*.png'))],
                'prompts': [record(p) for p in sorted((DOCS / 'prompts/noncombat').glob('*.txt'))],
                'references': [record(ROOT / path) for path in [
                    'scripts/art/sources/monogatari/ironclad-idle-grip-repaired.png',
                    'scripts/art/sources/monogatari/defect-design-draft.png',
                    'scripts/animation/sources/monogatari/defect-idle.png',
                    *[f'public/assets/noncombat/merchant/characters/{char}-standing.webp' for char in ['ironclad', 'defect']],
                    *[f'public/assets/noncombat/treasure/hand-{char}.webp' for char in ['ironclad', 'defect']],
                    *[f'public/assets/menu/character-select/character-{char}-wallpaper.webp' for char in ['ironclad', 'defect']]]],
                'styleReferences': json.loads((DOCS / 'noncombat-style-references.json').read_text()),
                'treasureGripCrop': {'sourceStripExcluded': [0, 0, 32, 1536],
                                    'mainSilhouettePreserved': True, 'nativeAlphaPreserved': True},
                'otherAssets': other}
    (DOCS / 'noncombat-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {len(other)} menu, merchant and treasure assets')


if __name__ == '__main__':
    main()
