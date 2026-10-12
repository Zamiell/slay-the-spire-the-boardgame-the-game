"""Original empty camp and character assets used by every fresh scene attempt."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def original_references():
    empty = Image.open(ROOT / 'public/assets/noncombat/campfire/empty_firecamp.webp').convert('RGB')
    yield 'empty-campfire.png', empty.crop((0, 0, 3840, 2160))
    for hero in ['ironclad', 'silent', 'defect', 'watcher', 'slime_boss', 'guardian',
                 'hexaghost', 'hermit', 'kratos', 'monogatari_ironclad',
                 'monogatari_defect', 'monogatari_silent', 'monogatari_watcher']:
        if hero in ['monogatari_silent', 'monogatari_watcher']:
            identity = ROOT / f'scripts/art/sources/{hero}-noncombat/identity.webp'
        elif hero == 'guardian':
            identity = ROOT / 'public/assets/combat/characters/guardian-hero.webp'
        else:
            identity = ROOT / f'public/assets/noncombat/merchant/characters/{hero}-standing.webp'
        yield f'{hero}-identity.png', Image.open(identity)
