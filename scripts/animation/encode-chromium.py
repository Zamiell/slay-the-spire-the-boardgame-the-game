#!/usr/bin/env python3
"""Build and audit transparent VP9 idle companions without altering WebP fallbacks."""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'public/assets/combat/rigged'
VIDEOS = ROOT / 'public/assets/combat/rigged-webm'
POSTERS = ROOT / 'public/assets/combat/rigged-posters'
MANIFEST = ROOT / 'src/ui/combat-webm-sources.json'
ENCODER = 'vp9-alpha-lossless-yuva420p-vfr-v1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(source, video, poster):
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries',
        'stream=width,height,codec_name:stream_tags=alpha_mode:packet=pts_time', '-of', 'json', str(video),
    ]))
    with Image.open(source) as animation, Image.open(poster) as still:
        width, height = animation.size
        assert still.n_frames == 1 and still.convert('RGBA').tobytes() == animation.convert('RGBA').tobytes(), f'{source.name}: poster differs'
        stream = probe['streams'][0]
        assert (stream['width'], stream['height'], stream['codec_name'], stream['tags']['alpha_mode']) == (width, height, 'vp9', '1'), f'{source.name}: invalid video format'
        frame_size = width * height * 4
        decoder = subprocess.Popen([
            'ffmpeg', '-v', 'error', '-threads', '2', '-c:v', 'libvpx-vp9', '-i', str(video),
            '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
        ], stdout=subprocess.PIPE)
        def read_frame():
            data = bytearray()
            while len(data) < frame_size:
                block = decoder.stdout.read(frame_size - len(data))
                if not block:
                    break
                data.extend(block)
            return bytes(data)
        starts, durations = [], []
        maximum_alpha = worst_mean = worst_large = 0
        try:
            for index in range(animation.n_frames):
                animation.seek(index)
                reference = np.asarray(animation.convert('RGBA'))
                raw = read_frame()
                assert len(raw) == frame_size, f'{source.name}: missing frame {index}'
                decoded = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 4)
                delta = np.abs(reference.astype(np.int16) - decoded.astype(np.int16))
                visible = reference[:, :, 3] > 128
                assert not np.any(decoded[:, :, 3][reference[:, :, 3] == 0]), f'{source.name}: transparent pixels changed in frame {index}'
                assert np.all(decoded[:, :, 3][reference[:, :, 3] == 255] == 255), f'{source.name}: opaque pixels changed in frame {index}'
                maximum_alpha = max(maximum_alpha, int(delta[:, :, 3].max()))
                if visible.any():
                    worst_mean = max(worst_mean, float(delta[:, :, :3][visible].mean()))
                    worst_large = max(worst_large, float((delta[:, :, :3][visible] > 20).mean()))
                starts.append(sum(durations))
                durations.append(animation.info['duration'])
            assert len(read_frame()) == frame_size and decoder.stdout.read(1) == b'', f'{source.name}: invalid final hold'
            assert decoder.wait() == 0, f'{source.name}: video decode failed'
        except BaseException:
            decoder.kill()
            decoder.wait()
            raise
        assert [round(float(packet['pts_time']) * 1000) for packet in probe['packets']] == [*starts, sum(durations)], f'{source.name}: frame timing changed'
        # 4:2:0 conversion can round an intermediate alpha by one level; endpoints remain exact.
        assert maximum_alpha <= 1 and worst_mean < 4 and worst_large < .04, f'{source.name}: visible quality changed ({maximum_alpha}, {worst_mean}, {worst_large})'
        return {'width': width, 'height': height, 'sourceFrames': len(durations), 'durationMs': sum(durations), 'durationsMs': durations}


def encode(source, video, poster):
    scratch = Path.home() / '.cache/task-tmp'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='combat-webm-', dir=scratch) as directory:
        directory = Path(directory)
        concat = ['ffconcat version 1.0']
        with Image.open(source) as animation:
            animation.convert('RGBA').save(poster, lossless=True, quality=0, method=0, exact=True)
            for index, frame in enumerate(ImageSequence.Iterator(animation)):
                name = f'{index:05}.png'
                frame.convert('RGBA').save(directory / name)
                concat.extend((f"file '{name}'", 'option framerate 1000', f"duration {frame.info['duration'] / 1000:.3f}"))
            concat.extend((f"file '{animation.n_frames - 1:05}.png'", 'option framerate 1000'))
        (directory / 'frames.ffconcat').write_text('\n'.join(concat) + '\n')
        subprocess.run([
            'ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(directory / 'frames.ffconcat'),
            '-fps_mode', 'vfr', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-lossless', '1',
            '-auto-alt-ref', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5', '-threads', '2', '-g', '45', str(video),
        ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='*', type=Path)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--rigs', help='only registered idle companions for these comma-separated rigs')
    args = parser.parse_args()
    records = json.loads(MANIFEST.read_text())
    files = [path if path.is_absolute() else ROOT / path for path in args.files] or [SOURCES / f'{name}.webp' for name in records]
    if args.rigs:
        rigs = set(args.rigs.split(','))
        files = [path for path in files if path.stem.removesuffix('-idle') in rigs]
    elif not files:
        parser.error('no registered companions to verify')
    if not args.check:
        VIDEOS.mkdir(exist_ok=True)
        POSTERS.mkdir(exist_ok=True)
    for source in files:
        if source.resolve().parent != SOURCES.resolve() or not source.name.endswith('-idle.webp'):
            parser.error(f'expected a rigged idle source, got {source}')
        video, poster = VIDEOS / f'{source.stem}.webm', POSTERS / source.name
        record = records.get(source.stem)
        if not args.check and not (record and record.get('encoder') == ENCODER and record.get('source') == digest(source)
                                   and video.exists() and record.get('video') == digest(video) and poster.exists() and record.get('poster') == digest(poster)):
            encode(source, video, poster)
        details = verify(source, video, poster)
        actual = {**details, 'source': digest(source), 'video': digest(video), 'poster': digest(poster), 'encoder': ENCODER}
        if args.check:
            assert record == actual, f'{source.name}: stale companion manifest'
        else:
            records[source.stem] = actual
        print(f'{source.stem}: {details["sourceFrames"]} frames, alpha, colour and timing verified', flush=True)
    if not args.check:
        temporary = MANIFEST.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(dict(sorted(records.items())), indent=2) + '\n')
        temporary.replace(MANIFEST)


if __name__ == '__main__':
    main()
