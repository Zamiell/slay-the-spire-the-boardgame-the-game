#!/usr/bin/env python3
"""Deterministic original combat effects; requires NumPy and FFmpeg.

Usage: generate-combat-sfx.py [name-prefix ...]. With prefixes only the matching files are
written (every sound is still built so the random stream never changes), e.g. `monogatari_`.
"""
from pathlib import Path
import subprocess
import sys
import tempfile
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/sfx'
RATE = 48000
rng = np.random.default_rng(20260917)
ONLY = tuple(sys.argv[1:])


def noise(n, smooth=1):
    values = rng.standard_normal(n)
    if smooth > 1:
        values = np.convolve(values, np.ones(smooth) / smooth, mode='same')
    return values / max(np.std(values), .001)


def tone(t, start, end, duration):
    return np.sin(2 * np.pi * (start * t + (end - start) * t * t / (2 * duration)))


def render(name, duration, build, echoes=()):
    t = np.arange(round(duration * RATE)) / RATE
    signal = build(t)
    for delay, gain in echoes:
        offset = round(delay * RATE)
        signal[offset:] += signal[:-offset].copy() * gain
    # Remove DC and taper both boundaries; no clipping or start/end clicks.
    signal -= signal.mean()
    edge = min(240, len(signal) // 10)
    signal[:48] *= np.linspace(0, 1, 48)
    signal[-edge:] *= np.linspace(1, 0, edge)
    signal = np.tanh(signal * .65)
    signal *= .78 / max(np.max(np.abs(signal)), .001)
    if ONLY and not name.startswith(ONLY):
        return
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / 'source.wav'
        with wave.open(str(source), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes((signal * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-c:a', 'libmp3lame', '-q:a', '4', str(OUT / f'{name}.mp3')], check=True)
    print(f'{name}: {duration:.2f}s')


render('gunshot', .24, lambda t: noise(len(t)) * np.exp(-t * 105) * 2.2
       + noise(len(t), 32) * np.exp(-t * 22) * .9
       + tone(t, 150, 48, .24) * np.exp(-t * 24), [(0.024, .25), (.052, .10)])
render('bullet-impact', .17, lambda t: noise(len(t)) * np.exp(-t * 90)
       + tone(t, 380, 85, .17) * np.exp(-t * 48) * .65)
render('meteor-fall', .5, lambda t: noise(len(t), 18) * (.12 + t * 2) * .8
       + noise(len(t), 160) * t * 1.3
       + tone(t, 210, 950, .5) * t * .12)
render('meteor-impact', .85, lambda t: noise(len(t), 65) * np.exp(-t * 8) * 1.5
       + noise(len(t)) * np.exp(-t * 32) * .8
       + tone(t, 95, 28, .85) * np.exp(-t * 9)
       + noise(len(t), 6) * np.exp(-t * 9) * np.maximum(0, np.sin(t * 105)) * .35,
       [(.075, .24), (.16, .12)])
render('sword-swing', .32, lambda t: (noise(len(t), 3) - noise(len(t), 55) * .22)
       * np.sin(np.pi * t / .32) ** 2 * (.5 + t)
       + tone(t, 900, 180, .32) * np.sin(np.pi * t / .32) ** 3 * .07)
render('sword-clash', .46, lambda t: noise(len(t)) * np.exp(-t * 130) * 1.3
       + sum(np.sin(2 * np.pi * frequency * t) * np.exp(-t * decay) * gain
             for frequency, decay, gain in [(1463, 17, .23), (2381, 22, .16), (3749, 28, .11), (691, 13, .22)])
       + noise(len(t), 35) * np.exp(-t * 32) * .45, [(.038, .16)])
render('lightning-burst', .38, lambda t: noise(len(t)) * np.exp(-t * 12)
       * (.25 + .75 * np.maximum(0, np.sin(t * 420)) ** 3)
       + noise(len(t), 80) * np.exp(-t * 13) * .7
       + tone(t, 1600, 180, .38) * np.exp(-t * 24) * .09, [(.032, .15)])
render('dark-beam', .55, lambda t: (tone(t, 165, 47, .55) * .55
       + tone(t, 171, 50, .55) * .3 + noise(len(t), 14) * .22)
       * np.sin(np.pi * t / .55) ** .6 + noise(len(t)) * np.exp(-t * 65) * .3,
       [(.055, .17)])
render('frost-bloom', .55, lambda t: sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) * g
       for f, d, g in [(1847, 12, .18), (2939, 15, .16), (4133, 19, .09)])
       + noise(len(t)) * np.exp(-t * 13) * .35
       + noise(len(t), 32) * np.sin(np.pi * t / .55) * .22, [(.048, .23)])
render('flame-burst', .48, lambda t: noise(len(t), 28) * np.sin(np.pi * t / .48) ** .7
       + noise(len(t)) * np.exp(-t * 18) * .25
       + tone(t, 110, 40, .48) * np.exp(-t * 12) * .25)
render('slime-splat', .30, lambda t: sum(tone(np.maximum(0, t - d), f, 45, .30)
       * np.exp(-np.maximum(0, t - d) * 30) * (t >= d) * .3
       for d, f in [(0, 330), (.027, 470), (.062, 250), (.1, 570)])
       + noise(len(t), 12) * np.exp(-t * 19) * .5)
render('poison-hiss', .45, lambda t: noise(len(t), 4) * np.sin(np.pi * t / .45) * .45
       + tone(t, 650, 95, .45) * np.exp(-t * 17) * .16)

# Greek chain blades: metallic links, a short fiery cut and a heavy ground shock.
render('kratos-chain', .29, lambda t: noise(len(t), 4) * np.sin(np.pi * t / .29) ** 2 * .65
       + sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) * g
             for f, d, g in [(1861, 23, .12), (2797, 31, .09), (4139, 35, .06)]), [(.034, .12)])
render('kratos-light', .27, lambda t: noise(len(t)) * np.exp(-t * 60) * .85
       + tone(t, 740, 190, .27) * np.exp(-t * 24) * .25
       + noise(len(t), 18) * np.exp(-t * 18) * .4, [(.026, .14)])
render('kratos-slam', .86, lambda t: tone(t, 88, 24, .86) * np.exp(-t * 7) * 1.4
       + noise(len(t), 70) * np.exp(-t * 6) * 1.1
       + noise(len(t)) * np.exp(-t * 65) * .75
       + noise(len(t), 8) * np.exp(-t * 11) * np.maximum(0, np.sin(t * 140)) * .35,
       [(.068, .25), (.15, .13)])

# Monogatari skins: a poison-dagger rogue and a staff-wielding seer. Each file starts on its
# animation beat (the first transient lands inside ~3 ms) and has its own random stream, so
# the Kratos and older sounds above stay byte-identical whatever is added here.
rng = np.random.default_rng(20261011)


def band(n, low, high):
    """White noise through a smooth FFT band-pass, scaled to unit deviation."""
    spectrum = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= np.clip((f - low) / (.25 * low + 1), 0, 1) * np.clip((high - f) / (.25 * high + 1), 0, 1)
    values = np.fft.irfft(spectrum, n)
    return values / max(np.std(values), 1e-6)


def swept(t, start, end, q, span=None):
    """Noise through a resonant band-pass whose centre glides from start to end Hz over `span` seconds."""
    n = len(t)
    centre = start * (end / start) ** np.minimum(t / (span or t[-1]), 1)
    coef = 2 * np.sin(np.pi * centre / RATE)
    x = rng.standard_normal(n)
    out = np.empty(n)
    low = mid = 0.0
    for i in range(n):
        low += coef[i] * mid
        mid += coef[i] * (x[i] - low - mid / q)
        out[i] = mid
    return out / max(np.std(out), 1e-6)


def ring(t, partials, delay=0.0):
    """Struck partials (hertz, decay per second, gain) starting `delay` seconds in."""
    u = np.maximum(0, t - delay)
    return sum(np.sin(2 * np.pi * f * u) * np.exp(-u * d) * g for f, d, g in partials) * (t >= delay)


def attack(t, seconds):
    """Smooth rise over `seconds`, then 1."""
    return np.sin(np.pi / 2 * np.clip(t / seconds, 0, 1)) ** 2


# Silent: a whisper of blade (it crests ~110 ms in, just ahead of the 120 ms-later stab), a wet stab tick, a rising slice, a cloak flutter.
render('monogatari_silent-whisper', .28, lambda t: (swept(t, 3500, 5000, 3) * .5
       + ring(t, [(3200, 0, .09), (4870, 0, .05)]))
       * np.where(t < .11, np.sin(np.pi * t / .22) ** 2, np.cos(np.pi * (t - .11) / .34) ** 2))
render('monogatari_silent-stab', .16, lambda t: band(len(t), 1800, 14000) * np.exp(-t * 80) * 1.1
       + tone(t, 140, 60, .16) * np.exp(-t * 30) * .8
       + ring(t, [(2650, 55, .18)])
       + band(len(t), 6000, 16000) * (t > .008) * (t < .088) * np.exp(-(t - .008) * 28)
       * (.45 + .55 * np.abs(band(len(t), 40, 400))) * .5)
render('monogatari_silent-slash', .26, lambda t: swept(t, 2000, 6000, 2.5, .1)
       * attack(t, .012) * np.exp(-t * 15) * .9
       + ring(t, [(2400, 22, .2), (3590, 30, .09)], .04)
       + band(len(t), 2500, 12000) * np.exp(-t * 150) * .35)
render('monogatari_silent-cloak', .4, lambda t: band(len(t), 120, 900) * attack(t, .012) * np.exp(-t * 9)
       * (.55 + .45 * np.sin(2 * np.pi * 22 * t + 1.6 * np.sin(2 * np.pi * 3.1 * t))))

# Watcher: a staff swish with a faint gold ring, a wooden thrust with a bell-metal ring-out,
# and a lighter tap with a glassy chime. The swish peaks ~45 ms in, so cued 40 ms before a
# strike it crests with the strike.
render('monogatari_watcher-whoosh', .25, lambda t: (swept(t, 1100, 3200, 1.6) * .55
       + band(len(t), 250, 800) * .3) * np.where(t < .045, np.sin(np.pi * t / .09) ** 2, np.exp(-(t - .045) * 16))
       + ring(t, [(2637, 17, .05), (3951, 21, .03), (5300, 26, .02)], .035))
render('monogatari_watcher-thrust', .5, lambda t: band(len(t), 900, 7000) * np.exp(-t * 110) * 1.0
       + tone(t, 190, 118, .5) * np.exp(-t * 42) * .9
       + ring(t, [(430, 48, .35), (790, 58, .22), (1260, 70, .12)])
       + ring(t, [(659, 7, .12), (1318, 6, .3), (1568, 7.5, .16), (1976, 8, .13), (2637, 9, .1), (3480, 12, .05)]),
       [(.045, .1)])
render('monogatari_watcher-chime', .35, lambda t: band(len(t), 1500, 8000) * np.exp(-t * 170) * .5
       + tone(t, 360, 300, .35) * np.exp(-t * 75) * .3
       + ring(t, [(2794, 11, .24), (2798, 13, .12), (4186, 14, .18), (6272, 20, .09)]), [(.06, .2)])
