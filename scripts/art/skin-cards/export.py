#!/usr/bin/env python3
"""Export the selected sources: 748x420 text-free art (<= 40 KiB, the CSS fallback face) and the manifest.
No API calls. Run after `generate.py select`.

  python3 scripts/art/skin-cards/export.py [--skin kratos] [--owner ironclad]
"""
import argparse
import hashlib
import json

from PIL import Image, ImageOps

from recipes import record_ref
from skincards import HERE, MASKS, ROOT, add_skin_args, art_dir, docs_dir, load_catalogue, load_json, registration_file, resolve, skin_data


def record(path):
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def export(image, path):
    image = ImageOps.fit(image.convert('RGB'), (748, 420), method=Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    for quality in (90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30):
        image.save(path, 'WEBP', quality=quality, method=6)
        if path.stat().st_size <= 40 * 1024:
            return quality
    raise ValueError(f'{path.name}: card art exceeds 40 KiB')


def header(plan, skin, owner):
    """Model, references and (Kratos) game images of the manifest. Repo files are recorded by path and hash;
    external references (the copyrighted style frames, identity sheets) only by description and hash."""
    base = {'model': plan['model'], 'quality': plan['quality'], 'size': plan['size'], 'cardSize': [748, 420]}
    if plan.get('recordPipelineInputs'):  # the owner's catalogue, registration table and masks, hash-checked by verify-art-bakes
        base.update(catalogue=record(HERE / f'cards/{owner}.json'), registration=record(HERE / registration_file(f'{owner}__')),
                    masks=[record(path) for path in sorted((MASKS / owner).glob('*.png'))])
    if plan.get('recipe', 'kratos') == 'kratos':
        refs = {r['tag']: r for r in load_json(skin_data(skin) / 'refs.json')}
        return {**base, 'references': [record(ROOT / p) for p in [*plan['styleReferences'], plan['identityReference']]],
                'gameImages': {tag: {k: refs[tag][k] for k in ('title', 'page', 'url', 'sha256')}
                               for tag in sorted({t for c in plan['cards'].values() for t in c['refs']})}}
    return {**base, 'identityReference': record_ref(plan['identityReference'], plan['identityDescription']),
            'styleReferences': {r['tag']: record_ref(r['path'], r['description']) for r in plan['styleReferences']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_skin_args(parser)
    skin, owner = resolve(parser.parse_args())
    plan = load_json(skin_data(skin) / 'plan.json')
    selections = load_json(skin_data(skin) / 'selections.json', {})
    docs, out = docs_dir(skin), art_dir(skin, owner)
    manifest = {**header(plan, skin, owner), 'cards': []}
    for card in load_catalogue(owner):
        selection = selections.get(card['id'])
        if not selection:
            continue
        source = ROOT / selection['source']
        target = out / f"{card['id']}.webp"
        quality = export(Image.open(source), target)
        entry = plan['cards'][card['id']]
        manifest['cards'].append({'id': card['id'], 'scene': entry['scene'],
                                  **({'gameImages': entry['refs']} if 'refs' in entry else {'styleImages': entry.get('styles') or [r['tag'] for r in plan['styleReferences']]}),
                                  'candidate': selection['candidate'], 'source': record(source),
                                  **({'regeneration': selection['regeneration']} if 'regeneration' in selection else {}),
                                  'prompt': record(docs / f"prompts/{card['id']}.txt"),
                                  'output': record(target), 'webpQuality': quality})
        print(card['id'], target.stat().st_size)
    docs.mkdir(parents=True, exist_ok=True)
    (docs / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')


if __name__ == '__main__':
    main()
