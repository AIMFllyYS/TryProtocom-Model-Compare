// 专业视频播放器：逐帧、变速、A-B 循环、截帧、全屏、键盘快捷键、分辨率/时长信息。
import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Maximize, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import { cls, download, fmt } from '../lib/format';
import { IconBtn, Select } from '../ui/kit';

const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2, 4];

export function VideoPlayer({ src, name, fps: fps0 = 30, autoPlay, className }: { src: string; name?: string; fps?: number; autoPlay?: boolean; className?: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [ab, setAb] = useState<[number | null, number | null]>([null, null]);
  const [info, setInfo] = useState<{ w: number; h: number } | null>(null);
  const [fps, setFps] = useState(fps0);
  const [err, setErr] = useState<string | null>(null);
  const [buffered, setBuffered] = useState(0);

  // 用 requestVideoFrameCallback 估算真实帧率（支持时）
  useEffect(() => {
    const el = v.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number; presentedFrames: number }) => void) => number }) | null;
    if (!el?.requestVideoFrameCallback) return;
    let last: { t: number; f: number } | null = null;
    let id = 0, stop = false;
    const cb = (_n: number, m: { mediaTime: number; presentedFrames: number }) => {
      if (stop) return;
      if (last && m.presentedFrames - last.f >= 10 && m.mediaTime > last.t) {
        const est = (m.presentedFrames - last.f) / (m.mediaTime - last.t);
        const std = [24, 25, 30, 48, 50, 60, 120].reduce((a, b) => (Math.abs(b - est) < Math.abs(a - est) ? b : a), 30);
        if (Math.abs(std - est) < 3) setFps(std);
        last = { t: m.mediaTime, f: m.presentedFrames };
      } else if (!last) last = { t: m.mediaTime, f: m.presentedFrames };
      id = el.requestVideoFrameCallback!(cb);
    };
    id = el.requestVideoFrameCallback(cb);
    return () => { stop = true; (el as any).cancelVideoFrameCallback?.(id); };
  }, [src]);

  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const on = () => {
      setT(el.currentTime);
      if (ab[0] != null && ab[1] != null && el.currentTime >= ab[1]) el.currentTime = ab[0];
      try { if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1)); } catch { /* */ }
    };
    el.addEventListener('timeupdate', on);
    return () => el.removeEventListener('timeupdate', on);
  }, [ab]);

  const step = (n: number) => { const el = v.current!; el.pause(); el.currentTime = Math.max(0, Math.min(dur, el.currentTime + n / fps)); };
  const toggle = () => { const el = v.current!; if (el.paused) void el.play(); else el.pause(); };
  const shot = () => {
    const el = v.current!;
    const c = document.createElement('canvas');
    c.width = el.videoWidth; c.height = el.videoHeight;
    c.getContext('2d')!.drawImage(el, 0, 0);
    c.toBlob((b) => b && download(`${(name || 'frame').replace(/\.[^.]+$/, '')}-${el.currentTime.toFixed(3)}s.png`, b));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === ',' ) { e.preventDefault(); step(-1); }
    else if (k === '.') { e.preventDefault(); step(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); v.current!.currentTime -= e.shiftKey ? 1 : 5; }
    else if (k === 'ArrowRight') { e.preventDefault(); v.current!.currentTime += e.shiftKey ? 1 : 5; }
    else if (k === 'f') { e.preventDefault(); void box.current?.requestFullscreen?.(); }
    else if (k === 'm') { e.preventDefault(); setMuted(!muted); }
    else if (k === '[') setAb([t, ab[1]]);
    else if (k === ']') setAb([ab[0], t]);
    else if (k === '\\') setAb([null, null]);
    else if (/^[0-9]$/.test(k)) { v.current!.currentTime = (Number(k) / 10) * dur; }
  };
  const frame = Math.round(t * fps);
  return (
    <div ref={box} className={cls('vplayer', className)} tabIndex={0} onKeyDown={onKey}>
      <div className="vp-stage" onClick={toggle}>
        <video ref={v} src={src} autoPlay={autoPlay} muted={muted} loop={loop && ab[0] == null} playsInline preload="auto"
          onLoadedMetadata={(e) => { const el = e.currentTarget; setDur(el.duration); setInfo({ w: el.videoWidth, h: el.videoHeight }); setErr(null); }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
          onError={() => setErr('视频无法播放：浏览器可能不支持该编码（例如 H.265 / ProRes）。桌面版或用 ffmpeg 转码为 H.264 后再试。')} />
        {err && <div className="vp-err">{err}</div>}
      </div>
      <div className="vp-bar">
        <div className="vp-seek" onPointerDown={(e) => {
          const el = e.currentTarget; const r = el.getBoundingClientRect();
          const set = (x: number) => { v.current!.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur; };
          set(e.clientX);
          const mv = (ev: PointerEvent) => set(ev.clientX);
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        }}>
          <i className="vp-buf" style={{ width: `${dur ? (buffered / dur) * 100 : 0}%` }} />
          {ab[0] != null && <i className="vp-ab" style={{ left: `${(ab[0] / dur) * 100}%`, width: `${(((ab[1] ?? dur) - ab[0]) / dur) * 100}%` }} />}
          <i className="vp-pos" style={{ width: `${dur ? (t / dur) * 100 : 0}%` }} />
        </div>
        <div className="vp-ctrl">
          <IconBtn label={playing ? '暂停 (空格)' : '播放 (空格)'} onClick={toggle}>{playing ? <Pause size={16} /> : <Play size={16} />}</IconBtn>
          <IconBtn label="上一帧 (,)" onClick={() => step(-1)}><ChevronLeft size={16} /></IconBtn>
          <IconBtn label="下一帧 (.)" onClick={() => step(1)}><ChevronRight size={16} /></IconBtn>
          <span className="mono small vp-time">{fmtT(t)} / {fmtT(dur)} <span className="muted">· 帧 {frame}</span></span>
          <div className="grow" />
          <Select size="xs" value={String(rate)} onChange={(x) => { v.current!.playbackRate = Number(x); }} label="播放速度" place="top-start" options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
          <Select size="xs" value={String(fps)} onChange={(x) => setFps(Number(x))} label="逐帧步进帧率" place="top-start" options={[24, 25, 30, 48, 50, 60, 120].map((s) => ({ value: String(s), label: `${s} fps` }))} />
          <IconBtn label={ab[0] != null ? 'A-B 循环（\\ 清除）' : '设 A 点 [，B 点 ]'} active={ab[0] != null} onClick={() => setAb(ab[0] == null ? [t, null] : ab[1] == null ? [ab[0], t] : [null, null])}>
            <span className="mono xs">{ab[0] == null ? 'A' : ab[1] == null ? 'B' : 'AB'}</span>
          </IconBtn>
          <IconBtn label="循环" active={loop} onClick={() => setLoop(!loop)}><Repeat size={15} /></IconBtn>
          <IconBtn label={muted ? '取消静音 (m)' : '静音 (m)'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</IconBtn>
          <IconBtn label="截取当前帧 PNG" onClick={shot}><Camera size={15} /></IconBtn>
          <IconBtn label="全屏 (f)" onClick={() => void box.current?.requestFullscreen?.()}><Maximize size={15} /></IconBtn>
        </div>
        {info && <div className="vp-meta muted xs mono">{info.w}×{info.h} · {fmt.n(dur, 2)}s · 快捷键：空格 播放 · , . 逐帧 · ←→ 5s · [ ] A-B · 0–9 跳转 · f 全屏</div>}
      </div>
    </div>
  );
}
const fmtT = (s: number) => { if (!Number.isFinite(s)) return '0:00'; const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
