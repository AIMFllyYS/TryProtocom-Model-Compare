#!/usr/bin/env python3
"""生成 T03 / T04 的统一素材（确定性，所有模型拿到完全相同的文件）。

用法：python scripts/build_materials.py
输出：tasks/T03-motion-ac/materials/assets/{bgm.wav,beats.json,copy.md}
      tasks/T04-hyperframes-e2e/materials/assets/{bgm-a.wav,bgm-b.wav,sfx/*.wav,aether9-facts.md}
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np

SR = 44100
ROOT = Path(__file__).resolve().parent.parent / "tasks"
RNG = np.random.default_rng(20261008)


def write_wav(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    x = np.clip(x, -1, 1)
    stereo = np.stack([x, x], axis=1)
    data = (stereo * 32767 * 0.9).astype("<i2").tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


def env(n: int, attack: float, decay: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(t / max(attack, 1e-4), 1) * np.exp(-t / decay)


def kick(n=int(0.35 * SR)):
    t = np.arange(n) / SR
    f = 110 * np.exp(-t * 18) + 42
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.12)


def hat(n=int(0.06 * SR)):
    return RNG.standard_normal(n) * env(n, 0.001, 0.015) * 0.25


def snare(n=int(0.2 * SR)):
    t = np.arange(n) / SR
    return (RNG.standard_normal(n) * 0.5 + np.sin(2 * np.pi * 190 * t) * 0.5) * env(n, 0.001, 0.06) * 0.6


def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) for f in freqs)
    fade = np.minimum(np.minimum(t / 0.3, 1), np.minimum((dur - t) / 0.3, 1))
    return x / len(freqs) * 0.18 * fade


def track(duration: float, bpm: float, chords, seed_offset=0):
    n = int(duration * SR)
    out = np.zeros(n)
    beat = 60 / bpm
    beats = []
    i = 0
    while i * beat < duration - 1e-6:
        t0 = i * beat
        beats.append(round(t0, 4))
        s = int(t0 * SR)

        def add(sig, s=s):
            e = min(n, s + len(sig))
            out[s:e] += sig[: e - s]

        if i % 2 == 0:
            add(kick())
        else:
            add(snare())
        add(hat())
        hs = int((t0 + beat / 2) * SR)
        if hs < n:
            h = hat()
            e = min(n, hs + len(h))
            out[hs:e] += h[: e - hs]
        i += 1
    bar = beat * 4
    for k in range(int(np.ceil(duration / bar))):
        p = pad(chords[(k + seed_offset) % len(chords)], min(bar, duration - k * bar))
        s = int(k * bar * SR)
        out[s:s + len(p)] += p
    tail = int(0.8 * SR)
    out[-tail:] *= np.linspace(1, 0, tail)
    return out / (np.max(np.abs(out)) + 1e-9) * 0.8, beats


def main() -> None:
    chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 311.1]]
    t3 = ROOT / "T03-motion-ac" / "materials" / "assets"
    x, beats = track(15.0, 120, chords)
    write_wav(t3 / "bgm.wav", x)
    downbeats = [b for i, b in enumerate(beats) if i % 4 == 0]
    (t3 / "beats.json").write_text(json.dumps({"bpm": 120, "duration": 15.0, "beats": beats, "downbeats": downbeats}, indent=1), encoding="utf-8")
    (t3 / "copy.md").write_text(COPY_T03, encoding="utf-8")

    t4 = ROOT / "T04-hyperframes-e2e" / "materials" / "assets"
    xa, _ = track(21.0, 128, chords)
    xb, _ = track(21.0, 100, chords[::-1], seed_offset=1)
    write_wav(t4 / "bgm-a.wav", xa)
    write_wav(t4 / "bgm-b.wav", xb)
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    whoosh = RNG.standard_normal(n) * np.sin(np.pi * t / 0.6) ** 2 * 0.5
    write_wav(t4 / "sfx" / "whoosh.wav", whoosh)
    write_wav(t4 / "sfx" / "impact.wav", kick(int(0.5 * SR)) + snare(int(0.5 * SR)) * 0.5)
    m = int(0.25 * SR)
    tm = np.arange(m) / SR
    write_wav(t4 / "sfx" / "tick.wav", np.sin(2 * np.pi * 1800 * tm) * env(m, 0.001, 0.02))
    r = int(2.0 * SR)
    rumble = np.convolve(RNG.standard_normal(r), np.ones(200) / 200, mode="same") * 4 * np.minimum(np.arange(r) / (0.5 * SR), 1)
    write_wav(t4 / "sfx" / "rumble.wav", rumble)
    (t4 / "aether9-facts.md").write_text(FACTS_T04, encoding="utf-8")
    print("materials written")


COPY_T03 = """# Tempo 文案（按顺序使用，每行一句字幕：中文 | English）

1. 总是被打断？ | Always interrupted?
2. 试试 Tempo。 | Meet Tempo.
3. 一键开始专注。 | Focus with one tap.
4. 25 分钟，只做一件事。 | 25 minutes. One thing.
5. 数据告诉你，时间去了哪里。 | See where your time goes.
6. 和朋友一起，专注更久。 | Focus longer, together.
7. Tempo —— 找回你的节奏。 | Tempo. Find your rhythm.
"""

FACTS_T04 = """# Aether-9 事实表（虚构）

- 公司：Helios Dynamics（虚构航天公司）
- 型号：Aether-9，可复用两级重型运载火箭
- 全高 118 m，直径 9 m
- 一级：可回收助推器，21 台甲烷发动机，4 片栅格舵，回收方式为返回发射场垂直着陆
- 二级：6 台发动机（3 台海平面版 + 3 台真空版）
- 近地轨道运力：120 t（完全复用）
- 一级分离：T+160 s，高度约 70 km
- 首飞窗口：2027 年第二季度（计划）
- 口号：Reuse the sky.（复用天空）
"""

if __name__ == "__main__":
    main()
