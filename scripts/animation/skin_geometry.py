"""Pose geometry shared by the skin attack tools (kratos.py bake, skin-attack.py measure/fixture)."""
from io import BytesIO

from PIL import Image

SOLE_BAND = 22
MIN_FOOT = 9  # thinner runs are a weapon butt or trailing cloth, not a foot


def solid_box(image):
    return image.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()


def foot_runs(image, box, height):
    """Solid column runs at least MIN_FOOT wide touching the ground band, left to right."""
    band = image.getchannel('A').point(lambda a: 255 if a > 64 else 0).crop((box[0], box[3] - height, box[2], box[3]))
    columns = [x for x in range(band.width) if band.crop((x, 0, x + 1, band.height)).getbbox()]
    runs = []
    for x in columns:
        if runs and x - runs[-1][1] <= 6:
            runs[-1][1] = x
        else:
            runs.append([x, x])
    return [(box[0] + a, box[0] + b) for a, b in runs if b - a + 1 >= MIN_FOOT]


def sole_width(image):
    first = foot_runs(image, solid_box(image), SOLE_BAND)[0]
    return first[1] - first[0] + 1


def rear_foot_centre(image, rows=SOLE_BAND):
    """Centre column of the leftmost (planted rear) sole in the lowest `rows` rows, in canvas pixels."""
    rear = foot_runs(image, solid_box(image), rows)[0]
    return (rear[0] + rear[1]) / 2


MIN_HOLD_MS = 45  # default `minHoldMs`: every drawing of a clock is shown at least this long
SHORT_HOLD_FLOOR_MS = 20  # a `shortHolds` flight drawing is never shorter than the shortest duration browsers honour


def hold_problems(config):
    """Drawings the clock shows for less than `minHoldMs` (default 45): on a device under ~50 fps they are skipped and the cut pops.

    The first key is the idle drawing already on screen, so its length is invisible. A flight drawing may be shorter only when the
    config's `shortHolds` lists it with a reason, it is also in `audit.airborne`, and it still lasts SHORT_HOLD_FLOOR_MS.
    """
    skin, keys = config['skin'], config['keys']
    minimum = config.get('minHoldMs', MIN_HOLD_MS)
    short = config.get('shortHolds', {})
    flight = config.get('audit', {}).get('airborne', {})
    times = [time for time, _ in keys] + [config['durationMs']]
    problems = [f'{skin}: shortHolds "{pose}" needs a reason' for pose, reason in short.items() if not str(reason).strip()]
    problems += [f'{skin}: shortHolds "{pose}" is not an airborne drawing (audit.airborne)' for pose in short if pose not in flight]
    for (start, pose), end in zip(keys[1:], times[2:]):
        hold = end - start
        if pose in short:
            if hold < SHORT_HOLD_FLOOR_MS:
                problems.append(f'{skin}: {pose} at {start}ms holds {hold}ms (a shortHolds drawing still needs {SHORT_HOLD_FLOOR_MS}ms)')
        elif hold < minimum:
            problems.append(f'{skin}: {pose} at {start}ms holds {hold}ms (minHoldMs {minimum}): lengthen it or list a flight drawing in shortHolds with a reason')
    return problems


def dump_config(config):
    """Skin attack config as JSON with short number/pose pairs kept on one line."""
    import json
    import re
    text = json.dumps(config, indent=2)
    pair = r'\[\s+(-?[\d.]+),\s+(-?[\d.]+|"[^"]*")\s+\]'
    return re.sub(pair, r'[\1, \2]', text) + '\n'


def sway(frame, angle, size, ground):
    return frame.rotate(angle, Image.Resampling.BICUBIC, center=(size / 2, ground))


def write_webp(path, image, *, check=False, **options):
    buffer = BytesIO()
    image.save(buffer, format='WEBP', **options)
    if check:
        assert path.read_bytes() == buffer.getvalue(), f'{path} is stale; rerun its bake'
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(buffer.getvalue())


def save_animation(path, frames, durations, loop, root, *, size, method=6, check=False):
    """Write an animated WebP; every frame must keep its drawing inside the canvas."""
    for frame in frames:
        box = solid_box(frame)
        assert box and min(box[0], box[1], size - box[2], size - box[3]) >= 4, (path, box)
    assert min(durations) >= 20, 'Browsers stretch frames shorter than 20ms'
    write_webp(path, frames[0], check=check, save_all=True, append_images=frames[1:], duration=durations,
               loop=loop, quality=88, method=method)
    print(f'{path.relative_to(root)}: {len(frames)} frames, {sum(durations)}ms')


def bake_rest_art(ready, config, out, root):
    """The animated idle loop, the reduced-motion hero cutout and the list icon from a skin's rest drawing.

    Eight slow, rigid sway drawings keep stature and weapon length constant. The inverse overscan
    gives reduced motion the same on-screen stature as the idle loop.
    """
    import math
    size, skin = config['canvas'], config['skin']
    frames = [sway(ready, .3 * math.sin(i * math.tau / 8), size, config['ground']) for i in range(8)]
    save_animation(out / f'animated/{skin}-idle.webp', frames, [400] * 8, 0, root, size=size)
    edge = round(size * config['displayScale'])
    full = ready.resize((edge, edge), Image.Resampling.LANCZOS)
    left, top = (edge - size) // 2, edge - size
    hero = full.crop((left, top, left + size, edge))
    hero.save(out / f'{skin}-hero.webp', quality=92, method=6)
    hero.resize((512, 512), Image.Resampling.LANCZOS).save(out / f'{skin}.webp', quality=90, method=6)
