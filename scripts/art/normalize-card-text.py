#!/usr/bin/env python3
"""Reuse a base scan's rules layout, retaining upgraded glyphs in 744x1039 reference coordinates."""
import argparse

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('upgraded')
    parser.add_argument('output')
    parser.add_argument('--region', type=int, nargs=4, required=True, metavar=('LEFT', 'TOP', 'RIGHT', 'BOTTOM'))
    parser.add_argument('--replacement', type=int, nargs=6, action='append', default=[],
                        metavar=('LEFT', 'TOP', 'RIGHT', 'BOTTOM', 'DEST_X', 'DEST_Y'))
    args = parser.parse_args()
    with Image.open(args.base) as source, Image.open(args.upgraded) as target:
        if source.size != target.size:
            raise SystemExit('Card faces must have matching dimensions')
        image = target.convert('RGBA')

        def scaled(values):
            return tuple(round(value * (image.width / 744 if index % 2 == 0 else image.height / 1039))
                         for index, value in enumerate(values))

        box = scaled(args.region)
        image.paste(source.convert('RGBA').crop(box), box)
        for replacement in args.replacement:
            glyph = target.convert('RGBA').crop(scaled(replacement[:4]))
            image.paste(glyph, scaled(replacement[4:]))
        image.save(args.output, 'PNG')


if __name__ == '__main__':
    main()
