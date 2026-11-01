#!/usr/bin/env python3
"""Preserve line wrapping in unchanged, whole-line rules blocks across card upgrades.

Requires Tesseract with English data and Pillow; writing skin faces also needs NumPy.
Run without --write to audit, or with --write to normalize the paired asset tiers.
"""
import argparse
import csv
import difflib
import hashlib
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import shutil
import subprocess
import sys

from PIL import Image, ImageChops


def recognize(path, cache):
    key = hashlib.sha256(b'upgrade-layout-v1' + path.read_bytes()).hexdigest()
    if key in cache:
        return cache[key]
    with Image.open(path) as original:
        image = original.convert('RGB').resize((744, 1039), Image.Resampling.LANCZOS)
    left, top, right, bottom = (78, 603, 666, 962)
    image = image.crop((left, top, right, bottom))
    red, green, blue = image.split()
    image = ImageChops.lighter(ImageChops.lighter(red, green), blue).point(lambda value: 0 if value > 170 else 255)
    image = image.resize((image.width * 2, image.height * 2))
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    result = subprocess.run(['tesseract', 'stdin', 'stdout', '-l', 'eng', '--psm', '6', 'tsv'],
                            input=buffer.getvalue(), capture_output=True,
                            env={**os.environ, 'OMP_THREAD_LIMIT': '1'}, check=True)
    words = []
    for row in csv.DictReader(io.StringIO(result.stdout.decode()), delimiter='\t', quoting=csv.QUOTE_NONE):
        text = row['text'].strip()
        token = re.sub(r'[^a-z0-9+]', '', text.lower())
        if row['level'] != '5' or not token:
            continue
        words.append({
            'text': text, 'token': token, 'confidence': float(row['conf']),
            'line': '/'.join(row[field] for field in ['block_num', 'par_num', 'line_num']),
            'box': [int(row['left']) / 2 + left, int(row['top']) / 2 + top,
                    (int(row['left']) + int(row['width'])) / 2 + left,
                    (int(row['top']) + int(row['height'])) / 2 + top],
        })
    cache[key] = words
    return words


def line_words(words):
    lines = []
    previous = None
    for word in words:
        if previous != word['line']:
            lines.append([])
            previous = word['line']
        lines[-1].append(word['token'])
    return lines


def bounds(words):
    return [min(word['box'][0] for word in words), min(word['box'][1] for word in words),
            max(word['box'][2] for word in words), max(word['box'][3] for word in words)]


def lines_with_offsets(words):
    lines = []
    position = 0
    for word in words:
        if not lines or lines[-1]['id'] != word['line']:
            lines.append({'id': word['line'], 'start': position, 'words': []})
        lines[-1]['words'].append(word)
        position += len(word['token'])
        lines[-1]['end'] = position
    return lines


def reflow_blocks(before, after):
    candidates = []
    source_rows = lines_with_offsets(before)
    target_rows = lines_with_offsets(after)
    matches = difflib.SequenceMatcher(None, ''.join(word['token'] for word in before),
                                    ''.join(word['token'] for word in after), autojunk=False)
    for start, target, count in matches.get_matching_blocks():
        if count < 16:
            continue
        offset = target - start
        starts = [line['start'] for line in source_rows if line['start'] >= start and
                  any(other['start'] == line['start'] + offset for other in target_rows)]
        ends = [line['end'] for line in source_rows if line['end'] <= start + count and
                line['words'][-1]['text'].endswith(('.', ':')) and
                any(other['end'] == line['end'] + offset for other in target_rows)]
        if not starts or not ends or max(ends) - min(starts) < 16:
            continue
        beginning, ending = min(starts), max(ends)
        source_words = [word for line in source_rows if line['start'] >= beginning and line['end'] <= ending
                        for word in line['words']]
        target_words = [word for line in target_rows if line['start'] >= beginning + offset and line['end'] <= ending + offset
                        for word in line['words']]
        source_lines = line_words(source_words)
        target_lines = line_words(target_words)
        if [''.join(line) for line in source_lines] == [''.join(line) for line in target_lines]:
            continue
        candidates.append({
            'text': ' '.join(word['token'] for word in source_words),
            'before': source_lines, 'after': target_lines,
            'sourceBox': bounds(source_words), 'targetBox': bounds(target_words),
            'confidence': min(word['confidence'] for word in source_words + target_words),
        })
    return candidates


def audit(base, upgraded, cache):
    before = recognize(base, cache)
    after = recognize(upgraded, cache)
    return {'base': str(base), 'upgraded': str(upgraded),
            'sourceText': ' '.join(word['text'] for word in before),
            'targetText': ' '.join(word['text'] for word in after), 'candidates': reflow_blocks(before, after)}


def expanded(box, padding=10):
    return [box[0] - padding, box[1] - padding, box[2] + padding, box[3] + padding]


def intersects(left, right):
    return left[0] < right[2] and left[2] > right[0] and left[1] < right[3] and left[3] > right[1]


def safe_margin(box, words):
    rectangle = expanded(box)
    for word in words:
        other = word['box']
        if intersects(other, box) or not intersects(other, rectangle):
            continue
        if other[3] <= box[1]:
            rectangle[1] = max(rectangle[1], (other[3] + box[1]) / 2)
        elif other[1] >= box[3]:
            rectangle[3] = min(rectangle[3], (other[1] + box[3]) / 2)
        elif other[2] <= box[0]:
            rectangle[0] = max(rectangle[0], (other[2] + box[0]) / 2)
        elif other[0] >= box[2]:
            rectangle[2] = min(rectangle[2], (other[0] + box[2]) / 2)
    return rectangle


def plan_patch(candidate, before, after):
    # A shorter layout fits both existing text slots without shrinking its type.
    canonical = 0 if len(candidate['before']) <= len(candidate['after']) else 1
    source_box = candidate['sourceBox' if canonical == 0 else 'targetBox']
    target_box = candidate['targetBox' if canonical == 0 else 'sourceBox']
    dy = target_box[1] - source_box[1]
    source_words, target_words = (before, after) if canonical == 0 else (after, before)
    source = safe_margin(source_box, source_words)
    destination = [source[0], source[1] + dy, source[2], source[3] + dy]
    clearing = [safe_margin(target_box, target_words)]
    outside_source = [word for word in source_words if not intersects(word['box'], source_box)]
    outside_target = [word for word in target_words if not intersects(word['box'], target_box)]
    if any(intersects(source, word['box']) for word in outside_source):
        raise ValueError('Canonical text crop would include another rule')
    if any(intersects(rect, word['box']) for rect in [destination, *clearing] for word in outside_target):
        raise ValueError('Text correction would cover a changed rule')
    if any(rect[0] < 78 or rect[1] < 597 or rect[2] > 672 or rect[3] > 968
           for rect in [source, destination, *clearing]):
        raise ValueError('Text correction would leave the rules panel')
    return {'canonical': canonical, 'source': source, 'destination': destination, 'clear': clearing,
            'text': candidate['text']}


def scaled(box, size):
    return tuple(round(value * (size[0] / 744 if index % 2 == 0 else size[1] / 1039))
                 for index, value in enumerate(box))


def apply_patch(images, patch):
    canonical = patch['canonical']
    original = images[1 - canonical]
    output = original.copy()
    for band in patch['clear']:
        left, top, right, bottom = scaled(band, original.size)
        # The whole unchanged block is cleared together: sampling between its lines
        # could pick up a descender and stretch it into the replacement background.
        edges = Image.new('RGBA', (right - left, 2))
        edges.paste(original.crop((left, top, right, top + 1)), (0, 0))
        edges.paste(original.crop((left, bottom - 1, right, bottom)), (0, 1))
        output.paste(edges.resize((right - left, bottom - top), Image.Resampling.BILINEAR), (left, top))
    source = images[canonical].crop(scaled(patch['source'], images[canonical].size))
    destination = scaled(patch['destination'], original.size)
    source = source.resize((destination[2] - destination[0], destination[3] - destination[1]), Image.Resampling.LANCZOS)
    output.paste(source, destination)
    images[1 - canonical] = output


def write_pair(base, upgraded, patches, thumbnail_root):
    paths = [base, upgraded]
    images = []
    for path in paths:
        with Image.open(path) as image:
            images.append(image.convert('RGBA'))
    if images[0].size != images[1].size:
        raise ValueError(f'Card faces must have matching dimensions: {base}')
    for patch in patches:
        apply_patch(images, patch)
    changed = sorted({1 - patch['canonical'] for patch in patches})
    for index in changed:
        path = paths[index]
        quality = 82 if images[index].width <= 320 else 74
        thumbnail = thumbnail_root / path.name
        if not thumbnail.exists():
            raise ValueError(f'Missing thumbnail: {thumbnail}')
        images[index].save(path, 'WEBP', quality=quality, method=6)
        if images[index].width <= 448:
            shutil.copyfile(path, thumbnail)
        else:
            height = round(images[index].height * 448 / images[index].width)
            images[index].resize((448, height), Image.Resampling.LANCZOS).save(thumbnail, 'WEBP', quality=quality, method=6)


def prepare_skin_faces(base, skin, manifests):
    sys.path.insert(0, str(Path(__file__).parent / 'skin-cards'))
    from skincards import ROOT, SKIN_OWNERS, load_catalogue, scan_key

    manifest_path = ROOT / 'docs' / 'skins' / f'{skin.name}-card-art' / 'manifest.json'
    if manifest_path not in manifests:
        manifests[manifest_path] = json.loads(manifest_path.read_text())
    manifest = manifests[manifest_path]
    card = next(card for card in load_catalogue(SKIN_OWNERS[skin.name]) if scan_key(card, False) == base.stem)
    entry = next(entry for entry in manifest['cards'] if entry['id'] == card['id'])
    with Image.open(ROOT / entry['source']['path']) as source:
        art = source.convert('RGB')
        if 'crop' in entry:
            art = art.crop(entry['crop'])
    return manifest_path, manifest, card, art


def refresh_skin_faces(base, upgraded, patches, skin, prepared):
    # Reuse the skin's original compositor and artwork instead of recompressing its art.
    import numpy as np
    from skincards import ROOT, composite, window_alpha

    manifest_path, manifest, card, art = prepared
    changed = sorted({1 - patch['canonical'] for patch in patches})
    for index in changed:
        filename = (base if index == 0 else upgraded).name
        for original_root, target_root in [('cards', 'skin-cards'), ('cards-sm', 'skin-cards-sm')]:
            original_path = base.parent.parent / original_root / filename
            output_path = base.parent.parent / target_root / skin.name / filename
            with Image.open(original_path) as image:
                original = image.convert('RGB')
            painted = composite(original, art, card, bool(index))
            painted.save(output_path, 'WEBP', quality=90, method=6)
            for face in manifest.get('faces', []):
                if face['output']['path'] != str(output_path.relative_to(ROOT)):
                    continue
                face['original']['sha256'] = hashlib.sha256(original_path.read_bytes()).hexdigest()
                face['output']['sha256'] = hashlib.sha256(output_path.read_bytes()).hexdigest()
                outside = window_alpha(card, bool(index), original.size) == 0
                if not np.array_equal(np.asarray(painted)[outside], np.asarray(original)[outside]):
                    raise ValueError(f'Skin compositor changed protected pixels: {output_path}')
                with Image.open(output_path) as image:
                    difference = np.asarray(image.convert('RGB'))[outside].astype(float) - np.asarray(original)[outside].astype(float)
                face['preencodeOutsideMaskMaxDiff'] = 0
                face['postencodeOutsideMaskRMS'] = float(np.sqrt(np.mean(difference ** 2)))
                face['postencodeOutsideMaskMaxDiff'] = int(np.max(np.abs(difference)))
    if 'faces' in manifest:
        manifest_path.write_text(json.dumps(manifest, indent=1) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default='public/assets/cards')
    parser.add_argument('--match', default='')
    parser.add_argument('--key', action='append', default=[])
    parser.add_argument('--cache', type=Path, default=Path('artifacts/card-upgrade-layout/ocr.json'))
    parser.add_argument('--report', type=Path, default=Path('artifacts/card-upgrade-layout/audit.json'))
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    cache = json.loads(args.cache.read_text()) if args.cache.exists() else {}
    pairs = [(upgraded.with_name(upgraded.stem[:-1] + upgraded.suffix), upgraded)
             for upgraded in sorted(Path(args.directory).glob('*+.webp')) if args.match in upgraded.name and
             (not args.key or upgraded.stem[:-1] in args.key)]
    if not pairs:
        raise SystemExit('No upgrade pairs found')
    for base, upgraded in pairs:
        if not base.exists():
            raise SystemExit(f'Missing base face for {upgraded}')
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda pair: audit(*pair, cache), pairs))
    args.cache.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.cache.write_text(json.dumps(cache))
    affected = [result for result in results if result['candidates']]
    corrections = []
    work = []
    manifests = {}
    for result in affected:
        base, upgraded = Path(result['base']), Path(result['upgraded'])
        patches = [plan_patch(candidate, recognize(base, cache), recognize(upgraded, cache))
                   for candidate in result['candidates']]
        corrections.append({'key': base.stem, 'patches': patches})
        skins = []
        if args.write:
            skin_root = base.parent.parent / 'skin-cards'
            for skin in sorted(skin_root.iterdir()) if skin_root.exists() else []:
                skin_base, skin_upgraded = skin / base.name, skin / upgraded.name
                if skin_base.exists() or skin_upgraded.exists():
                    if not skin_base.exists() or not skin_upgraded.exists():
                        raise ValueError(f'Incomplete skin pair: {skin_base}')
                    skins.append((skin.resolve(), prepare_skin_faces(base.resolve(), skin.resolve(), manifests)))
        work.append((base, upgraded, patches, skins))
    # Resolve all crop guards and skin inputs before changing any default face.
    if args.write:
        for base, upgraded, patches, skins in work:
            write_pair(base, upgraded, patches, base.parent.parent / 'cards-sm')
            for skin, prepared in skins:
                refresh_skin_faces(base.resolve(), upgraded.resolve(), patches, skin, prepared)
    args.report.write_text(json.dumps({'audited': [Path(result['base']).stem for result in results],
                                      'corrections': corrections}, indent=2) + '\n')
    print(f'Audited {len(results)} pairs; {len(affected)} have matching-text reflow candidates')
    for result in affected:
        print(Path(result['base']).name, ', '.join(candidate['text'] for candidate in result['candidates']))


if __name__ == '__main__':
    main()
