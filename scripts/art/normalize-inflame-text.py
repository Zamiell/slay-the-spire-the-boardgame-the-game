#!/usr/bin/env python3
"""Copy Inflame's printed Strength sentence onto Inflame+ without changing its cost or art."""
import argparse

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('upgraded')
    parser.add_argument('output')
    args = parser.parse_args()
    with Image.open(args.base) as source, Image.open(args.upgraded) as target:
        if source.size != target.size:
            raise SystemExit('Inflame faces must have matching dimensions')
        image = target.convert('RGBA')
        box = tuple(round(value * scale) for value, scale in zip(
            (180, 630, 570, 840), (image.width / 744, image.height / 1039) * 2))
        image.paste(source.convert('RGBA').crop(box), box)
        image.save(args.output, 'PNG')


if __name__ == '__main__':
    main()
