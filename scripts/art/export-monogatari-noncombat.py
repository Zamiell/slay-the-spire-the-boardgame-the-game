#!/usr/bin/env python3
"""Deterministically export approved Sunburst sources. Never calls generation API."""
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/art/sources/monogatari/noncombat'
DOCS = ROOT / 'docs/monogatari-skins'
PUBLIC = ROOT / 'public/assets'
IDS = ['ironclad', 'silent', 'defect', 'watcher', 'slime_boss', 'guardian', 'hexaghost', 'hermit',
       'kratos', 'monogatari_ironclad', 'monogatari_defect']
SKINS = {'kratos': 'ironclad', 'monogatari_ironclad': 'ironclad', 'monogatari_defect': 'defect'}
NEW = ['monogatari_ironclad', 'monogatari_defect']
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


def seated_sources():
    result = {}
    first = native(SOURCE / 'original-ironclad-silent-defect-seated.png')
    for char, box in [('ironclad', (0, 0, 550, 1024)), ('silent', (550, 0, 1030, 1024)),
                      ('defect', (1030, 0, 1536, 1024))]:
        result[char] = tight(first.crop(box))
    for char in ['watcher', 'guardian']:
        result[char] = tight(native(SOURCE / f'original-{char}-seated.png'))
    slime = native(SOURCE / 'original-watcher-slime_boss-guardian-seated-v2.png')
    result['slime_boss'] = tight(slime.crop((512, 280, 1035, 780)))
    last = native(SOURCE / 'original-hexaghost-hermit-kratos-seated.png')
    for index, char in enumerate(['hexaghost', 'hermit', 'kratos']):
        result[char] = tight(last.crop((index * 512, 0, (index + 1) * 512, 1024)))
    for char in ['ironclad', 'defect']:
        sheet = native(SOURCE / f'{char}-seated.png')
        assert sheet.size == (1536, 1024)
        result[f'monogatari_{char}'] = tight(sheet.crop((0, 0, 768, 1024)))
        result[f'monogatari_{char}-left'] = tight(sheet.crop((768, 0, 1536, 1024)))
    return result


# Each slot specifies pelvis x/y and full seated height on a 1536x864 working canvas.
# Foreground seats touch the log, background seats sit further back; fire stays unobstructed.
SLOTS = {
    1: [(455, 596, 335, False)],
    2: [(455, 596, 335, False), (1110, 596, 335, True)],
    3: [(575, 550, 310, False), (1110, 596, 335, True), (380, 620, 335, False)],
    4: [(575, 550, 310, False), (1035, 550, 310, True), (380, 620, 335, False), (1215, 620, 335, True)],
}


def compose(party, sources, background):
    canvas = background.copy()
    for visual, (cx, pelvis, height, left) in sorted(zip(party, SLOTS[len(party)]), key=lambda entry: entry[1][1]):
        if left and visual in NEW:
            cutout = sources[f'{visual}-left']
        else:
            cutout = ImageOps.mirror(sources[visual]) if left else sources[visual]
        if visual == 'slime_boss':
            height = round(height * .61)
        cutout = cutout.resize((round(cutout.width * height / cutout.height), height), RESAMPLE)
        # Humanoid hip is 56% down the seated silhouette; floating/gelatinous heroes have no hip.
        hip = .56 if visual != 'slime_boss' else .88
        x, y = round(cx - cutout.width / 2), round(pelvis - height * hip)
        assert x >= 0 and y >= 0 and x + cutout.width <= 1536 and y + height <= 864, (party, visual, x, y)
        canvas.alpha_composite(cutout, (x, y))
    return canvas.convert('RGB')


def parties():
    return [party for size in range(1, 5) for party in combinations(IDS, size)
            if any(visual in NEW for visual in party)
            and not any(base in party for skin, base in SKINS.items() if skin in party)]


def main():
    other = [item for char in ['ironclad', 'defect'] for item in export_person(char)]
    sources = seated_sources()
    background_path = PUBLIC / 'noncombat/campfire/empty_firecamp.webp'
    background = Image.open(background_path).convert('RGBA').resize((1536, 864), RESAMPLE)
    selected = parties()
    assert len(selected) == 208 and all(1 <= len(p) <= 4 for p in selected)

    def export(party):
        scene = compose(party, sources, background).resize((3840, 2161), RESAMPLE)
        path = PUBLIC / 'noncombat/campfire' / f'{"_".join(party)}_firecamp.webp'
        return {'party': list(party), 'output': save(scene, path, 50)}

    with ThreadPoolExecutor(max_workers=4) as pool:
        scenes = list(pool.map(export, selected))
    preview_parties = [('monogatari_ironclad',), ('monogatari_defect',), tuple(NEW),
                       ('defect', 'monogatari_ironclad'), ('ironclad', 'monogatari_defect'),
                       ('silent', *NEW), ('silent', 'watcher', *NEW), ('guardian', 'kratos', *NEW),
                       ('slime_boss', 'hexaghost', *NEW), ('hermit', 'kratos', *NEW),
                       ('kratos', 'monogatari_ironclad'), ('defect', 'guardian', 'monogatari_ironclad')]
    contact = Image.new('RGB', (1536, 4 * 325), '#181818')
    draw = ImageDraw.Draw(contact)
    for index, party in enumerate(preview_parties):
        preview = compose(party, sources, background).resize((512, 288), RESAMPLE)
        x, y = (index % 3) * 512, (index // 3) * 325
        contact.paste(preview, (x, y + 30))
        draw.text((x + 8, y + 8), ' + '.join(party).replace('monogatari_', 'anime_'), fill='white')
    audit = DOCS / 'noncombat-contact-sheet.jpg'
    contact.save(audit, quality=94)
    manifest = {'model': 'gpt-image-2.5-sunburst', 'quality': 'high', 'nativeAlphaPreserved': True,
                'rebuild': 'python3 scripts/art/export-monogatari-noncombat.py',
                'generation': 'Bundled imagegen skill CLI edit with persisted prompts and supplied references',
                'sources': [record(p) for p in sorted(SOURCE.glob('*.png'))],
                'prompts': [record(p) for p in sorted((DOCS / 'prompts/noncombat').glob('*.txt'))],
                'references': [record(ROOT / path) for path in [
                    'scripts/art/sources/monogatari/ironclad-idle-grip-repaired.png',
                    'scripts/art/sources/monogatari/defect-design-draft.png',
                    'scripts/animation/sources/monogatari/defect-idle.png',
                    *[f'public/assets/noncombat/campfire/{visual}_firecamp.webp' for visual in IDS[:9]],
                    *[f'public/assets/noncombat/merchant/characters/{char}-standing.webp' for char in ['ironclad', 'defect']],
                    *[f'public/assets/noncombat/treasure/hand-{char}.webp' for char in ['ironclad', 'defect']],
                    *[f'public/assets/menu/character-select/character-{char}-wallpaper.webp' for char in ['ironclad', 'defect']],
                    'scripts/art/sources/monogatari/noncombat/original-ironclad-silent-defect-reference.jpg',
                    'scripts/art/sources/monogatari/noncombat/original-hexaghost-hermit-kratos-reference.jpg']],
                'styleReferences': json.loads((DOCS / 'noncombat-style-references.json').read_text()),
                'background': record(background_path), 'seating': SLOTS,
                'treasureGripCrop': {'sourceStripExcluded': [0, 0, 32, 1536],
                                    'mainSilhouettePreserved': True, 'nativeAlphaPreserved': True},
                'otherAssets': other, 'campfireScenes': scenes, 'visualAudit': record(audit)}
    (DOCS / 'noncombat-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    sizes = [s['output']['bytes'] for s in scenes]
    print(f'Exported {len(other)} other assets and {len(scenes)} campfire scenes; mean={sum(sizes)//len(sizes)}, max={max(sizes)}, total={sum(sizes)} bytes')


if __name__ == '__main__':
    main()
