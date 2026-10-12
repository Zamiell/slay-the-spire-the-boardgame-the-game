"""Export the committed Monogatari Silent noncombat artwork into the existing noncombat asset formats."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image
from campfire_export import export_campfire

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/art/sources/monogatari_silent-noncombat'
NONCOMBAT = ROOT / 'public/assets/noncombat'
SKIN = 'monogatari_silent'

merchant = Image.open(SOURCES / 'merchant.webp').convert('RGBA')
merchant = merchant.crop(merchant.getchannel('A').getbbox())
height = 548
merchant = merchant.resize((round(merchant.width * height / merchant.height), height), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (384, 576), (0, 0, 0, 0))
canvas.alpha_composite(merchant, ((384 - merchant.width) // 2, 10))
canvas.save(NONCOMBAT / f'merchant/characters/{SKIN}-standing.webp', quality=88, method=6)

hands = Image.open(SOURCES / 'treasure-hands.webp').convert('RGBA')
for index, pose in enumerate(['hand', 'grip']):
    arm = hands.crop((index * 512, 0, (index + 1) * 512, 1536)).resize((341, 1024), Image.Resampling.LANCZOS)
    box = arm.getchannel('A').getbbox()
    canvas = Image.new('RGBA', (384, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(arm, (192 - (box[0] + box[2]) // 2, 0))
    canvas.save(NONCOMBAT / f'treasure/{pose}-{SKIN}.webp', quality=88, method=6)


def export_scene(source):
    export_campfire(source, NONCOMBAT / 'campfire' / source.name)


with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(export_scene, sorted(SOURCES.glob('*_firecamp.webp'))))
