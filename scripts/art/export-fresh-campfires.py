#!/usr/bin/env python3
"""Rebuild or check scenes generated from original empty-camp and character references."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from campfire_export import export_campfire
from campfire_references import original_references

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'docs/skins/fresh-campfires/manifest.json').read_text())
    scenes = manifest['scenes']
    assert len(scenes) == 407, f'Expected all 407 scenes, found {len(scenes)}'
    assert len({entry['scene'] for entry in scenes}) == len(scenes), 'Duplicate scene'
    references = ROOT / 'scripts/art/sources/campfire-original-references'
    for name, original in original_references():
        with Image.open(references / name) as supplied:
            assert (supplied.mode, supplied.size, supplied.tobytes()) == (
                original.mode, original.size, original.tobytes(),
            ), f'{name}: reference differs from original character/empty-camp asset'
    checked = {}
    for entry in scenes:
        assert entry['scene'] == '_'.join(entry['party']), entry['scene']
        inputs = entry['inputs']
        assert inputs[0]['path'].endswith('/empty-campfire.png'), entry['scene']
        assert len(inputs) == 1 + len(entry['party']), entry['scene']
        expected = ['empty-campfire.png', *[f'{hero}-identity.png' for hero in entry['party']]]
        assert [Path(item['path']).name for item in inputs] == expected, entry['scene']
        assert all((ROOT / item['path']).parent == references for item in inputs), entry['scene']
        for item in [*inputs, entry['prompt'], entry['source']]:
            path = ROOT / item['path']
            if path not in checked:
                assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], path
                checked[path] = item['sha256']
            assert checked[path] == item['sha256'], path
            assert path.stat().st_size == item['bytes'], path
        source = ROOT / entry['source']['path']
        assert Image.open(source).size == (3840, 2160), source
        runtime = ROOT / entry['runtime']['path']
        assert runtime == ROOT / f"public/assets/noncombat/campfire/{entry['scene']}_firecamp.webp", runtime
        if not args.check:
            export_campfire(source, runtime)
        assert hashlib.sha256(runtime.read_bytes()).hexdigest() == entry['runtime']['sha256'], runtime
        assert runtime.stat().st_size == entry['runtime']['bytes'], runtime
        assert Image.open(runtime).size == (3840, 2161), runtime
    print(f'{len(scenes)} original-input campfire sources and runtime exports verified')


if __name__ == '__main__':
    main()
