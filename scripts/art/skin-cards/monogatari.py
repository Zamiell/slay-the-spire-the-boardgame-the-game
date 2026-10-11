#!/usr/bin/env python3
"""Prepare semantic reference grids and export audited Monogatari card sheets.

No API calls. Generation uses the unmodified bundled imagegen CLI directly.
  python3 scripts/art/skin-cards/monogatari.py prepare
  python3 scripts/art/skin-cards/monogatari.py masks
  python3 scripts/art/skin-cards/monogatari.py export
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps, ImageFilter, ImageChops
from skincards import (
    ROOT,
    HERE,
    CARDS,
    THUMBS,
    REF_SIZE,
    scan_key,
    composite,
    window_alpha,
    WINDOW_BOX,
)

DOCS = ROOT / "docs/monogatari-skins/cards"
SOURCE = ROOT / "scripts/art/sources/monogatari/cards"
WORK = ROOT / "artifacts/monogatari-cards"
STYLE = [
    Path("/Users/hieu.leduc/.t3/userdata/attachments") / p
    for p in (
        "04de5950-20d7-4de4-807d-24420cc8c2cc-1ccf9b71-0226-4528-849f-98d5a5fe73fc.jpg",
        "04de5950-20d7-4de4-807d-24420cc8c2cc-a484054f-6a7b-4767-b3d0-15085a35db64.jpg",
        "04de5950-20d7-4de4-807d-24420cc8c2cc-ef1883c2-c8ac-49a6-8323-62ddb6213f6e.webp",
    )
]
IDENTITY = {
    "ironclad": ROOT / "scripts/art/sources/monogatari/ironclad-idle-grip-repaired.png",
    "defect": ROOT / "scripts/animation/sources/monogatari/defect-idle.png",
}
DEFECT_SCENES = {
    "steam_barrier": "A thick pale blue wall of steaming vapor rises from her brass forearms to intercept a red projectile.",
    "slayer_aggregate": "She gathers dozens of small luminous circuit fragments into one blue energy core between both gloved hands.",
    "slayer_auto_shields": "Two brass rings unfold into a connected hexagonal turquoise shield in front of her raised mechanical forearm.",
    "slayer_biased_cognition": "Asymmetric emerald and violet data shadows cross her thoughtful face; luminous circuitry concentrates around her temple plates.",
    "slayer_creative_ai": "She projects a miniature luminous blue mechanical companion above one palm in an abstract geometric workshop.",
    "slayer_hello_world": "She greets a small newly activated clockwork companion with an open brass-gloved hand, warm yellow geometric light.",
    "slayer_reboot": "Her chest core restarts with a fresh azure pulse, eyes reopening calmly in a dark chamber.",
    "slayer_rebound": "A blue energy projectile ricochets off a brass barrier back toward an angular shadow enemy.",
    "strike_defect": "Her connected brass gauntlet punches toward the viewer with a crisp orange impact arc.",
    "defend_defect": "She crosses both brass forearms into a firm guard against two incoming red energy bolts.",
    "zap": "One brass fingertip channels a small precise branching lightning bolt into a bright blue orb.",
    "dual_cast": "One blue orb splits into two equal discharge arcs between her separated gloved palms.",
    "ball_lightning": "She launches a concentrated bright blue lightning sphere with a clear connected throwing arm.",
    "cold_snap": "She snaps brass fingers together and a crystalline ice shard shoots into a dark enemy silhouette.",
    "coolheaded": "Calm close-up of her emerald eyes with frost crystals and a hovering blue ice orb beside her cheek.",
    "charge_battery": "Both hands hold a cylindrical brass battery with a clear blue core filling with energy.",
    "chaos": "Blue lightning, pale frost and violet darkness orbit around her in three clean separate geometric orbs.",
    "recursion": "She guides the same blue orb along a looped circular trail returning to her extended palm.",
    "sweeping_beam": "A single horizontal blue energy beam sweeps across three angular enemy silhouettes.",
    "compile_driver": "She assembles three differently colored orb circuits into one connected brass control mechanism.",
    "scrape": "Her brass clawed gauntlet scrapes along stone, scattering sparks in one clear diagonal movement.",
    "ftl": "She dashes forward leaving three clean blue speed silhouettes against black geometric architecture.",
    "force_field": "She stands inside a closed turquoise hexagonal energy dome, hands held calmly near her core.",
    "tempest": "She raises one gloved arm beneath a vivid storm of branching blue lightning bolts.",
    "reinforced_body": "Interlocking brass armor plates reinforce her shoulders and forearms in a confident guarded pose.",
    "equilibrium": "She balances one lightning orb and one frost orb above her two palms, symmetric geometric composition.",
    "loop": "A blue orb follows an elegant golden infinity-shaped circuit around her centered chest core.",
    "buffer": "A large translucent blue shield intercepts one red spear of energy before it touches her.",
    "echo_form": "Two clearly separate translucent blue echoes of her stand behind the solid central woman.",
    "electrodynamics": "Bright blue electrical branches connect three separate hovering orbs across the scene.",
    "fission": "Her core releases three distinct blue orb fragments outward while her hands remain attached and braced.",
    "multi_cast": "She channels one blue orb into several clean outward branching lightning arcs.",
    "seek": "She studies a small floating blue map of geometric paths with one focused emerald eye in close-up.",
    "blizzard": "She commands a diagonal blast of snow and ice shards, face sheltered by her raised brass forearm.",
    "hologram": "She regards a miniature transparent cyan copy of herself projected above a brass palm.",
    "doom_and_gloom": "A dense violet-black orb rises between her hands against deep purple architectural shadows.",
    "overclock": "Her chest core and brass temple circuits burn vivid blue while she reaches toward a spinning gear.",
    "darkness": "A single dark violet orb with a fine purple rim hovers beside her shadowed face.",
    "storm": "Electric storm clouds loom over her small centered figure, sharp golden lightning diagonals.",
    "machine_learning": "Her attentive eyes reflect abstract blue circuit patterns as she reads a hovering mechanical projection.",
    "leap": "She jumps sideways over one incoming red projectile with two bent connected legs and coat tails trailing.",
    "glacier": "She raises a massive solid blue ice wall in front of her planted stance.",
    "rainbow": "Three distinct blue lightning, pale frost and violet darkness orbs span a clean multicolor arc.",
    "reprogram": "She carefully adjusts a brass circuit plate with one gloved finger, blue geometric connections rearranging.",
    "melter": "A focused orange heat beam from her palm melts the face of a blue ice shield.",
    "hyperbeam": "She braces both arms and releases one huge straight turquoise beam from her palms toward the right.",
    "sunder": "Her heavy brass fist strikes down into a stone floor with a clean central fracture and orange impact.",
    "fusion": "Both palms enclose a small radiant golden plasma sphere with two distinct blue orbiting arcs.",
    "heatsinks": "Brass cooling fins along her gauntlet vent soft steam into a dark blue geometric background.",
    "stack": "Three overlapping connected hexagonal shield plates rise vertically in front of her.",
    "capacitor": "Three brass circular storage rings around her shoulders each cradle a bright small blue orb.",
    "consume": "She draws one dark violet orb into her chest core, a single clear violet energy stream.",
    "defragment": "She repairs a broken luminous blue circuit into a clean connected pattern between her hands.",
    "static_discharge": "Her raised brass hand crackles with small blue sparks against a dark geometric wall.",
    "amplify": "A small blue orb grows into a larger concentric blue orb between her widely separated palms.",
    "recycle": "She disassembles a worn brass gear into useful luminous circuit fragments above her glove.",
    "core_surge": "A fierce azure pulse radiates from her chest core as she plants both feet and raises a fist.",
    "all_for_one": "She draws several distinct brass tools and blue energy fragments toward one centered core.",
    "thunder_strike": "She calls a thick gold-blue lightning bolt down onto an angular shadow enemy.",
    "double_energy": "Two equally bright golden-blue energy cores shine above her two separate brass palms.",
    "streamline": "She flies forward along one straight blue circuit path with coat tails trailing and pointed boots.",
    "meteor_strike": "Three glowing orange meteors fall diagonally past her raised brass hand against a midnight blue sky.",
    "claw": "Close-up of her attached brass gauntlet with three short mechanical claws making one blue slashing arc.",
    "claw_claw_pack": "Her two brass clawed gauntlets cross in a clear X-shaped double slash against a violet enemy silhouette.",
    "barrage": "Three compact blue energy bolts fly in parallel from her outstretched brass gauntlet.",
    "go_for_the_eyes": "One precise gloved finger directs a narrow blue bolt at the glowing eye of a distant shadow enemy.",
    "beam_cell": "A small cylindrical brass cell projects a thin blue beam past her focused face.",
    "skim": "She rapidly sorts three glowing geometric projection panels with one connected brass hand.",
    "turbo": "Her brass boots and chest core flare blue as she leans into a fast forward sprint.",
}


def catalogue(owner):
    return json.loads((DOCS / f"{owner}-catalogue.json").read_text())


def record(path):
    return {
        "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def tile_box(index, size=(1536, 1024), inset=8):
    w, h = size
    x = index % 2 * w // 2
    y = index // 2 * h // 2
    return x + inset, y + inset, x + w // 2 - inset, y + h // 2 - inset


def prepare():
    kratos = json.loads((HERE / "plan.json").read_text())["cards"]
    for owner in ("ironclad", "defect"):
        cards = catalogue(owner)
        for first in range(0, len(cards), 4):
            batch = cards[first : first + 4]
            name = f"{owner}-{first // 4 + 1:02d}"
            ref = Image.new("RGB", (1536, 1024), "#171923")
            scenes = []
            for i, c in enumerate(batch):
                art = ROOT / f"public/assets/card-art/{owner}/{c['id']}.webp"
                im = (
                    Image.open(art)
                    if art.exists()
                    else Image.open(CARDS / f"{scan_key(c, False)}.webp")
                    .convert("RGB")
                    .resize(REF_SIZE)
                    .crop(WINDOW_BOX[c["type"]])
                )
                box = tile_box(i)
                ref.paste(
                    ImageOps.fit(
                        im, (box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS
                    ),
                    box[:2],
                )
                if owner == "ironclad":
                    scene = (
                        kratos[c["id"]]["scene"]
                        .replace("Kratos", "the adult red-haired Ironclad woman")
                        .replace("Blade of Chaos", "curved steel sword")
                        .replace("Blades of Chaos", "curved steel sword")
                        .replace("Blade of Athena", "curved steel sword")
                        .replace("Blades of Athena", "curved steel sword")
                        .replace("Greek", "ancient")
                        .replace("his", "her")
                        .replace("him", "her")
                        .replace("ash-white", "fair")
                        .replace("bald head", "crimson-haired head")
                        .replace("red tattoo", "red scarf")
                        .replace(
                            "Chains of her curved steel sword",
                            "leather straps of her gauntlets",
                        )
                        .replace(
                            "chain trailing off the edge",
                            "red scarf trailing off the edge",
                        )
                        .replace("chains snapping taut", "two clear slash trails")
                        .replace("chain looping around", "scarf looping around")
                        .replace("Blade of Olympus", "heavy curved steel sword")
                        .replace("God of War rage", "fiery demon rage")
                        .replace("Rage of Sparta", "demon rage")
                        .replace("Spartan", "warrior")
                        .replace("Nemean Cestus", "steel")
                        .replace("Ares", "a shadow demon")
                        .replace("Hydra", "serpent")
                        .replace("Gorgon", "serpent monster")
                        .replace("Medusa", "serpent monster")
                        .replace("Minotaur", "bull demon")
                        .replace("Undead Legionnaire", "armored shadow enemy")
                        .replace("Blades of Chaos", "curved steel sword")
                    )
                else:
                    scene = DEFECT_SCENES[c["id"]]
                scenes.append(
                    f"Panel {i + 1} (row {i // 2 + 1}, column {i % 2 + 1}), {c['name']}: {scene}"
                )
            refs = WORK / "refs"
            refs.mkdir(parents=True, exist_ok=True)
            ref.save(refs / f"{name}.png")
            identity = (
                "adult crimson-haired woman, ivory demon mask ornament, red scarf, practical black armor dress, covered leggings, brown gloves, heavy curved steel sword"
                if owner == "ironclad"
                else "adult turquoise bob-haired woman, emerald eyes, small brass temple plates, navy and cream mage coat, dark fitted bodysuit and covered legs, brass gloves, navy boots, small blue chest core"
            )
            prompt = "\n".join(
                [
                    "Use case: stylized-concept. Asset type: four distinct text-free Slay the Spire card illustrations in a precise extraction grid.",
                    "Images1-3 are the Monogatari anime STYLE AUTHORITY: elegant angular faces, expressive large eyes, crisp thin dark outlines, flat cel shading, bold theatrical geometric shadows, restrained highlights, no painterly texture or 3D rendering.",
                    f"Image4 is the IDENTITY AUTHORITY: {identity}. Preserve this original character, not a named Monogatari cast member.",
                    "Image5 is the ORIGINAL CARD ART semantic reference grid, in exactly the same 2-column by2-row order. Respect the meaning and focal gesture of each corresponding original panel, not its original rendering style.",
                    "Output EXACTLY 1536x1024 pixels: two equal columns768px wide and two equal rows512px high. Four rectangular panels occupy x0-768/768-1536 and y0-512/512-1024. Eight-pixel straight dark dividers on x768 and y512. No margin around the full sheet. Do not change panel widths/heights. No tilted panels, inset panels or overlapping elements. Keep every panel completely independent.",
                    "Each panel is its own richly composed anime scene with a distinct gesture, backdrop and color arrangement. Keep essential face, hands, weapon and focal objects within central75% of panel width and65% of height so a circular power mask remains readable. Calm margins. Avoid repeated standing poses; honor each card action.",
                    *scenes,
                    *(
                        [
                            f"Panel{i + 1}: unoccupied dark charcoal panel, no subject."
                            for i in range(len(batch), 4)
                        ]
                    ),
                    "Every depicted woman is visibly adult age21+, cute and battle-practical, no school uniform, no sexualization. Exactly two attached arms and legs per person, correct natural wrists, five fingers per visible hand, coherent closed sword grip. No extra limbs, severed joints, disconnected objects or distorted blades.",
                    "ABSOLUTELY NO text, letters, digits, captions, labels, card frames, rules, cost icons or watermarks anywhere. The descriptive card names above identify meaning only and must never be printed.",
                ]
            )
            p = ROOT / f"docs/monogatari-skins/prompts/cards/{name}.txt"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(prompt + "\n")
            SOURCE.mkdir(parents=True, exist_ok=True)
        print(owner, len(cards), "cards")


def masks():
    from build_masks import register, build_masks

    cards = catalogue("defect")
    matrices = {}
    scores = {}
    reference = {
        "attack": "defect__normal__ball-lightning",
        "skill": "defect__normal__coolheaded",
        "power": "defect__normal__loop",
    }
    for c in cards:
        for up in (False, True):
            key = scan_key(c, up)
            _, score, matrix = register(
                (key, reference[c["type"]] + ("+" if up else ""))
            )
            matrices[key] = matrix
            scores[key] = score
            print(key, round(score, 3), flush=True)
    (HERE / "defect-registration.json").write_text(
        json.dumps({k: m.flatten().tolist() for k, m in matrices.items()}, indent=1)
        + "\n"
    )
    report = []
    for (fam, kind, up), mask in build_masks(cards, matrices, report).items():
        # Color variation in Defect's banner tails can join the art component.
        # Restrict it to the proven matching physical template, allowing 2px
        # for genuine template geometry differences before per-scan registration.
        guard = (
            Image.open(HERE / f"masks/base-{kind}{'-up' if up else ''}.png")
            .convert("L")
            .filter(ImageFilter.MaxFilter(5))
        )
        mask = ImageChops.darker(mask.filter(ImageFilter.GaussianBlur(0.45)), guard)
        mask.save(HERE / f"masks/defect-{kind}{'-up' if up else ''}.png")
    (DOCS / "defect-mask-report.json").write_text(
        json.dumps(
            {
                "scores": scores,
                "groups": report,
                "shapeGuard": "Intersection with matching proven base-template mask grown 2px, applied after feathering, excludes banner-tail frame variance.",
                "maskBounds": {
                    p.name: list(Image.open(p).getbbox())
                    for p in (HERE / "masks").glob("defect*")
                },
            },
            indent=1,
        )
        + "\n"
    )


def bounded_art(im, path):
    im = ImageOps.fit(im.convert("RGB"), (748, 420), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    for q in range(90, 29, -5):
        im.save(path, "WEBP", quality=q, method=6)
        if path.stat().st_size <= 40960:
            return q
    raise ValueError(f"over budget {path}")


def export():
    for owner in ("ironclad", "defect"):
        skin = f"monogatari_{owner}"
        cards = catalogue(owner)
        entries = []
        faces = []
        contact = Image.new("RGB", (4 * 400, ((len(cards) + 3) // 4) * 260), "#10121b")
        draw = ImageDraw.Draw(contact)
        frame_contact = Image.new(
            "RGB", (8 * 224, ((len(cards) * 2 + 7) // 8) * 338), "#10121b"
        )
        fd = ImageDraw.Draw(frame_contact)
        for i, c in enumerate(cards):
            sheet = SOURCE / f"{owner}-{i // 4 + 1:02d}.png"
            im = Image.open(sheet)
            if im.size != (1536, 1024):
                raise ValueError(
                    f"Unexpected native sheet dimensions: {sheet}: {im.size}"
                )
            box = tile_box(i % 4, im.size)
            tile = im.crop(box)
            target = ROOT / f"public/assets/skin-card-art/{skin}/{owner}/{c['id']}.webp"
            q = bounded_art(tile, target)
            prompt = (
                ROOT
                / f"docs/monogatari-skins/prompts/cards/{owner}-{i // 4 + 1:02d}.txt"
            )
            entry = {k: c[k] for k in ("id", "name", "type")}
            entry.update(
                source=record(sheet),
                prompt=record(prompt),
                output=record(target),
                crop=list(box),
                webpQuality=q,
                originalArtwork=record(
                    ROOT / f"public/assets/card-art/{owner}/{c['id']}.webp"
                    if (
                        ROOT / f"public/assets/card-art/{owner}/{c['id']}.webp"
                    ).exists()
                    else CARDS / f"{scan_key(c, False)}.webp"
                ),
            )
            entries.append(entry)
            thumb = ImageOps.fit(tile, (400, 225))
            contact.paste(thumb, (i % 4 * 400, i // 4 * 260))
            draw.text((i % 4 * 400 + 6, i // 4 * 260 + 230), c["name"], fill="white")
            for up in (False, True):
                key = scan_key(c, up)
                for original_root, folder in (
                    (CARDS, "skin-cards"),
                    (THUMBS, "skin-cards-sm"),
                ):
                    original = Image.open(original_root / f"{key}.webp").convert("RGB")
                    composited = composite(original, tile, c, up)
                    out = ROOT / f"public/assets/{folder}/{skin}/{key}.webp"
                    out.parent.mkdir(parents=True, exist_ok=True)
                    composited.save(out, "WEBP", quality=90, method=6)
                    decoded = np.asarray(Image.open(out).convert("RGB"))
                    outside = window_alpha(c, up, original.size) == 0
                    if not np.array_equal(
                        np.asarray(composited)[outside], np.asarray(original)[outside]
                    ):
                        raise ValueError(
                            f"Protected pixels changed before encoding: {key}"
                        )
                    protected_diff = decoded[outside].astype(np.float64) - np.asarray(
                        original
                    )[outside].astype(np.float64)
                    budget = (160 if folder == "skin-cards" else 80) * 1024
                    if out.stat().st_size > budget:
                        raise ValueError(f"Face exceeds budget: {out}")
                    faces.append(
                        {
                            "key": key,
                            "upgraded": up,
                            "size": list(original.size),
                            "original": record(original_root / f"{key}.webp"),
                            "output": record(out),
                            "preencodeOutsideMaskMaxDiff": 0,
                            "postencodeOutsideMaskRMS": float(
                                np.sqrt(np.mean(protected_diff**2))
                            ),
                            "postencodeOutsideMaskMaxDiff": int(
                                np.max(np.abs(protected_diff))
                            ),
                        }
                    )
                    if folder == "skin-cards-sm":
                        j = i * 2 + int(up)
                        frame = ImageOps.contain(composited, (224, 313))
                        frame_contact.paste(frame, (j % 8 * 224, j // 8 * 338))
                        fd.text(
                            (j % 8 * 224 + 3, j // 8 * 338 + 316),
                            c["name"] + ("+" if up else ""),
                            fill="white",
                        )
            print(c["id"], flush=True)
        dest = ROOT / f"docs/skins/{skin}-card-art"
        dest.mkdir(parents=True, exist_ok=True)
        manifest = {
            "model": "gpt-image-2.5-sunburst",
            "quality": "high",
            "size": "1536x1024",
            "cardSize": [748, 420],
            "grid": [2, 2],
            "catalogue": record(DOCS / f"{owner}-catalogue.json"),
            "registration": record(
                HERE
                / (
                    "defect-registration.json"
                    if owner == "defect"
                    else "registration.json"
                )
            ),
            "masks": [
                record(
                    HERE
                    / f"masks/{'defect' if owner == 'defect' else 'base'}-{kind}{suffix}.png"
                )
                for kind in ("attack", "skill", "power")
                for suffix in ("", "-up")
            ],
            "references": [record(p) for p in [*STYLE, IDENTITY[owner]]],
            "cards": entries,
            "faces": faces,
            "protectedPixelCheck": "pre-encode RGB equals source scan exactly wherever soft mask is zero; delivery WebP quality90 uses the same bounded codec as Kratos; postencode protected RMS/max is reported perface",
        }
        (dest / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
        contact.save(WORK / f"{owner}-art-contact.jpg", quality=94)
        frame_contact.save(WORK / f"{owner}-faces-contact.jpg", quality=94)
        (DOCS / f"{owner}-coverage.json").write_text(
            json.dumps(
                {
                    "cards": len(entries),
                    "faces": len(faces),
                    "fullFaces": len(cards) * 2,
                    "thumbnails": len(cards) * 2,
                    "preencodeOutsideMaskMaxDiff": 0,
                    "postencodeMaxProtectedRMS": max(
                        f["postencodeOutsideMaskRMS"] for f in faces
                    ),
                    "fullAndThumbnail": True,
                },
                indent=1,
            )
            + "\n"
        )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["prepare", "masks", "export"])
    a = p.parse_args()
    globals()[a.action]()
