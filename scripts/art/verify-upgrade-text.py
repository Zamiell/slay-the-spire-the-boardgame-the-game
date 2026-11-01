"""Focused algorithm and shipped-asset regressions; OCR is only needed for offline regeneration."""
import importlib.util
import json
from pathlib import Path
import re
import unittest

from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('upgrade_layout', Path(__file__).with_name('stabilize-upgrade-text.py'))
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


def words(lines, top=620, step=55):
    result = []
    for line, text in enumerate(lines):
        left = 150
        for word in text.split():
            width = len(word) * 8
            result.append({'text': word, 'token': re.sub(r'[^a-z0-9+]', '', word.lower()), 'confidence': 99,
                           'line': str(line), 'box': [left, top + line * step, left + width, top + line * step + 30]})
            left += width + 8
    return result


class UpgradeLayoutTests(unittest.TestCase):
    def test_unchanged_block_keeps_changed_amount_outside_the_patch(self):
        base = words(['Deal 2 damage.', 'The remaining cards', 'stay in your hand.'])
        upgraded = words(['Deal 3 damage.', 'The remaining', 'cards stay in your hand.'])
        candidates = layout.reflow_blocks(base, upgraded)
        self.assertEqual(len(candidates), 1)
        patch = layout.plan_patch(candidates[0], base, upgraded)
        self.assertEqual(patch['canonical'], 0)
        self.assertGreater(patch['destination'][1], base[0]['box'][3])

    def test_word_segmentation_does_not_masquerade_as_reflow(self):
        self.assertEqual(layout.reflow_blocks(words(['Gain a red cube.']), words(['Gainaredcube.'])), [])
        self.assertEqual(layout.reflow_blocks(words(['Deal 2 damage. Draw', 'a card.']),
                                            words(['Deal 3 damage.', 'Draw a card.'])), [])

    def test_compact_reference_clears_old_lines_without_descender_streaks(self):
        base = words(['Exhaust a card.', 'Gain Energy equal to', 'its cost.'])
        upgraded = words(['Exhaust a card.', 'Gain Energy equal to its cost.'])
        patch = layout.plan_patch(layout.reflow_blocks(base, upgraded)[0], base, upgraded)
        self.assertEqual(patch['canonical'], 1)
        images = [Image.new('RGBA', (744, 1039), (45, 55, 60, 255)) for _ in range(2)]
        ImageDraw.Draw(images[0]).rectangle((200, 729, 240, 761), fill='white')
        original = images[0].copy()
        layout.apply_patch(images, patch)
        self.assertEqual(images[0].getpixel((220, 740)), (45, 55, 60, 255))
        difference = ImageChops.difference(original.convert('RGB'), images[0].convert('RGB'))
        for box in [patch['destination'], *patch['clear']]:
            difference.paste((0, 0, 0), layout.scaled(box, difference.size))
        self.assertIsNone(difference.getbbox(), 'art and other rules outside the patch must be untouched')

    def test_changed_neighbour_cannot_be_overwritten(self):
        candidate = {'before': [['unchanged'], ['text']], 'after': [['unchanged'], ['text']],
                     'sourceBox': [150, 650, 450, 820], 'targetBox': [150, 650, 450, 735],
                     'text': 'unchanged text'}
        with self.assertRaisesRegex(ValueError, 'changed rule'):
            layout.plan_patch(candidate, [], words(['A newly added rule.'], top=755))

    def test_shipped_pairs_and_all_skin_and_thumbnail_tiers(self):
        audit = json.loads((ROOT / 'data/card-upgrade-layouts.json').read_text())
        cards = ROOT / 'public/assets/cards'
        self.assertEqual(sorted(audit['audited']), sorted(path.stem[:-1] for path in cards.glob('*+.webp')))
        checked = 0
        for item in audit['corrections']:
            key = item['key']
            roots = [cards, cards.parent / 'cards-sm']
            for skin in (cards.parent / 'skin-cards').iterdir():
                if (skin / f'{key}.webp').exists():
                    roots.extend([skin, cards.parent / 'skin-cards-sm' / skin.name])
            for root in roots:
                with Image.open(root / f'{key}.webp') as base, Image.open(root / f'{key}+.webp') as upgraded:
                    images = [base.convert('RGB'), upgraded.convert('RGB')]
                for patch in item['patches']:
                    source = images[patch['canonical']]
                    target = images[1 - patch['canonical']]
                    expected = source.crop(layout.scaled(patch['source'], source.size))
                    actual = target.crop(layout.scaled(patch['destination'], target.size))
                    expected = expected.resize(actual.size, Image.Resampling.LANCZOS)
                    error = ImageStat.Stat(ImageChops.difference(expected, actual)).mean
                    # Thumbnail text lands on a fractional resampling grid; allow codec/antialiasing
                    # differences, not the much larger differences from moving words between lines.
                    limit = 8 if source.width < 744 else 6
                    self.assertLess(max(error), limit, f'{root}/{key}: unchanged text differs: {error}')
                    clear = Image.new('L', target.size)
                    for box in patch['clear']:
                        clear.paste(255, layout.scaled(box, target.size))
                    clear.paste(0, layout.scaled(patch['destination'], target.size))
                    remaining = Image.composite(target, Image.new('RGB', target.size), clear)
                    self.assertLess(max(channel[1] for channel in remaining.getextrema()), 170,
                                    f'{root}/{key}: obsolete lettering remains outside the replacement')
                    checked += 1
        print(f'Checked {len(audit["audited"])} audited pairs and {checked} corrected image-tier regions')


if __name__ == '__main__':
    unittest.main()
