// 纯 SVG 图表：雷达图、帕累托散点、分布条。无第三方依赖，跟随主题变量。
import { useState } from 'react';

export interface RadarSeries { key: string; label: string; color: string; values: Record<string, number | null> }

export function Radar({ axes, series, size = 360, max = 100, rings = 4, focus }: { axes: { id: string; label: string }[]; series: RadarSeries[]; size?: number; max?: number; rings?: number; focus?: string | null }) {
  const [hover, setHover] = useState<string | null>(null);
  const hi = hover || focus || null;
  const n = axes.length;
  const pad = 64;
  const R = size / 2 - pad;
  const cx = size / 2, cy = size / 2;
  if (n < 3) return <div className="muted small">至少需要 3 个维度</div>;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v] as const;
  };
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img" aria-label="雷达图">
      {Array.from({ length: rings }, (_, k) => {
        const v = (k + 1) / rings;
        return <polygon key={k} points={axes.map((_, i) => pt(i, v).join(',')).join(' ')} className="radar-ring" />;
      })}
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.17);
        const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
        return (
          <g key={a.id}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="radar-axis" />
            <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="radar-label" fill={`var(--d-${a.id}, var(--muted))`}>{a.label}</text>
          </g>
        );
      })}
      {Array.from({ length: rings }, (_, k) => {
        const [x, y] = pt(0, (k + 1) / rings);
        return <text key={k} x={x + 4} y={y} className="radar-tick">{Math.round(((k + 1) / rings) * max)}</text>;
      })}
      {series.map((s) => {
        const pts = axes.map((a, i) => pt(i, Math.max(0, Math.min(1, (s.values[a.id] ?? 0) / max))));
        const dim = hi && hi !== s.key;
        return (
          <g key={s.key} opacity={dim ? 0.18 : 1} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} style={{ transition: 'opacity .15s' }}>
            <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={s.color} fillOpacity={0.14} stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            {pts.map(([x, y], i) => s.values[axes[i].id] != null && <circle key={i} cx={x} cy={y} r={3} fill={s.color}><title>{`${s.label} · ${axes[i].label} ${Number(s.values[axes[i].id]).toFixed(1)}`}</title></circle>)}
          </g>
        );
      })}
    </svg>
  );
}

export interface ScatterPt { key: string; label: string; x: number; y: number; color: string; frontier?: boolean }
/** 帕累托图：x = 期望成本（对数刻度，越左越好），y = 质量分 */
export function Pareto({ points, xLabel = '整套期望成本（美元，对数）', yLabel = '质量总分', height = 320, log = true }: { points: ScatterPt[]; xLabel?: string; yLabel?: string; height?: number; log?: boolean }) {
  const W = 640, H = height, L = 52, B = 40, T = 16, Rr = 20;
  if (!points.length) return <div className="muted small pad">暂无同时具备成本与质量分的参赛者</div>;
  const tx = (v: number) => (log ? Math.log10(Math.max(v, 1e-4)) : v);
  const xs = points.map((p) => tx(p.x));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 0.3) { x0 -= 0.3; x1 += 0.3; }
  const padX = (x1 - x0) * 0.08; x0 -= padX; x1 += padX;
  const ys = points.map((p) => p.y);
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10), y1 = Math.min(100, Math.ceil((Math.max(...ys) + 5) / 10) * 10);
  const X = (v: number) => L + ((tx(v) - x0) / (x1 - x0)) * (W - L - Rr);
  const Y = (v: number) => T + (1 - (v - y0) / Math.max(1, y1 - y0)) * (H - T - B);
  const front = points.filter((p) => p.frontier).sort((a, b) => a.x - b.x);
  const ticksX: number[] = [];
  if (log) for (let e = Math.floor(x0); e <= Math.ceil(x1); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (tx(v) >= x0 && tx(v) <= x1) ticksX.push(v); }
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="帕累托前沿">
      {Array.from({ length: 6 }, (_, i) => y0 + ((y1 - y0) * i) / 5).map((v) => (
        <g key={v}><line x1={L} x2={W - Rr} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{Math.round(v)}</text></g>
      ))}
      {ticksX.map((v) => <g key={v}><line x1={X(v)} x2={X(v)} y1={T} y2={H - B} className="grid" /><text x={X(v)} y={H - B + 16} textAnchor="middle" className="tick">{v < 1 ? v : v.toFixed(0)}</text></g>)}
      <text x={(L + W) / 2} y={H - 6} textAnchor="middle" className="axis-l">{xLabel}</text>
      <text x={14} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(T + H - B) / 2})`} className="axis-l">{yLabel}</text>
      {front.length > 1 && <polyline points={front.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} className="frontier" />}
      {points.map((p) => (
        <g key={p.key}>
          <circle cx={X(p.x)} cy={Y(p.y)} r={p.frontier ? 7 : 5.5} fill={p.color} stroke="var(--bg)" strokeWidth={2}><title>{`${p.label}\n质量 ${p.y.toFixed(1)} · 成本 $${p.x.toFixed(2)}`}</title></circle>
          <text x={X(p.x) + 10} y={Y(p.y) - 8} className="pt-l">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** 横向条（带置信区间） */
export function CiBar({ v, lo, hi, color }: { v: number | null; lo?: number | null; hi?: number | null; color?: string }) {
  if (v == null) return <span className="muted">—</span>;
  return (
    <span className="cibar" title={lo != null && hi != null ? `95% CI ${lo.toFixed(1)} – ${hi.toFixed(1)}` : undefined}>
      <span className="cibar-track">
        {lo != null && hi != null && <i className="cibar-ci" style={{ left: `${lo}%`, width: `${Math.max(0.5, hi - lo)}%` }} />}
        <i className="cibar-v" style={{ width: `${v}%`, background: color }} />
      </span>
    </span>
  );
}

/** 热力色（0–100） */
export function heat(v: number | null | undefined) {
  if (v == null) return undefined;
  const t = Math.max(0, Math.min(1, v / 100));
  // 低分偏红，高分偏绿，中间过渡到主题强调色
  const hue = 8 + t * 140;
  return `hsl(${hue} 62% 46% / ${0.16 + t * 0.34})`;
}
