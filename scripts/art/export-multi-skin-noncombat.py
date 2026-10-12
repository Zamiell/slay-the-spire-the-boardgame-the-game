"""Export the multi-skin campfire scenes (parties wearing two or three skins) into the runtime asset format.

A scene is named by the party's visual ids in VISUAL_IDS order (characters, then skins), each hero once, so a
skin takes its hero's place and is listed after every character. The script enumerates the expected set and
fails if the canonical sources or the exported files differ from it.
"""
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from pathlib import Path
from campfire_export import export_campfire

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/art/sources/multi-skin-noncombat'
CAMPFIRE = ROOT / 'public/assets/noncombat/campfire'
CHARACTERS = ['ironclad', 'silent', 'defect', 'watcher', 'slime_boss', 'guardian', 'hexaghost', 'hermit']
HERO_OF = {'kratos': 'ironclad', 'monogatari_silent': 'silent', 'monogatari_watcher': 'watcher'}
SKINS = list(HERO_OF)


def expected_scenes():
    """Every party of at most four distinct heroes that wears at least two skins (72 scenes)."""
    names = set()
    for worn in (pair for size in (2, 3) for pair in combinations(SKINS, size)):
        free = [c for c in CHARACTERS if c not in {HERO_OF[s] for s in worn}]
        for extra in range(0, 5 - len(worn)):
            for others in combinations(free, extra):
                names.add('_'.join([*others, *worn]))
    return names


def export_scene(source):
    export_campfire(source, CAMPFIRE / f'{source.stem}.webp')


def main():
    expected = {f'{name}_firecamp' for name in expected_scenes()}
    assert len(expected) == 72, len(expected)
    found = {path.stem for path in SOURCES.glob('*_firecamp.webp')}
    assert found == expected, (sorted(expected - found), sorted(found - expected))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(export_scene, sorted(SOURCES / f'{stem}.webp' for stem in expected)))
    exported = {path.stem for path in CAMPFIRE.glob('*_firecamp.webp')}
    assert expected <= exported, sorted(expected - exported)


if __name__ == '__main__':
    main()
