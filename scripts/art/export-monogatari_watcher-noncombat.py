"""Export the committed Monogatari Watcher artwork into the existing noncombat asset formats."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image
from campfire_export import export_campfire

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/art/sources/monogatari_watcher-noncombat'
SKIN = 'monogatari_watcher'

merchant = Image.open(SOURCES / 'merchant.webp').convert('RGBA')
box = merchant.getchannel('A').getbbox()
merchant = merchant.crop((0, max(0, box[1] - 12), merchant.width, min(merchant.height, box[3] + 12)))
merchant.thumbnail((576, 576), Image.Resampling.LANCZOS)
merchant.save(ROOT / f'public/assets/noncombat/merchant/characters/{SKIN}-standing.webp', quality=88, method=6)

hands = Image.open(SOURCES / 'treasure-hands.webp').convert('RGBA')
for index, pose in enumerate(['hand', 'grip']):
    hands.crop((index * 512, 0, (index + 1) * 512, 1536)).resize(
        (384, 1024), Image.Resampling.LANCZOS).save(
            ROOT / f'public/assets/noncombat/treasure/{pose}-{SKIN}.webp', quality=88, method=6)


def export_scene(source):
    export_campfire(source, ROOT / 'public/assets/noncombat/campfire' / source.name)


with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(export_scene, sorted(SOURCES.glob(f'*{SKIN}_firecamp.webp'))))
