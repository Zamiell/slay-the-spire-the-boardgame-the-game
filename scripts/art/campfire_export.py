"""Export native 4K campfire artwork without resampling the drawing."""
from pathlib import Path
from PIL import Image


def export_campfire(source: Path, destination: Path) -> None:
    scene = Image.open(source).convert('RGB')
    assert scene.size == (3840, 2160), (source, scene.size)
    canvas = Image.new('RGB', (3840, 2161))
    canvas.paste(scene, (0, 0))
    canvas.paste(scene.crop((0, 2159, 3840, 2160)), (0, 2160))
    canvas.save(destination, 'WEBP', quality=50, method=6)
