#!/usr/bin/env python3
"""Generic attack-animation pose audit (config-driven); verify-art-bakes.mjs runs it for every skin with an `audit` block.

  python3 audit-poses.py SKIN [--root REPO] [--sheet OUT.png] [--no-sheet] [--report OUT.json]

Reads <root>/scripts/animation/skins/<SKIN>.json (the attack clock: canvas, ground, poseShift, keys) and every
drawing <root>/public/assets/combat/characters/animated/<SKIN>-<pose>.webp (the idle key is <SKIN>-ready.webp).
Tolerances and landmarks come from an optional "audit" object in that config, so nothing is hard-coded per skin:

  "audit": {
    "tolerances": {                       # every value optional; defaults below
      "headRatio": 0.10,                  # |head height / idle head height - 1|
      "propRatio": 0.10,                  # |prop length / idle prop length - 1| (every prop, by name)
      "soleRatio": 0.20,                  # |rear-sole width / idle rear-sole width - 1| (auto landmark)
      "soleDriftPx": 6,                   # planted rear sole after poseShift vs idle, canvas px
      "clipMarginPx": 4,                  # min gap between the solid drawing and the canvas edge
      "fringeShare": 0.02,                # max share of edge pixels that are pale semi-transparent halo
      "lonePixels": 40,                   # max area of a detached speck (excluding the 3 largest blobs)
      "ghostIou": 0.15,                   # cross-fade between two poses closer than this silhouette IoU...
      "ghostMaxMs": 90,                   # ...must be shown at least this long, else it flickers as a double image
      "lumaJump": 28,                     # max change in mean luminance of the solid pixels between neighbours
      "headStepPx": 120,                  # optional: max distance the head centre moves between consecutive drawings (a vertical head landmark needs "headX")
      "propStepPx": 160                   # optional: max distance either end (tip, butt) of any prop moves between consecutive drawings
      # "groundSpeedPxPerMs" (optional, same block) is enforced by verify-skin-attack-browser.mjs, not here: see docs/skins/attack-animation.md
    },
    "landmarks": {                        # hand-inspected, canvas px of the baked drawing, like kratos registration.json
      "idle":      {"head": [crownY, chinY], "props": {"blade": [[x0, y0], [x1, y1]]}},
      "left-cast": {"head": [crownY, chinY], "props": {"blade": [[x0, y0], [x1, y1]]}}
    },
    "skip": {"hoodTip": ["pose-name"], "props": ["pose-name"], "sole": ["pose-name"], "soleRatio": ["pose-name"]},   # hoodTip: the tip is covered by a billowing cloak, so it is not on the silhouette; props hidden/foreshortened; planted-sole checks off; rear sole width (toe-down or airborne boot) is not a scale cue
    "airborne": {"pose-name": 24}         # drawings that are deliberately lifted off the ground by this many canvas px (a leap)
  }

Hold: every drawing of the clock (config "keys") is shown at least config "minHoldMs" (default 45): shorter drawings are skipped on a
device under ~50 fps and the cut pops. Only a flight drawing in "audit.airborne" may be shorter (>= 20 ms), and only when the
config's "shortHolds" {pose: reason} lists it; the first idle key is the drawing already on screen and is exempt.

Per pose it measures: solid box, rear-sole width and the planted-sole drift after the pose's shift (auto), and
head height / prop length from landmarks (a pose with no landmark fails when "requireLandmarks" is true, the
default for new skins, so a person must inspect every drawing). It also fails canvas clipping, pale alpha
fringes, detached specks, and cross-fade flicker between consecutive keys. A filmstrip contact sheet (every key
in clock order on a checkerboard, with ground line, planted-sole mark, head/prop landmarks and measured numbers)
is written for human review: the audit supplements, never replaces, viewing every frame.
"""
import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat

from skin_geometry import foot_runs, hold_problems, solid_box

DEFAULTS = dict(headRatio=.10, propRatio=.10, soleRatio=.20, soleDriftPx=6, clipMarginPx=4, fringeShare=.02,
                lonePixels=40, ghostIou=.15, ghostMaxMs=90, lumaJump=28)
SOLE_BAND = 22
LANDMARK_SNAP = 10  # landmark endpoints must sit this close to solid pixels, or the drawing was rescaled after inspection


def solid(image, threshold=32):
    return image.getchannel('A').point(lambda a: 255 if a > threshold else 0)


def rear_sole(image, rows=SOLE_BAND):
    """(left, right, bottom) of the leftmost foot (a solid run at least MIN_FOOT wide, not a staff butt or cloth) in the lowest `rows` rows."""
    box = solid_box(image)
    left, right = foot_runs(image, box, rows)[0]
    return left, right, box[3]


def fringe_share(image):
    """Share of edge pixels (alpha 8..200 touching the silhouette border) that are pale: a white/grey halo."""
    rgba = image.convert('RGBA')
    alpha = rgba.getchannel('A')
    px, ap = rgba.load(), alpha.load()
    edge = pale = 0
    for y in range(1, rgba.height - 1, 1):
        for x in range(1, rgba.width - 1, 1):
            a = ap[x, y]
            if 8 < a < 200:
                edge += 1
                r, g, b, _ = px[x, y]
                if min(r, g, b) > 215:
                    pale += 1
    return pale / edge if edge else 0.0


def blobs(image):
    """Connected-component areas of the solid mask at 1/4 scale (area is scaled back up), largest first."""
    mask = solid(image).resize((image.width // 4, image.height // 4), Image.Resampling.BOX).point(lambda v: 255 if v > 40 else 0)
    px, w, h = mask.load(), mask.width, mask.height
    seen = bytearray(w * h)
    areas = []
    for y in range(h):
        for x in range(w):
            if px[x, y] and not seen[y * w + x]:
                stack, area = [(x, y)], 0
                seen[y * w + x] = 1
                while stack:
                    cx, cy = stack.pop()
                    area += 1
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1), (cx + 1, cy + 1), (cx - 1, cy - 1), (cx + 1, cy - 1), (cx - 1, cy + 1)):
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny * w + nx]:
                            seen[ny * w + nx] = 1
                            stack.append((nx, ny))
                areas.append(area * 16)
    return sorted(areas, reverse=True)


def luma(image):
    mask = image.getchannel('A').point(lambda a: 255 if a > 128 else 0)
    return ImageStat.Stat(image.convert('L'), mask).mean[0] if mask.getbbox() else 0


def shifted_mask(image, dx, dy):
    mask = solid(image)
    out = Image.new('L', mask.size)
    out.paste(mask, (round(dx), round(dy)))
    return out


def iou(a, b):
    inter = ImageChops.darker(a, b).histogram()[255]
    union = ImageChops.lighter(a, b).histogram()[255]
    return inter / union if union else 1.0


def head_length(head):
    """A head landmark is [crownY, chinY] (vertical) or [[x, y], [x, y]] (hood tip to chin, for a tilted head)."""
    if isinstance(head[0], (list, tuple)):
        return math.hypot(head[1][0] - head[0][0], head[1][1] - head[0][1])
    return head[1] - head[0]


def on_drawing(image, point, radius=LANDMARK_SNAP):
    """Whether a solid pixel (alpha > 32) lies within `radius` of the landmark: it was recorded on this drawing."""
    x, y = round(point[0]), round(point[1])
    box = (max(0, x - radius), max(0, y - radius), min(image.width, x + radius + 1), min(image.height, y + radius + 1))
    return box[0] < box[2] and box[1] < box[3] and solid(image.crop(box)).getbbox() is not None


def on_edge(image, point, snap=5):
    """A hood-tip landmark lies on the silhouette: solid and open pixels both within `snap` of it."""
    x, y = round(point[0]), round(point[1])
    box = (max(0, x - snap), max(0, y - snap), min(image.width, x + snap + 1), min(image.height, y + snap + 1))
    mask = solid(image.crop(box))
    return mask.getbbox() is not None and mask.getextrema()[0] == 0


def distance(p, q):
    return math.hypot(p[0] - q[0], p[1] - q[1])


def head_point(mark):
    """Centre of the head landmark: a tilted head is [[x, y], [x, y]] (hood tip to chin); a vertical one is [crownY, chinY] plus `headX`."""
    head = mark.get('head')
    if not head:
        return None
    if isinstance(head[0], (list, tuple)):
        return [(head[0][0] + head[1][0]) / 2, (head[0][1] + head[1][1]) / 2]
    return [mark['headX'], (head[0] + head[1]) / 2] if 'headX' in mark else None


def landmark_steps(a, b, shift_a, shift_b, tol):
    """How far the head and every prop endpoint jump between two consecutive drawings (canvas px, after planting shifts)."""
    out = {'errors': []}
    pa, pb = head_point(a), head_point(b)
    if pa and pb:
        step = distance([pa[0] + shift_a, pa[1]], [pb[0] + shift_b, pb[1]])
        out['headStep'] = step
        if 'headStepPx' in tol and step > tol['headStepPx']:
            out['errors'].append(f'the head jumps {step:.0f}px between consecutive drawings (tolerance {tol["headStepPx"]}): add an in-between drawing')
    for name, pts in a.get('props', {}).items():
        other = b.get('props', {}).get(name)
        if not other:
            continue
        for end, (p, q) in zip(('tip', 'butt'), zip(pts, other)):
            step = distance([p[0] + shift_a, p[1]], [q[0] + shift_b, q[1]])
            out['propStep'] = max(out.get('propStep', 0), step)
            if 'propStepPx' in tol and step > tol['propStepPx']:
                    out['errors'].append(f'the {name} {end} jumps {step:.0f}px between consecutive drawings (tolerance {tol["propStepPx"]}): add an in-between drawing')
    return out


def audit(config, directory, tolerances=None):
    audit_cfg = config.get('audit', {})
    tol = {**DEFAULTS, **audit_cfg.get('tolerances', {}), **(tolerances or {})}
    marks = audit_cfg.get('landmarks', {})
    require = audit_cfg.get('requireLandmarks', True)
    skip_props = set(audit_cfg.get('skip', {}).get('props', []))
    skin, size = config['skin'], config['canvas']
    keys = config['keys']
    poses = list(dict.fromkeys(pose for _, pose in keys))
    images = {pose: Image.open(directory / f'{skin}-{"ready" if pose == "idle" else pose}.webp').convert('RGBA') for pose in poses}
    errors, rows = hold_problems(config), {}
    worst = {}  # the largest value measured against each cap (the documented maxima verify-art-bakes ratchets), by tolerance name

    def note(name, value):
        worst[name] = max(worst.get(name, 0), round(value, 3))

    shift = config.get('poseShift', {})
    idle = images['idle']
    measure = config.get('measure', {})
    idle_rows, pose_rows = measure.get('idleRows', SOLE_BAND), measure.get('poseRows', SOLE_BAND)
    unplanted = set(measure.get('unplanted', []))
    idle_sole = rear_sole(idle, idle_rows)
    # Widths compare like with like: the idle is measured over the same rows as every other drawing (its position uses idleRows).
    idle_wide = rear_sole(idle, pose_rows)
    idle_width = idle_wide[1] - idle_wide[0] + 1
    idle_mark = marks.get('idle', {})
    idle_head = head_length(idle_mark['head']) if 'head' in idle_mark else None
    idle_props = {name: distance(*pts) for name, pts in idle_mark.get('props', {}).items()}
    if require and (idle_head is None):
        errors.append('idle: no head landmark in audit.landmarks.idle.head')
    for pose, image in images.items():
        row = rows[pose] = {}
        if image.size != (size, size):
            errors.append(f'{pose}: drawing is {image.size}, canvas is {size}')
        box = solid(image).getbbox()
        row['box'] = box
        margin = min(box[0], box[1], image.width - box[2], image.height - box[3])
        row['margin'] = margin
        if margin < tol['clipMarginPx']:
            errors.append(f'{pose}: solid drawing is {margin}px from the canvas edge (min {tol["clipMarginPx"]}): clipped or about to clip')
        left, right, bottom = rear_sole(image, idle_rows if pose == 'idle' else pose_rows)
        wide = rear_sole(image, pose_rows)
        width = wide[1] - wide[0] + 1
        row['soleWidth'] = width
        row['soleRatio'] = round(width / idle_width, 3)
        sole_checked = pose not in audit_cfg.get('skip', {}).get('soleRatio', []) and pose not in unplanted
        if sole_checked:
            note('soleRatio', abs(width / idle_width - 1))
        if abs(width / idle_width - 1) > tol['soleRatio'] and sole_checked:
            errors.append(f'{pose}: rear sole {width}px vs idle {idle_width}px (ratio {width / idle_width:.2f}, tolerance {tol["soleRatio"]}): body scale drift')
        drift = ((left + right) / 2 + 0) - ((idle_sole[0] + idle_sole[1]) / 2)
        # the CSS shifts a pose horizontally by poseShift (canvas px); the planted sole must land on the idle sole
        planted = drift + shift.get(pose, 0)
        row['soleDrift'] = round(planted, 1)
        row['groundDrift'] = bottom - idle_sole[2]
        if config.get('plantedSole', True) and pose not in audit_cfg.get('skip', {}).get('sole', []):
            if pose not in unplanted and abs(planted) > tol['soleDriftPx']:
                errors.append(f'{pose}: planted rear sole is {planted:+.1f}px from the idle sole after poseShift {shift.get(pose, 0)} (tolerance {tol["soleDriftPx"]})')
            lift = audit_cfg.get('airborne', {}).get(pose, 0)
            if abs(row['groundDrift'] + lift) > tol['soleDriftPx'] * 2:
                errors.append(f'{pose}: lowest drawn row is {row["groundDrift"]:+d}px from the idle ground (declared airborne lift {lift}px): feet float or sink')
        mark = marks.get(pose, {})
        if 'head' in mark and idle_head:
            head = head_length(mark['head'])
            if isinstance(mark['head'][0], (list, tuple)) and pose not in audit_cfg.get('skip', {}).get('hoodTip', []) and not (on_edge(image, mark['head'][0]) and on_drawing(image, mark['head'][1])):
                errors.append(f'{pose}: head landmark {mark["head"]} is not on the drawing (the hood tip sits on the silhouette, the chin on solid pixels): the drawing changed after the landmarks were inspected')
            row['headRatio'] = round(head / idle_head, 3)
            note('headRatio', abs(head / idle_head - 1))
            if abs(head / idle_head - 1) > tol['headRatio']:
                errors.append(f'{pose}: head {head}px vs idle {idle_head}px (ratio {head / idle_head:.2f}, tolerance {tol["headRatio"]})')
        elif require and pose != 'idle':
            errors.append(f'{pose}: no head landmark (audit.landmarks["{pose}"].head); inspect the drawing and record crown/chin y')
        for name, length0 in idle_props.items():
            if pose in skip_props:
                continue
            pts = mark.get('props', {}).get(name)
            if pts is None:
                if require and pose != 'idle':
                    errors.append(f'{pose}: no landmark for prop "{name}" (list it in "skip.props" if it is out of frame or foreshortened)')
                continue
            length = distance(*pts)
            row.setdefault('props', {})[name] = round(length / length0, 3)
            note('propRatio', abs(length / length0 - 1))
            if not all(on_drawing(image, point) for point in pts):
                errors.append(f'{pose}: prop "{name}" landmark {pts} is not on the drawing (no solid pixel within {LANDMARK_SNAP}px): the drawing changed after the landmarks were inspected')
            if abs(length / length0 - 1) > tol['propRatio']:
                errors.append(f'{pose}: prop "{name}" {length:.0f}px vs idle {length0:.0f}px (ratio {length / length0:.2f}, tolerance {tol["propRatio"]})')
        row['fringe'] = round(fringe_share(image), 4)
        if row['fringe'] > tol['fringeShare']:
            errors.append(f'{pose}: {row["fringe"]:.1%} of the alpha edge is pale halo (tolerance {tol["fringeShare"]:.0%}): matte the drawing')
        areas = blobs(image)
        specks = [area for area in areas[3:] if area > 0]
        row['specks'] = len(specks)
        if specks and max(specks) > tol['lonePixels'] and config.get('detachedSpecks', 'error') == 'error':
            errors.append(f'{pose}: {len(specks)} detached blobs (largest {max(specks)}px) beyond the three main parts: stray marks or a detached limb/prop')
        row['luma'] = round(luma(image), 1)
    times = [t for t, _ in keys]
    ends = times[1:] + [config['durationMs']]
    flicker = []
    for index, ((start, pose), end) in enumerate(zip(keys, ends)):
        nxt = keys[(index + 1) % len(keys)][1]
        if nxt == pose:
            continue
        a = shifted_mask(images[pose], shift.get(pose, 0), 0)
        b = shifted_mask(images[nxt], shift.get(nxt, 0), 0)
        overlap = iou(a, b)
        gap = end - start
        flicker.append((pose, nxt, round(overlap, 3), gap))
        if overlap < tol['ghostIou'] and gap < tol['ghostMaxMs']:
            errors.append(f'{pose} -> {nxt}: silhouettes overlap {overlap:.2f} and {pose} shows only {gap}ms: the cross-fade reads as a double image')
        step_errors = landmark_steps(marks.get(pose, {}), marks.get(nxt, {}), shift.get(pose, 0), shift.get(nxt, 0), tol)
        if 'headStep' in step_errors:
            rows[pose]['headStep'] = round(step_errors['headStep'], 1)
            note('headStepPx', step_errors['headStep'])
        if 'propStep' in step_errors:
            rows[pose]['propStep'] = round(step_errors['propStep'], 1)
            note('propStepPx', step_errors['propStep'])
        for message in step_errors.get('errors', []):
            errors.append(f'{pose} -> {nxt}: {message}')
        jump = abs(rows[pose]['luma'] - rows[nxt]['luma'])
        if jump > tol['lumaJump']:
            errors.append(f'{pose} -> {nxt}: mean luminance jumps {jump:.0f} (tolerance {tol["lumaJump"]}): colour drift or lighting flicker')
    return errors, rows, flicker, images, marks, worst


def sheet(config, rows, images, marks, path, cell=360):
    keys = config['keys']
    columns = min(6, len(keys))
    rows_n = math.ceil(len(keys) / columns)
    out = Image.new('RGB', (columns * cell, rows_n * (cell + 46)), (30, 30, 36))
    idle = images['idle']
    sole0 = rear_sole(idle)
    boxes = [solid(image).getbbox() for image in images.values()]
    pad = 24
    view = (max(0, min(b[0] for b in boxes) - pad), max(0, min(b[1] for b in boxes) - pad),
            min(idle.width, max(b[2] for b in boxes) + pad), min(idle.height, max(b[3] for b in boxes) + pad))
    side = max(view[2] - view[0], view[3] - view[1])
    view = (view[0], max(0, view[3] - side), view[0] + side, view[3])
    for i, (time, pose) in enumerate(keys):
        image = images[pose]
        cx, cy = (i % columns) * cell, (i // columns) * (cell + 46)
        tile = Image.new('RGBA', image.size, (200, 200, 205, 255))
        step = 32
        draw = ImageDraw.Draw(tile)
        for y in range(0, image.height, step):
            for x in range(0, image.width, step):
                if (x // step + y // step) % 2:
                    draw.rectangle([x, y, x + step, y + step], fill=(170, 170, 176, 255))
        tile.alpha_composite(image)
        draw = ImageDraw.Draw(tile)
        shift_x = config.get('poseShift', {}).get(pose, 0)
        draw.line([0, sole0[2], image.width, sole0[2]], fill=(255, 0, 0, 255), width=2)
        draw.line([(sole0[0] + sole0[1]) / 2 - shift_x, 0, (sole0[0] + sole0[1]) / 2 - shift_x, image.height], fill=(0, 120, 255, 255), width=2)
        mark = marks.get(pose, {})
        if 'head' in mark and isinstance(mark['head'][0], (list, tuple)):
            draw.line([tuple(mark['head'][0]), tuple(mark['head'][1])], fill=(0, 200, 0, 255), width=3)
        elif 'head' in mark:
            draw.line([0, mark['head'][0], 80, mark['head'][0]], fill=(0, 200, 0, 255), width=3)
            draw.line([0, mark['head'][1], 80, mark['head'][1]], fill=(0, 200, 0, 255), width=3)
        for pts in mark.get('props', {}).values():
            draw.line([tuple(pts[0]), tuple(pts[1])], fill=(255, 0, 255, 255), width=4)
        out.paste(tile.convert('RGB').crop(view).resize((cell, cell), Image.Resampling.LANCZOS), (cx, cy))
        row = rows[pose]
        label = f'{i + 1}. {pose} @{time}ms sole x{row["soleRatio"]}'
        if 'headRatio' in row:
            label += f' head x{row["headRatio"]}'
        if 'props' in row:
            label += ' ' + ' '.join(f'{k} x{v}' for k, v in row['props'].items())
        ImageDraw.Draw(out).text((cx + 6, cy + cell + 6), label, fill=(240, 240, 240))
        ImageDraw.Draw(out).text((cx + 6, cy + cell + 22), 'red=idle ground, blue=planted sole, green=head, magenta=prop', fill=(150, 150, 160))
    out.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('skin')
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument('--config', help='skin config JSON (default: <root>/scripts/animation/skins/<skin>.json)')
    parser.add_argument('--dir', help='drawing directory (default: <root>/public/assets/combat/characters/animated)')
    parser.add_argument('--sheet', help='filmstrip PNG (default: <root>/artifacts/skin-art/<skin>-filmstrip.png)')
    parser.add_argument('--no-sheet', action='store_true')
    parser.add_argument('--report')
    parser.add_argument('--tol', action='append', default=[], metavar='NAME=VALUE', help='override one tolerance')
    parser.add_argument('--lenient', action='store_true', help='do not require landmarks on every pose (auto metrics only)')
    args = parser.parse_args()
    root = Path(args.root)
    config = json.loads(Path(args.config or root / f'scripts/animation/skins/{args.skin}.json').read_text())
    if args.lenient:
        config.setdefault('audit', {})['requireLandmarks'] = False
    directory = Path(args.dir or root / 'public/assets/combat/characters/animated')
    tolerances = {k: float(v) for k, v in (item.split('=') for item in args.tol)}
    errors, rows, flicker, images, marks, worst = audit(config, directory, tolerances)
    if not args.no_sheet:
        path = Path(args.sheet or root / f'artifacts/skin-art/{args.skin}-filmstrip.png')
        path.parent.mkdir(parents=True, exist_ok=True)
        sheet(config, rows, images, marks, path)
        print(f'filmstrip: {path}')
    if args.report:
        Path(args.report).write_text(json.dumps(dict(errors=errors, poses=rows, transitions=flicker, measured=worst), indent=2, default=list))
    for pose, row in rows.items():
        print(f'{pose:16} box={row["box"]} margin={row["margin"]} sole x{row["soleRatio"]} drift={row["soleDrift"]} fringe={row["fringe"]} specks={row["specks"]}'
              + (f' head x{row["headRatio"]}' if 'headRatio' in row else '') + (f' props {row["props"]}' if 'props' in row else ''))
    for line in errors:
        print('FAIL', line)
    print('measured maxima: ' + ', '.join(f'{name} {value}' for name, value in sorted(worst.items())))
    print(f'{len(rows)} drawings, {len(errors)} failures')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
