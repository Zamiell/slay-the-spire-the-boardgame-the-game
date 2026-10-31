"""Generate an original coin pickup jingle without samples or external tools.

Run: python3 scripts/audio/generate-gold-sfx.py
Replace public/assets/sfx/gold.wav to change the sound without changing playback.
"""

import math
import random
import struct
import wave
from pathlib import Path


RATE = 48_000
DURATION = 0.72
OUT = Path(__file__).resolve().parents[2] / "public/assets/sfx/gold.wav"


def synthesize():
    rng = random.Random(941)
    signal = [0.0] * round(RATE * DURATION)
    # Inharmonic metal modes, rather than a pitched bell or a musical arpeggio.
    modes = [(1, 0.52, 0.095), (1.73, 0.28, 0.066), (2.61, 0.19, 0.042),
             (3.98, 0.10, 0.024), (5.37, 0.055, 0.014)]
    impacts = [(0, 1760, 1), (.043, 2140, .66), (.081, 1660, .81),
               (.133, 1920, .46), (.191, 1410, .37), (.263, 1590, .23),
               (.347, 1240, .14)]
    for onset, pitch, strength in impacts:
        start = round(onset * RATE)
        partials = [(pitch * ratio * rng.uniform(.989, 1.011), gain, decay, rng.uniform(-math.pi, math.pi))
                    for ratio, gain, decay in modes]
        previous = 0.0
        for index in range(start, len(signal)):
            t = (index - start) / RATE
            noise = rng.uniform(-1, 1)
            contact = (noise - previous) * math.exp(-t / .0028) * .19
            previous = noise
            ring = sum(math.sin(2 * math.pi * frequency * t + phase) * gain * math.exp(-t / decay)
                       for frequency, gain, decay, phase in partials)
            signal[index] += (contact + ring) * strength * min(1, t / .0007)
    dry = signal[:]
    for delay, gain in [(.023, .09), (.051, .045)]:
        offset = round(delay * RATE)
        for index in range(offset, len(signal)):
            signal[index] += dry[index - offset] * gain
    signal = [math.tanh(value * .9) for value in signal]
    dc = sum(signal) / len(signal)
    signal = [(value - dc) * min(1, index / 48, (len(signal) - 1 - index) / 1200)
              for index, value in enumerate(signal)]
    scale = .64 * 32767 / max(abs(value) for value in signal)
    return [round(value * scale) for value in signal]


if __name__ == "__main__":
    samples = synthesize()
    with wave.open(str(OUT), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    print(f"{OUT.name}: {DURATION:.2f}s, original synthesized coin jingle")
