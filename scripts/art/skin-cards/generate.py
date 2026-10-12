#!/usr/bin/env python3
"""Generate a skin's card illustrations with the bundled imagegen CLI (gpt-image-2.5-sunburst).

One `edit` call per card. The input images and the prompt come from the skin's recipe (recipes.py, named by
plan.json "recipe"; Kratos: style paintings, identity, God of War game images, scan, original art). Everything a
skin reads or writes is derived from --skin (see skincards.py), so skins can run in parallel.

Commands (all idempotent and resumable; existing candidates are skipped unless --force):
  run     call the API: raw PNG candidates in <work>/raw/<id>-<n>.png, prompts in docs/skins/<skin>-card-art/prompts/
  select  <id>=<n> ...  keep candidate n as the card's WebP source (<= 150 KiB, or --lossless) in scripts/art/sources/<skin>-skin-cards/

  python3 scripts/art/skin-cards/generate.py --skin kratos run --prototype            # plan.json "prototype" cards, 2 candidates each
  python3 scripts/art/skin-cards/generate.py --skin monogatari_silent run --all --candidates 1   # the mass run
  python3 scripts/art/skin-cards/generate.py --skin monogatari_silent select strike_silent=2
$STS_SKIN_ART_WORK moves the scratch folder (default artifacts/skin-art; raw candidates in work-gen[-<skin>]).
"""
import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

from PIL import Image

from recipes import RECIPES
from skincards import ROOT, add_skin_args, docs_dir, load_catalogue, load_json, resolve, skin_data, sources_dir, work_dir

CLI = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'skills/.system/imagegen/scripts/image_gen.py'
# Scratch space for reference downloads (git-ignored under artifacts/).
REFS = Path(os.environ.get('STS_SKIN_ART_WORK', ROOT / 'artifacts/skin-art')) / 'refs'
KRATOS_PROTOTYPE = ['strike_ironclad', 'defend_ironclad', 'inflame', 'shrug_it_off', 'demon_form', 'slayer_dropkick']


lock = threading.Lock()


def run_one(plan, prompts_dir, card, entry, work, candidates, force, dry_run, attempts=4):
    raw = work / 'raw'
    raw.mkdir(parents=True, exist_ok=True)
    outs = [raw / f"{card['id']}-{i}.png" for i in range(1, candidates + 1)]
    if all(o.exists() for o in outs) and not force:
        return card['id'], 'cached'
    prompt, images = RECIPES[plan.get('recipe', 'kratos')](card, entry, plan, work, REFS)
    prompts_dir.mkdir(parents=True, exist_ok=True)
    (prompts_dir / f"{card['id']}.txt").write_text(prompt)
    out = raw / f"{card['id']}.png"
    command = [sys.executable, str(CLI), 'edit', '--model', plan['model'], '--quality', plan['quality'], '--size', plan['size'],
               '--output-format', 'png', '--n', str(candidates), '--no-augment', '--force', '--prompt-file', str(prompts_dir / f"{card['id']}.txt"),
               '--out', str(out)]
    for image in images:
        command += ['--image', str(image)]
    if dry_run:
        return card['id'], 'dry-run: ' + ' '.join(command[:12]) + f' ... {len(images)} images'
    last = ''
    for attempt in range(1, attempts + 1):
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            produced = [out] if candidates == 1 else [raw / f"{card['id']}-{i}.png" for i in range(1, candidates + 1)]
            if candidates == 1:
                out.rename(outs[0])
            if all(o.exists() for o in outs):
                return card['id'], 'ok'
        last = (result.stderr or result.stdout)[-400:]
        with lock:
            print(f"{card['id']} attempt {attempt}/{attempts} failed: {last.strip().splitlines()[-1] if last.strip() else ''}", file=sys.stderr, flush=True)
        if re.search(r'moderation|safety|content_policy', last, re.I):
            break
        time.sleep(min(90, 8 * 2 ** attempt))
    return card['id'], 'FAILED ' + last


def command_run(args):
    skin, owner = resolve(args)
    plan = load_json(skin_data(skin) / 'plan.json')
    catalogue = {c['id']: c for c in load_catalogue(owner)}
    prototype = plan.get('prototype') or (KRATOS_PROTOTYPE if skin == 'kratos' else None)
    ids = prototype if args.prototype else list(plan['cards']) if args.all else args.cards
    unknown = [i for i in ids if i not in plan['cards'] or i not in catalogue]
    if unknown:
        raise SystemExit(f'not in the {skin} plan or the {owner} catalogue: {unknown}')
    work = Path(args.work or work_dir(skin))
    with concurrent.futures.ThreadPoolExecutor(args.concurrency) as pool:
        futures = [pool.submit(run_one, plan, docs_dir(skin) / 'prompts', catalogue[i], plan['cards'][i], work, args.candidates, args.force, args.dry_run) for i in ids]
        failed = 0
        for future in concurrent.futures.as_completed(futures):
            card_id, status = future.result()
            failed += status.startswith('FAILED')
            print(f'{card_id}: {status}', flush=True)
    return 1 if failed else 0


def command_select(args):
    skin, _ = resolve(args)
    sources = sources_dir(skin)
    sources.mkdir(parents=True, exist_ok=True)
    selections_path = skin_data(skin) / 'selections.json'
    selections = load_json(selections_path, {})
    for item in args.picks:
        card_id, number = item.split('=')
        raw = Path(args.work or work_dir(skin)) / 'raw' / f'{card_id}-{number}.png'
        image = Image.open(raw).convert('RGB')
        assert image.size == (1536, 1024), (raw, image.size)
        target = sources / f'{card_id}.webp'
        if args.lossless:
            image.save(target, 'WEBP', lossless=True, quality=100, method=6)
        else:  # the highest quality that keeps the repo source at or under 150 KiB
            for quality in range(90, 69, -2):
                image.save(target, 'WEBP', quality=quality, method=6)
                if target.stat().st_size <= 150 * 1024:
                    break
        selections[card_id] = {'candidate': int(number), 'source': str(target.relative_to(ROOT)), 'webpQuality': 'lossless' if args.lossless else quality, 'bytes': target.stat().st_size}
        print(card_id, target.stat().st_size)
    selections_path.write_text(json.dumps(dict(sorted(selections.items())), indent=1) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_skin_args(parser)
    parser.add_argument('--work', help='scratch folder for inputs and raw candidates (default: per skin, see skincards.work_dir)')
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run')
    group = run.add_mutually_exclusive_group(required=True)
    group.add_argument('--prototype', action='store_true')
    group.add_argument('--all', action='store_true')
    group.add_argument('--cards', nargs='+')
    run.add_argument('--candidates', type=int, default=1)
    run.add_argument('--concurrency', type=int, default=3)
    run.add_argument('--force', action='store_true')
    run.add_argument('--dry-run', action='store_true')
    select = sub.add_parser('select')
    select.add_argument('picks', nargs='+', metavar='id=n')
    select.add_argument('--lossless', action='store_true', help='store the model PNG as lossless WebP (~1.4 MB per card) instead of <= 150 KiB lossy')
    args = parser.parse_args()
    sys.exit({'run': command_run, 'select': command_select}[args.command](args) or 0)


if __name__ == '__main__':
    main()
