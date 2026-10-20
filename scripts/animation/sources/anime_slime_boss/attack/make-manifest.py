"""Write docs/skins/anime_slime_boss-art/attack-manifest.json: the provenance (prompt, source and baked output hashes) of the attack drawings.

Run after a rebake with python3 scripts/animation/sources/anime_slime_boss/attack/make-manifest.py (Pillow-free, standard library only; the hashes need a finished bake).
The per-drawing notes (candidates, rounds, what each drawing is for) are the hand-written table below; the hashes are measured.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
SKIN = 'anime_slime_boss'
ATTACK = 'scripts/animation/sources/anime_slime_boss/attack'
PROMPTS = 'docs/skins/anime_slime_boss-art/prompts'
OUT = 'public/assets/combat/characters'
IDENTITY = {'description': 'Approved identity: Slimeboss-chan idle (generated from the reference, native alpha PNG 1024x1536, prompts/idle.txt; the committed copy is scripts/art/sources/anime_slime_boss-char/idle-identity.webp, a lossy q96 copy)',
            'sha256': '518a6bfe7c5e5573f3f7aaf481623530f315599badce71c214a31ed5ede94dc2'}
LAYOUT = {'path': f'{ATTACK}/inputs/layout-idle.webp',
          'description': 'image 1: 1536x1024 transparent layout canvas with the registered idle hero at 1.6x runtime scale, near sole on x=493.5 y=960'}
NEIGHBOUR = 'the approved neighbouring drawing, scaled normalised onto the same layout canvas (head scale and near-sole plant; for the in-betweens and recoil this is the drawing before it), not committed'

# pose: (candidates n, selected, notes, extra inputs)
POSES = {
    'sink': (3, 'candidate 3', 'First move out of the idle: she turns to face the enemy and lowers into a step, the blob drifting toward her right shoulder.', []),
    'gather': (3, 'candidate 3', 'The floating blob has stretched into a stream that pours down her right arm onto the glove, which swells.', [NEIGHBOUR]),
    'windup': (3, 'candidate 3', 'The gauntlet is complete (a glossy slime fist and forearm wrap, about 1.5x the idle glove) and the arm is cocked far back; no floating blob remains. The bare left hand is in a guard in front of her chin.', [NEIGHBOUR]),
    'leap': (10, 'arm-fix round candidate 3', 'Push-off of the dash, rear toe on the ground. Round 1 (3 candidates) redrew a floating blob next to the gauntlet and was rejected; round 2 (3, "no floating blob") was kept until the arm review; the arm-fix round (4) redrew it with the bare left hand tucked in a guard at her chin instead of reaching forward, so the bare hand has only a short way to travel back during the cross.', [NEIGHBOUR]),
    'fly': (7, 'arm-fix round candidate 3', 'Flying dash, both boots off the ground (lift 20), the bare left hand tucked in a guard at her chin (redrawn in the arm-fix round: the first version reached forward).', [NEIGHBOUR]),
    'step': (7, 'arm-fix round candidate 2', 'Landing stride in front of the enemy, gauntlet cocked at the hip (still drawn over the hair), the bare left fist in a guard at her chin (redrawn in the arm-fix round: the first version reached forward).', [NEIGHBOUR]),
    'cross0': (4, 'candidate 3', 'Added in the arm-fix round: half-way between step (image 3) and cross (image 4): the gauntlet arm starts to sweep forward, the glove at her rear hip, the bare fist has dropped from her chin to her upper chest.', [NEIGHBOUR, 'image 4: the cross drawing, normalised the same way']),
    'cross': (12, 'third round candidate 2', 'Added in the arm-fix round: the first moment of the cross punch. The gauntlet arm (her right, near arm) is drawn over her torso and belt with its sleeve continuous from the shoulder panel to the glove, the bare left arm is behind her torso with only the hand showing at her hip. Rounds 1 and 2 (4 candidates each) drew the bare arm over her chest and hid the gauntlet arm behind the torso; round 3 added the explicit layering rule (prompts/attack-cross.txt) and the continuous-sleeve requirement.', [NEIGHBOUR, 'image 4: the thrust drawing, normalised the same way']),
    'thrust': (7, 'arm-fix round candidate 2', 'Redrawn in the arm-fix round after cross: the arm half extended in front of her chest, the sleeve continuous from the shoulder, the bare left hand open behind her hip. The first version (3 candidates) had the gauntlet arm hidden behind the torso and the bare arm drawn over it.', [NEIGHBOUR]),
    'punch': (8, 'arm-fix round candidate 3', 'CONTACT (the only hit): the heavy straight gauntlet punch, the right arm drawn over her torso with its sleeve continuous from the shoulder panel, the bare left hand open behind her hip, a few droplets spraying. Redrawn in the arm-fix round (4 candidates; the first set of 4 drew the gauntlet arm from the far shoulder with the bare arm in front).', [NEIGHBOUR]),
    'splash': (8, 'arm-fix round candidate 4', 'The gauntlet bursts into a crown of slime droplets; hair and coat flare forward; same arms as the punch. Redrawn in the arm-fix round (4 candidates) from the new punch.', [NEIGHBOUR]),
    'pull': (4, 'candidate 3', 'Added in the arm-fix round: half-way between splash (image 3) and recoil (image 4): the gauntlet arm pulling back with the glove deflating in front of her stomach, the bare hand coming forward beside her ribs.', [NEIGHBOUR, 'image 4: the recoil drawing, normalised the same way']),
    'recoil': (11, 'arm-fix round candidate 2', 'The gauntlet arm folded across the front of her chest, the bare fist back in a guard at her chin. Rounds before the arm review (7 candidates, A splash / B follow, then with the old thrust as an arm reference) were replaced by a round (4) between the new splash (image 3) and rise0 (image 4).', [NEIGHBOUR, 'image 4: the rise0 drawing, normalised the same way']),
    'rise0': (4, 'candidate 2', 'Half-way between recoil and rise (images 3 and 4): half risen, the glove back to normal, a small blob forming at the shoulder. Drawn before the arm review; its glove arm already read as the same arm and was kept.', [NEIGHBOUR, 'image 4: the rise drawing, normalised the same way']),
    'rise': (3, 'candidate 2', 'Nearly upright guard, glove at the hip, the blob back beside her right shoulder.', [NEIGHBOUR]),
    'hop': (3, 'candidate 3', 'Backwards hop, both boots off the ground (lift 32), still facing the enemy, hair and coat blown forward.', [NEIGHBOUR]),
    'land': (3, 'candidate 2', 'Touchdown of the hop, knees bent.', [NEIGHBOUR]),
    'recover': (4, 'candidate 3', 'Settling back toward the idle stance and the three-quarter front view.', [NEIGHBOUR]),
}


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def entry(name, count, selected, notes, extra, source, output, prompt):
    inputs = [LAYOUT | {'sha256': sha(LAYOUT['path'])}, IDENTITY | {'description': 'image 2: ' + IDENTITY['description']}]
    inputs += [{'description': f'image {index + 3}: {text}'.replace(f'image {index + 3}: image ', 'image ')} for index, text in enumerate(extra)]
    return {'name': name, 'size': [1536, 1024], 'n': count, 'selected': selected,
            'prompt': {'path': prompt, 'sha256': sha(prompt)},
            'source': {'path': source, 'sha256': sha(source)},
            'output': {'path': output, 'sha256': sha(output)},
            'inputs': inputs, 'notes': notes}


def main():
    generated = [entry(pose, *POSES[pose][:2], POSES[pose][2], POSES[pose][3], f'{ATTACK}/{pose}.webp',
                       f'{OUT}/animated/{SKIN}-{pose}.webp', f'{PROMPTS}/attack-{pose}.txt') for pose in POSES]
    generated.append(entry('spawn', 4, 'candidate 2', 'The standing "summoning" drawing (hands raised, a slime blob budding out of her right palm), a static drawing on the hero canvas planted on the idle near sole.',
                           [], f'{ATTACK}/spawn.webp', f'{OUT}/{SKIN}-spawn.webp', f'{PROMPTS}/attack-spawn.txt'))
    manifest = {
        'model': 'gpt-image-2.5-sunburst', 'workflow': 'imagegen bundled image_gen.py edit', 'quality': 'high',
        'background': 'transparent (native alpha)', 'size': '1536x1024', 'format': 'png, stored as WebP q96 (alpha lossless, alpha noise of 8 or less zeroed)',
        'registration': f'{ATTACK}/../attack-registration.json (measured by scripts/animation/measure-anime_slime_boss.py)',
        'bake': 'python3 scripts/animation/anime_slime_boss.py', 'config': 'scripts/animation/skins/anime_slime_boss.json',
        'note': 'Nineteen drawings (eighteen attack poses and the spawn drawing), each an edit with the layout canvas, the approved identity and (for every pose after the first) the previous approved drawing; the in-betweens cross0, cross, rise0, pull and recoil get both neighbours. Arm review (user report: the slime hand seemed to change from the right to the left hand): the glove is on the same arm in every drawing, her right arm, drawn over her torso with its sleeve continuous from the shoulder panel, and the bare left arm is the far arm drawn behind the torso. The earlier thrust, punch and splash drew the gauntlet arm from the far shoulder with the bare arm over the chest, so step to thrust read as the glove jumping hands in one 50 ms cut. The fix: ARM RULE paragraph in every prompt after the cross (prompts/attack-cross.txt and later), the bare lead hand tucked at the chin in leap, fly and step, and the in-betweens cross0, cross and pull so the gauntlet arm is seen travelling over the torso while the bare hand pulls back. Every candidate was viewed one by one against the idle, rejecting heterochromatic eyes, a second floating blob, an arm folded too early and a swapped glove. The model draws a standing body 5-10% shorter than the idle at the same head size, so drawings are scaled by hat top to iris centroid (the chin is not stable: the neck and throat show in the side views); the standing spawn drawing uses the geometric mean of the head scale and the hat-to-sole height scale. The audit tracks the floating blob only (the gauntlet is bigger than the idle glove by design). The follow drawing was generated and dropped.',
        'generated': generated}
    (ROOT / 'docs/skins/anime_slime_boss-art/attack-manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')


if __name__ == '__main__':
    main()
