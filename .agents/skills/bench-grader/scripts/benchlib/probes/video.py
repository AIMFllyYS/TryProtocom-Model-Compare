"""视频探针（ffprobe / ffmpeg）：规格、响度、切换密度、冻帧、黑帧、字幕文件、可选 ASR。"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from ..common import RunContext, run_cmd

CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN = re.compile(r"[A-Za-z]")


def video_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    if not shutil.which("ffprobe"):
        m.mark_na("video.*", "评测机未安装 ffmpeg/ffprobe")
        return
    root = ctx.project_root()
    f = root / opts.get("file", "final.mp4")
    if not f.exists():
        cands = [p for p in root.rglob("*.mp4") if "node_modules" not in p.parts]
        f = cands[0] if cands else f
    m.set("video.exists", f.exists())
    if not f.exists():
        return
    m.artifacts["video"] = str(f)
    code, out, _ = run_cmd(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(f)], timeout=60)
    info = json.loads(out) if code == 0 else {}
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), {})
    dur = float(info.get("format", {}).get("duration", 0) or 0)
    m.set("video.duration", round(dur, 2))
    m.set("video.width", int(v.get("width", 0) or 0))
    m.set("video.height", int(v.get("height", 0) or 0))
    fr = v.get("avg_frame_rate", "0/1")
    try:
        num, den = fr.split("/")
        m.set("video.fps", round(float(num) / float(den), 2) if float(den) else 0)
    except ValueError:
        m.set("video.fps", 0)
    m.set("video.h264", v.get("codec_name") == "h264")
    m.set("video.aac", a.get("codec_name") == "aac")
    m.set("video.has_audio", bool(a))
    exp = opts.get("expected_duration")
    if exp:
        m.set("video.duration_err", round(abs(dur - exp), 2))
    if a:
        _, out, _ = run_cmd(["ffmpeg", "-nostats", "-i", str(f), "-af", "ebur128=peak=true", "-f", "null", "-"], timeout=300)
        summ = out.split("Summary:")[-1]
        mi = re.search(r"I:\s*(-?[\d.]+) LUFS", summ)
        mp = re.search(r"True peak:\s*Peak:\s*(-?[\d.]+|-inf) dBFS", summ, re.S)
        m.set("video.lufs_i", float(mi.group(1)) if mi else None)
        m.set("video.true_peak", float(mp.group(1)) if mp and mp.group(1) != "-inf" else None)
    _, out, _ = run_cmd(["ffmpeg", "-nostats", "-i", str(f), "-vf", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], timeout=600)
    cuts = len(re.findall(r"pts_time:", out))
    m.set("video.scene_cuts", cuts)
    m.set("video.cuts_per_10s", round(cuts / max(dur, 1e-6) * 10, 2))
    _, out, _ = run_cmd(["ffmpeg", "-nostats", "-i", str(f), "-vf", "freezedetect=n=0.003:d=0.5", "-an", "-f", "null", "-"], timeout=600)
    m.set("video.freeze_s", round(sum(float(x) for x in re.findall(r"freeze_duration:\s*([\d.]+)", out)), 2))
    _, out, _ = run_cmd(["ffmpeg", "-nostats", "-i", str(f), "-vf", "blackdetect=d=0.1:pix_th=0.10", "-an", "-f", "null", "-"], timeout=600)
    m.set("video.black_s", round(sum(float(x) for x in re.findall(r"black_duration:\s*([\d.]+)", out)), 2))

    srt = root / opts.get("srt", "subtitles.srt")
    if srt.exists():
        _srt_metrics(srt.read_text(encoding="utf-8", errors="replace"), dur, m)
    else:
        m.set("srt.exists", False)

    if opts.get("asr"):
        _asr(ctx, f, root / opts.get("script", "script.md"), m)


def _ts(s: str) -> float:
    h, mi, rest = s.strip().split(":")
    sec, ms = rest.replace(".", ",").split(",")
    return int(h) * 3600 + int(mi) * 60 + int(sec) + int(ms) / 1000


def _srt_metrics(text: str, dur: float, m) -> None:
    blocks = [b for b in re.split(r"\n\s*\n", text.strip()) if "-->" in b]
    cues = []
    for b in blocks:
        lines = [ln for ln in b.splitlines() if ln.strip()]
        idx = next(i for i, ln in enumerate(lines) if "-->" in ln)
        s, e = lines[idx].split("-->")
        try:
            cues.append((_ts(s), _ts(e.split()[0]), lines[idx + 1:]))
        except (ValueError, IndexError):
            continue
    m.set("srt.exists", True)
    m.set("srt.cues", len(cues))
    bad_lines = 0
    bilingual = 0
    for _, _, lines in cues:
        has_c = any(CJK.search(ln) for ln in lines)
        has_l = any(LATIN.search(ln) and not CJK.search(ln) for ln in lines)
        bilingual += has_c and has_l
        cjk_lines = sum(1 for ln in lines if CJK.search(ln))
        lat_lines = sum(1 for ln in lines if not CJK.search(ln) and LATIN.search(ln))
        if len(lines) > 2 or cjk_lines > 1 or lat_lines > 1:
            bad_lines += 1
    m.set("srt.wrapped_cues", bad_lines)
    m.set("srt.bilingual_ratio", round(bilingual / len(cues), 3) if cues else 0)
    overlaps = sum(1 for i in range(1, len(cues)) if cues[i][0] < cues[i - 1][1] - 0.01)
    m.set("srt.overlaps", overlaps)
    m.set("srt.out_of_range", sum(1 for s, e, _ in cues if e > dur + 0.5 or s < 0 or e <= s))
    covered = sum(max(0, min(e, dur) - s) for s, e, _ in cues)
    m.set("srt.coverage", round(covered / dur, 3) if dur else 0)


def _cer(ref: str, hyp: str) -> float:
    ref, hyp = list(ref), list(hyp)
    if not ref:
        return 1.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1] / len(ref)


def _asr(ctx: RunContext, video: Path, script: Path, m) -> None:
    try:
        from faster_whisper import WhisperModel  # type: ignore
        model = WhisperModel("small", compute_type="int8")
        segs, _ = model.transcribe(str(video), language="zh")
        hyp = "".join(s.text for s in segs)
    except Exception:  # noqa: BLE001
        try:
            import whisper  # type: ignore
            hyp = whisper.load_model("small").transcribe(str(video), language="zh")["text"]
        except Exception:  # noqa: BLE001
            m.mark_na("asr.*", "评测机未安装 faster-whisper / openai-whisper，跳过语音转写")
            return
    ref = "".join(CJK.findall(script.read_text(encoding="utf-8", errors="replace"))) if script.exists() else ""
    hyp_c = "".join(CJK.findall(hyp))
    m.set("asr.chars", len(hyp_c))
    m.set("asr.cer", round(_cer(ref, hyp_c), 3) if ref else None)
    (ctx.work_dir / "asr.txt").write_text(hyp, encoding="utf-8")
