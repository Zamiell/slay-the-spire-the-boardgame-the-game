"""Export complete registered Sunburst drawings, never morph or segment anatomy.

python3 scripts/animation/monogatari.py [--check]
The check reconstructs every runtime artifact in memory and verifies its byte hash.
"""
import hashlib
import io
import json
import math
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REG_PATH = ROOT / 'scripts/animation/sources/monogatari/registration.json'
REG = json.loads(REG_PATH.read_text())
OUT = ROOT / 'public/assets/combat/characters'
MANIFEST = ROOT / 'docs/monogatari-skins/combat-manifest.json'
CHECK = '--check' in sys.argv


def sha(data):
    return hashlib.sha256(data).hexdigest()


def solid_box(image):
    return image.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()


def webp(image, frames=None, durations=None):
    result = io.BytesIO()
    image.save(result, 'WEBP', quality=92, method=4, save_all=bool(frames),
               append_images=frames or [], duration=durations or 0, loop=0)
    return result.getvalue()


def registered(mark, rear):
    source = Image.open(ROOT / mark['source']).convert('RGBA')
    # No per-pose fitting: the generated adult body and blade keep their native dimensions.
    canvas = Image.new('RGBA', (REG['virtualCanvas'],) * 2)
    position = (rear - mark['rearSole'][0], REG['ground'] - mark['rearSole'][1])
    box = solid_box(source)
    assert box and box[0] + position[0] >= 0 and box[2] + position[0] < canvas.width
    assert box[1] + position[1] >= 0 and box[3] + position[1] < canvas.height
    assert source.getchannel('A').getextrema()[0] == 0, 'source lost native alpha'
    canvas.alpha_composite(source, position)
    return canvas


def sized(image, size):
    return image.resize((size, size), Image.Resampling.LANCZOS)


outputs = {}
sources = {}
heads = {}
for skin, data in REG['skins'].items():
    marks = data['poses']
    head_sizes = [mark['head'][1] - mark['head'][0] for mark in marks.values()]
    assert max(head_sizes) / min(head_sizes) < 1.12, f'{skin}: head scale drift'
    if skin == 'monogatari_ironclad':
        blades = [math.dist(*mark['blade']) for mark in marks.values()]
        assert max(blades) / min(blades) < 1.12, 'sword length drift'
    drawings = {pose: registered(mark, data['rearAnchor']) for pose, mark in marks.items()}
    for pose, mark in marks.items():
        sources[mark['source']] = sha((ROOT / mark['source']).read_bytes())
        if pose != 'idle':
            outputs[f'{skin}-{pose}.webp'] = webp(sized(drawings[pose], REG['runtimeCanvas']))
    outputs[f'{skin}-hero.webp'] = webp(sized(drawings['idle'], 1024))
    source = Image.open(ROOT / marks['idle']['source']).convert('RGBA')
    cutout = source.crop(solid_box(source))
    thumb = Image.new('RGBA', (512, 512))
    cutout.thumbnail((480, 480), Image.Resampling.LANCZOS)
    thumb.alpha_composite(cutout, ((512 - cutout.width) // 2, 512 - cutout.height - 12))
    outputs[f'{skin}.webp'] = webp(thumb)
    # Tiny rigid balance sway pivots at the registered rear sole. No limb warping or scale pulse.
    frames = [sized(drawings['idle'].rotate(angle, Image.Resampling.BICUBIC,
              center=(data['rearAnchor'], REG['ground'])), REG['runtimeCanvas'])
              for angle in [0, .1, .2, .1, 0, -.1, -.2, -.1]]
    outputs[f'animated/{skin}-idle.webp'] = webp(frames[0], frames[1:], [400] * len(frames))
    # A reproducible complete-pose preview complements actual gameplay recordings.
    keys = data['keys']
    sequence = [sized(drawings[pose], REG['runtimeCanvas']) for _, pose in keys]
    durations = [end - start for (start, _), end in zip(keys, [ms for ms, _ in keys[1:]] + [data['durationMs']])]
    outputs[f'animated/{skin}-attack.webp'] = webp(sequence[0], sequence[1:], durations)
    heads[skin] = round((REG['virtualCanvas'] - solid_box(drawings['idle'])[1]) / REG['virtualCanvas'], 4)

manifest = {
    'model': REG['model'], 'quality': REG['quality'], 'alpha': REG['alpha'],
    'registrationSha256': sha(REG_PATH.read_bytes()),
    'runtimeCanvas': REG['runtimeCanvas'], 'displayScale': 1,
    'heroHeadRatios': heads, 'sources': sources,
    'prompts': {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in sorted((ROOT / 'docs/monogatari-skins/prompts/combat').glob('*.txt'))},
    'outputs': {f'public/assets/combat/characters/{path}': sha(blob) for path, blob in outputs.items()},
}
for path, blob in outputs.items():
    target = OUT / path
    if CHECK:
        assert target.is_file() and target.read_bytes() == blob, f'stale asset: {target.relative_to(ROOT)}'
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
if CHECK:
    assert json.loads(MANIFEST.read_text()) == manifest, 'stale combat manifest'
else:
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
print(('PASS' if CHECK else 'EXPORTED') + ': native alpha, fixed canvas/body/head/blade size, 1800/1650ms complete drawings')
print('Head ratios:', heads)
