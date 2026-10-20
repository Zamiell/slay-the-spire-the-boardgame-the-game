"""Prompt recipes of the skin card pipeline: which input images a skin's call gets, in which order, and the prompt text.

A skin's plan.json names its recipe ("kratos" when absent). A recipe returns (prompt, ordered input image paths) for
one card; generate.py runs the CLI with them. Input images are re-encoded to PNG under the work folder by `png`.
"""
import hashlib
import os
from pathlib import Path

from PIL import Image

from skincards import CARDS, ROOT, extract_art, scan_key

# Reference files outside the repo (copyrighted style frames, approved identity sheets) are named "@work/<path>",
# relative to $STS_SKIN_WORK (default ~/skin-work); they are never committed, manifests record hashes only.
SKIN_WORK = Path(os.environ.get('STS_SKIN_WORK', Path.home() / 'skin-work'))


def resolve_ref(ref):
    return SKIN_WORK / ref.removeprefix('@work/') if ref.startswith('@work/') else ROOT / ref


def record_ref(ref, description=None):
    """Manifest entry of a reference: repo files by path, external ones by description and hash only."""
    path = resolve_ref(ref)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if ref.startswith('@work/'):
        return {'description': description, 'sha256': digest}
    return {'path': ref, 'sha256': digest}


def png(source, target, max_side=None):
    """Re-encode an input image as PNG/JPEG the API accepts (the webp scans are fine, the wiki images can be odd)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return target
    image = Image.open(source).convert('RGB')
    if max_side and max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    image.save(target)
    return target


def original_art(card, target):
    """Text-free original art: the committed card-art file, or for pack cards the window cut out of the scan."""
    path = ROOT / f"public/assets/card-art/{card['owner']}/{card['id']}.webp"
    if path.exists():
        return png(path, target)
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        extract_art(Image.open(CARDS / f"{scan_key(card, False)}.webp"), card, False).save(target)
    return target


KRATOS_TEMPLATE = """Use case: stylized-concept. Asset type: one text-free Slay the Spire card illustration, re-themed as Greek-era God of War 1, 2 and 3 with Kratos.
Reference images, by number. Images 1 and 2 are the STYLE AUTHORITY: Slay the Spire's bold flat graphic card paintings with rough angular silhouettes, expressive ink-dark outlines, chunky simplified forms, limited cel-shaded color planes, occasional painted texture and deep vignetted backgrounds. Match these two paintings, not photographic realism and not glossy detailed 3D. Image 3 is the KRATOS IDENTITY ONLY: young Greek-era Kratos from God of War 1 to 3, bald ash-white skin, red tattoo down the left side, short pointed dark goatee, bronze bracers, red cloth skirt, Blades of Chaos on chains; simplify him into the card painting style of images 1 and 2. {game_refs}Image {scan_n} is the original Ironclad card and image {art_n} is that card's original artwork: keep the card's meaning, subject and gesture, but translate it into the God of War scene below. Ignore every letter, number, symbol and the frame of the card scan; none of them may appear in the result.
SCENE: {name} ({type} card). {scene}
Compose {composition}. Produce one wide 1536x1024 painting with no frame, no border, no labels, no text, no symbols resembling letters, no watermark. Keep the main subject inside the central 75 percent of the image height and the central 85 percent of its width, because the painting is later cropped to a shallow wide window and shown small, so keep the focal shapes bold and readable at thumbnail size.
Kratos is always the young Greek Kratos of image 3: no Norse beard, fur, runes, Leviathan axe or modern setting. Every figure has coherent connected anatomy, exactly two arms and two legs, correct hands and grips, and consistent weapon construction.
"""

COMPOSITION = {
    'attack': 'a dynamic, diagonal, high-impact composition',
    'skill': 'a solid, grounded, readable composition that reads inside a rounded rectangle',
    'power': 'an iconic, centered, emblematic composition whose important shapes read inside a circle or oval, with calm margins at all four edges',
}


def kratos(card, entry, plan, work, refs_dir):
    inputs = [(ROOT / p, f'style{i + 1}') for i, p in enumerate(plan['styleReferences'])]
    inputs.append((ROOT / plan['identityReference'], 'identity'))
    refs = [next(iter(refs_dir.glob(f'{tag}.*'))) for tag in entry['refs']]
    inputs += [(r, f'gow-{r.stem}') for r in refs]
    scan = CARDS / f"{scan_key(card, False)}.webp"
    n = len(inputs)
    paths = [png(src, work / 'inputs' / card['id'] / f'{i + 1:02d}-{role}.png', 1280) for i, (src, role) in enumerate(inputs)]
    paths.append(png(scan, work / 'inputs' / card['id'] / f'{n + 1:02d}-scan.png'))
    paths.append(original_art(card, work / 'inputs' / card['id'] / f'{n + 2:02d}-art.png'))
    numbers = [str(i + 1) for i in range(3, n)]
    game_refs = (f"Images {', '.join(numbers[:-1])} and {numbers[-1]} are God of War 1, 2 and 3 game images for the world, costume, weapon and monster shapes only; do not copy their realistic 3D rendering. "
                 if len(numbers) > 1 else f"Image {numbers[0]} is a God of War game image for the world, costume, weapon and monster shapes only; do not copy its realistic 3D rendering. ")
    prompt = KRATOS_TEMPLATE.format(game_refs=game_refs, scan_n=n + 1, art_n=n + 2, name=card['name'], type=card['type'],
                                    scene=entry['scene'], composition=COMPOSITION[card['type']])
    return prompt, paths


MONOGATARI_TEMPLATE = """Use case: stylized-concept. Asset type: one text-free Slay the Spire card illustration, re-themed as Monogatari series anime art starring the ORIGINAL anime heroine of the {hero} skin.
Reference images, by number. Images {style_numbers} are STYLE AUTHORITY ONLY: Monogatari series (SHAFT, Akiyuki Shimbo) 2D anime frames. Copy the thin precise black linework, huge flat almond eyes with a crisp highlight, shard-like flat hair, elongated slender limbs and necks, small pointed chins, FLAT cel colour with at most one hard-edged shadow step, stark graphic shapes, dramatic low and high camera angles, tilted heads, selective stylised highlights, and either a cloudless saturated sky or hard diagonal shadow cuts with one flat hot colour panel. Do NOT copy any character, face, costume, hair or prop from them, and no gradients, glow haze, painterly brushwork or 3D shading. Image {identity_n} is the HEROINE IDENTITY: {cues} Keep her face, eye colour, hair, outfit, colours and props identical to image {identity_n} in every card, redrawn in the style of the Monogatari frames. Image {scan_n} is the original Slay the Spire card and image {art_n} is that card's original artwork: keep the card's meaning, subject and gesture, but translate it into the scene below with the heroine as the performer. Ignore every letter, number, symbol and the frame of the card scan; none of them may appear in the result.
SCENE: {name} ({type} card). {scene}
Compose {composition}. Palette: {palette} Produce one wide 1536x1024 illustration with no frame, no border, no labels, no text, no kanji, no symbols resembling letters, no logo, no watermark. Keep the main subject inside the central 75 percent of the image height and the central 85 percent of its width, because the illustration is later cropped to a shallow wide window and shown small, so keep the focal shapes bold and readable at thumbnail size.
She is a single adult-looking young woman in her modest full-coverage outfit with exactly two arms and two legs, correct hands and grips, no fan-service pose, no school uniform, no gore. Calm deadpan expression, thin even linework, flat colour.
"""

MONOGATARI_COMPOSITION = {
    'attack': 'a dynamic diagonal action composition with a dramatic low or high camera angle and stark graphic shapes',
    'skill': 'a solid, calm, readable composition with a tilted head and clear props that reads inside a rounded rectangle',
    'power': 'an iconic, centred, emblematic composition whose important shapes read inside a circle or oval, with calm margins at all four edges',
}


def monogatari(card, entry, plan, work, refs_dir):
    pool = {r['tag']: r for r in plan['styleReferences']}
    tags = entry.get('styles') or list(pool)
    inputs = [(resolve_ref(pool[t]['path']), f'style-{t}') for t in tags]
    inputs.append((resolve_ref(plan['identityReference']), 'identity'))
    k = len(tags)
    paths = [png(src, work / 'inputs' / card['id'] / f'{i + 1:02d}-{role}.png', 1280) for i, (src, role) in enumerate(inputs)]
    paths.append(png(CARDS / f"{scan_key(card, False)}.webp", work / 'inputs' / card['id'] / f'{k + 2:02d}-scan.png'))
    paths.append(original_art(card, work / 'inputs' / card['id'] / f'{k + 3:02d}-art.png'))
    numbers = [str(i + 1) for i in range(k)]
    style_numbers = f"{', '.join(numbers[:-1])} and {numbers[-1]}" if k > 1 else numbers[0]
    prompt = MONOGATARI_TEMPLATE.format(
        hero=plan['hero'], style_numbers=style_numbers, identity_n=k + 1, scan_n=k + 2, art_n=k + 3, cues=plan['identityCues'],
        name=card['name'], type=card['type'], scene=entry['scene'], composition=MONOGATARI_COMPOSITION[card['type']], palette=plan['palette'])
    return prompt, paths


ANIME_SLIME_BOSS_TEMPLATE = """Use case: stylized-concept. Asset type: one text-free Slay the Spire card illustration, redrawn as clean modern TV-anime art starring Slimeboss-chan, the original anime heroine of the Slime Boss skin (the human form of the lime-green slime boss).
Reference images, by number. Image 1 is the CHARACTER DESIGN SHEET and the STYLE AUTHORITY: copy its clean thin dark linework, flat cel colouring with one soft shadow step, large almond eyes with small highlights, long straight hair strands drawn as a few clean flat-shaded clumps, and calm TV-anime proportions. Image 2 is the approved HEROINE IDENTITY drawing: {cues} Keep her face, gold-yellow eyes, lime-green hair, tiny black bowler mini-hat, coat, tunic, belt, boots and colours identical to images 1 and 2 in every card, redrawn for the new pose and camera. Slimes are glossy translucent lime-green blobs (the same lime as her hair) with a few white specular highlights, thin dark outlines, drips and small bubbles, like the floating blob and the slime glove in image 2; they have no faces, no hats and no eyes, and they never take another colour. Image {scan_n} is the original Slay the Spire card and image {art_n} is that card's original artwork: keep the card's meaning, subject and gesture, but translate it into the scene below with the heroine and her lime-green slimes. Ignore every letter, number, symbol and the frame of the card scan; none of them may appear in the result.
SCENE: {name} ({type} card). {scene}
Compose {composition}. Palette: {palette} Produce one wide 1536x1024 illustration with no frame, no border, no labels, no text, no symbols resembling letters, no logo, no watermark. Keep the main subject inside the central 75 percent of the image height and the central 85 percent of its width, because the illustration is later cropped to a shallow wide window and shown small, so keep the focal shapes bold and readable at thumbnail size.
She is a single adult-looking young woman in her modest full-coverage outfit with exactly two arms and two legs, correct hands, no fan-service pose, no gore. Calm faint smile, thin even linework, flat cel colour, a simple clean anime background (no photographic or painterly detail), no gradients except the glossy slimes.
"""

ANIME_SLIME_BOSS_COMPOSITION = {
    'attack': 'a dynamic diagonal action composition with a dramatic camera angle, motion arcs and a clear impact',
    'skill': 'a solid, calm, readable composition with clear props that reads inside a rounded rectangle',
    'power': 'an iconic, centred, emblematic composition whose important shapes read inside a circle or oval, with calm margins at all four edges',
}


def anime_slime_boss(card, entry, plan, work, refs_dir):
    pool = {r['tag']: r for r in plan['styleReferences']}
    tags = entry.get('styles') or list(pool)
    inputs = [(resolve_ref(pool[t]['path']), f'style-{t}') for t in tags]
    inputs.append((resolve_ref(plan['identityReference']), 'identity'))
    k = len(tags)
    paths = [png(src, work / 'inputs' / card['id'] / f'{i + 1:02d}-{role}.png', 1280) for i, (src, role) in enumerate(inputs)]
    paths.append(png(CARDS / f"{scan_key(card, False)}.webp", work / 'inputs' / card['id'] / f'{k + 2:02d}-scan.png'))
    paths.append(original_art(card, work / 'inputs' / card['id'] / f'{k + 3:02d}-art.png'))
    prompt = ANIME_SLIME_BOSS_TEMPLATE.format(
        scan_n=k + 2, art_n=k + 3, cues=plan['identityCues'], name=card['name'], type=card['type'], scene=entry['scene'],
        composition=ANIME_SLIME_BOSS_COMPOSITION[card['type']], palette=plan['palette'])
    return prompt, paths


RECIPES = {'kratos': kratos, 'monogatari': monogatari, 'anime_slime_boss': anime_slime_boss}
