// 宠物球：拖动（主进程跟随光标）、轻点展开 / 收起、眼睛跟随指针、拖动时身体随速度倾斜、落地压扁回弹，
// 以及收起时的“正在工作”进度弧 + 呼吸光点。所有层（光晕、进度环、身体、角标）都在同一个浮动容器里，
// 浮动 / 蹦跳时一起移动，不会出现进度环和身体错位。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { activityOfJob } from '../../shared/activity';
import type { JobInfo } from '../../shared/types';
import { cls } from '../lib/format';
import { describe, useJobProgress, useTick } from '../components/jobview';
import { bridge } from './bridge';
import { Bursts, MOTION, type Fx } from './fx';

export type Mood = 'idle' | 'busy' | 'alert' | 'happy' | 'sleep';
export interface OrbTask { job: JobInfo; label: string | null }

export function Orb({ mood, badge, lead, jobs, fx, onTap, orbRef }: {
  mood: Mood; badge: number; lead: OrbTask | null; jobs: JobInfo[]; fx: Fx; onTap: () => void; orbRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const [pressing, setPressing] = useState(false);
  const g = useRef<{ x0: number; y0: number; lx: number; t: number; moved: boolean; tilt: number } | null>(null);
  const reactRef = useRef<HTMLDivElement>(null);

  // 身体反应用 Web Animations 播放：同一种反应连点也能从头再来，且不重建节点（进度弧不跳）
  const rid = fx.react?.id;
  useEffect(() => {
    const el = reactRef.current, k = fx.react?.kind;
    if (!el || !k || !MOTION[k] || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const [frames, duration, easing] = MOTION[k]!;
    const an = el.animate(frames, { duration, easing });
    return () => an.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);

  // 眼睛（整张脸）跟随指针：只读本窗口内的指针事件
  useEffect(() => {
    const el = orbRef.current;
    if (!el) return;
    let raf = 0;
    const on = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - (r.left + r.width / 2)) / 90, ny = (e.clientY - (r.top + r.height / 2)) / 90;
        el.style.setProperty('--lx', Math.max(-1, Math.min(1, nx)).toFixed(3));
        el.style.setProperty('--ly', Math.max(-1, Math.min(1, ny)).toFixed(3));
      });
    };
    const off = () => { el.style.setProperty('--lx', '0'); el.style.setProperty('--ly', '0'); };
    window.addEventListener('pointermove', on, { passive: true });
    document.documentElement.addEventListener('pointerleave', off);
    return () => { window.removeEventListener('pointermove', on); document.documentElement.removeEventListener('pointerleave', off); cancelAnimationFrame(raf); };
  }, [orbRef]);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    g.current = { x0: e.screenX, y0: e.screenY, lx: e.screenX, t: performance.now(), moved: false, tilt: 0 };
    setPressing(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.screenX - d.x0, e.screenY - d.y0) < 5) return;
      d.moved = true;
      fx.cancel();
      setDragging(true);
      bridge?.dragStart();
    }
    // 按水平速度倾斜（平滑），像被拎着晃
    const now = performance.now();
    const v = (e.screenX - d.lx) / Math.max(8, now - d.t);
    d.lx = e.screenX; d.t = now;
    d.tilt = d.tilt * 0.7 + Math.max(-16, Math.min(16, v * 14)) * 0.3;
    orbRef.current?.style.setProperty('--tilt', `${d.tilt.toFixed(1)}deg`);
  };
  const onEnd = async () => {
    const d = g.current;
    g.current = null;
    setPressing(false);
    if (!d) return;
    if (!d.moved) { fx.kick('boing'); onTap(); return; }
    await bridge?.gestureEnd();
    orbRef.current?.style.setProperty('--tilt', '0deg');
    setDragging(false);
    fx.kick('land');
    fx.burst('dust', 6);
  };

  return (
    <div ref={orbRef} className={cls('orb', `mood-${mood}`, lead && 'working', dragging && 'dragging', pressing && !dragging && 'pressing', fx.react && `fx-${fx.react.kind}`)}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => void onEnd()} onPointerCancel={() => void onEnd()}
      role="button" aria-label="Bench 小精灵：点击展开，拖动移动">
      <div className="orb-float">
        <div className="orb-react" ref={reactRef}>
          <div className="orb-glow" />
          <div className="orb-ring" />
          {lead && <OrbProgress t={lead} jobs={jobs} />}
          <div className="orb-body">
            <div className="orb-sheen" />
            <div className="orb-face">
              <i className="eye l" /><i className="eye r" />
              <i className="mouth" />
              <i className="cheek l" /><i className="cheek r" />
            </div>
          </div>
          {badge > 0 && <span className="orb-badge">{badge}</span>}
          {mood === 'sleep' && <span className="orb-zz">z z</span>}
        </div>
      </div>
      <Bursts fx={fx} />
    </div>
  );
}

/** 收起时的“正在工作”信号：从顶部起按比例画的进度弧（未知进度时是旋转彗尾），加一颗呼吸光点；悬停显示当前步骤 */
function OrbProgress({ t, jobs }: { t: OrbTask; jobs: JobInfo[] }) {
  const a = activityOfJob(t.job, jobs);
  const p = useJobProgress(t.job.id, true);
  useTick(true, 2000);
  const d = describe(a, p);
  return (
    <>
      <div className={cls('orb-prog', d.frac == null && 'indet')} style={d.frac != null ? ({ ['--p' as string]: String(d.frac) } as CSSProperties) : undefined} />
      <span className="orb-dot" title={`${d.title}${t.label ? ' · ' + t.label : ''} · ${d.short}`}><i /></span>
    </>
  );
}
