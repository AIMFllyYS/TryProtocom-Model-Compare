// 纯 SVG 图表（无第三方依赖，跟随主题变量）+ 可导出的图表卡片。
import { useRef, useState, type ReactNode } from 'react';
import { Copy, Download, FileImage, MoreHorizontal } from 'lucide-react';
import { exportChart } from '../lib/exporter';
import { Card, IconBtn, Menu } from './kit';
import { toast } from './toast';

/** 对比用的系列色：高区分度、深浅主题都可读 */
export const SERIES = ['#7c6cff', '#ff7a59', '#1fb89a', '#f2b233', '#3f9cff', '#ef5da8', '#8bc34a', '#a78bfa', '#14b8c4', '#ff9f43', '#94a3b8', '#e879f9'];
export const seriesColor = (i: number) => SERIES[i % SERIES.length];

// ------------------------------------------------------------ 卡片 + 导出
export function ChartCard({ title, sub, children, extra, className, exportName, flat }: { title: ReactNode; sub?: ReactNode; children: ReactNode; extra?: ReactNode; className?: string; exportName?: string; flat?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const name = exportName || (typeof title === 'string' ? title : '图表');
  const subText = typeof sub === 'string' ? sub : undefined;
  const run = async (k: 'png' | 'svg' | 'copy') => {
    const svg = box.current?.querySelector('svg');
    if (!svg) { toast.warn('没有可导出的图表'); return; }
    try { await exportChart(svg, k, { title: name, subtitle: subText }); if (k === 'copy') toast.ok('图片已复制到剪贴板'); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Card title={title} sub={sub} className={className} flat={flat} extra={<>{extra}
      <Menu place="bottom-end" items={[
        { group: '导出图表' },
        { label: 'PNG（2× 高清）', icon: <FileImage size={15} />, onClick: () => void run('png') },
        { label: 'SVG（矢量）', icon: <Download size={15} />, onClick: () => void run('svg') },
        { label: '复制图片', icon: <Copy size={15} />, onClick: () => void run('copy') },
      ]} trigger={(p) => <IconBtn {...p} label="导出图表" size="sm"><MoreHorizontal size={16} /></IconBtn>} /></>}>
      <div ref={box} data-chart={name} data-sub={subText} className="chart-box">{children}</div>
    </Card>
  );
}

// ------------------------------------------------------------ 雷达
export interface RadarSeries { key: string; label: string; color: string; values: Record<string, number | null> }
export function Radar({ axes, series, size = 380, max = 100, rings = 4, focus, onFocus }: { axes: { id: string; label: string }[]; series: RadarSeries[]; size?: number; max?: number; rings?: number; focus?: string | null; onFocus?: (k: string | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const hi = hover || focus || null;
  const n = axes.length;
  const pad = 70, R = size / 2 - pad, cx = size / 2, cy = size / 2;
  if (n < 3) return <div className="muted small">至少需要 3 个维度</div>;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v] as const; };
  const set = (k: string | null) => { setHover(k); onFocus?.(k); };
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img" aria-label="雷达图">
      <defs>
        <radialGradient id="rg-bg"><stop offset="0%" stopColor="var(--fill-1)" /><stop offset="100%" stopColor="var(--fill-2)" /></radialGradient>
      </defs>
      <polygon points={axes.map((_, i) => pt(i, 1).join(',')).join(' ')} fill="url(#rg-bg)" className="radar-face" />
      {Array.from({ length: rings }, (_, k) => <polygon key={k} points={axes.map((_, i) => pt(i, (k + 1) / rings).join(',')).join(' ')} className="radar-ring" />)}
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.2);
        const anchor = Math.abs(lx - cx) < 10 ? 'middle' : lx > cx ? 'start' : 'end';
        return (
          <g key={a.id}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="radar-axis" />
            <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="radar-label">{a.label}</text>
          </g>
        );
      })}
      {Array.from({ length: rings }, (_, k) => { const [x, y] = pt(0, (k + 1) / rings); return <text key={k} x={x + 5} y={y + 1} className="radar-tick">{Math.round(((k + 1) / rings) * max)}</text>; })}
      {series.map((s) => {
        const pts = axes.map((a, i) => pt(i, Math.max(0, Math.min(1, (s.values[a.id] ?? 0) / max))));
        const dim = hi && hi !== s.key;
        return (
          <g key={s.key} opacity={dim ? 0.14 : 1} onMouseEnter={() => set(s.key)} onMouseLeave={() => set(null)} style={{ transition: 'opacity .2s' }}>
            <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={s.color} fillOpacity={series.length > 3 ? 0.08 : 0.16} stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" />
            {pts.map(([x, y], i) => s.values[axes[i].id] != null && <circle key={i} cx={x} cy={y} r={3.4} fill={s.color} stroke="var(--bg)" strokeWidth={1.5}><title>{`${s.label} · ${axes[i].label} ${Number(s.values[axes[i].id]).toFixed(1)}`}</title></circle>)}
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------ 分组柱状
export interface BarSeries { key: string; label: string; color: string; values: Record<string, number | null>; err?: Record<string, number | null> }
export function Bars({ cats, series, max = 100, height = 280, unit = '' }: { cats: { id: string; label: string }[]; series: BarSeries[]; max?: number; height?: number; unit?: string }) {
  const W = Math.max(560, cats.length * Math.max(60, series.length * 18 + 24)), H = height, L = 36, B = 42, T = 14, Rr = 8;
  const gw = (W - L - Rr) / Math.max(1, cats.length);
  const bw = Math.min(26, (gw - 16) / Math.max(1, series.length));
  const Y = (v: number) => T + (1 - Math.max(0, Math.min(max, v)) / max) * (H - T - B);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="分组柱状图">
      {[0, 25, 50, 75, 100].map((p) => { const v = (max * p) / 100; return <g key={p}><line x1={L} x2={W - Rr} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{Math.round(v)}</text></g>; })}
      {cats.map((c, ci) => {
        const x0 = L + ci * gw + (gw - bw * series.length) / 2;
        return (
          <g key={c.id}>
            {series.map((s, si) => {
              const v = s.values[c.id];
              if (v == null) return <rect key={s.key} x={x0 + si * bw + 2} y={H - B - 2} width={bw - 4} height={2} rx={1} fill="var(--text-4)" />;
              const e = s.err?.[c.id];
              return (
                <g key={s.key}>
                  <rect x={x0 + si * bw + 2} y={Y(v)} width={bw - 4} height={H - B - Y(v)} rx={Math.min(6, (bw - 4) / 2)} fill={s.color} className="bar"><title>{`${s.label} · ${c.label} ${v.toFixed(1)}${unit}${e ? ` ± ${e.toFixed(1)}` : ''}`}</title></rect>
                  {e != null && e > 0 && <line x1={x0 + si * bw + bw / 2} x2={x0 + si * bw + bw / 2} y1={Y(v + e)} y2={Y(Math.max(0, v - e))} className="err" />}
                </g>
              );
            })}
            <text x={L + ci * gw + gw / 2} y={H - B + 18} textAnchor="middle" className="tick b">{c.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------ 横向条
export function HBars({ rows, max = 100, color, width = 520 }: { rows: { id: string; label: string; value: number | null; color?: string; note?: string }[]; max?: number; color?: string; width?: number }) {
  const rh = 30, L = 110, Rr = 48, W = width, H = rows.length * rh + 8;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="条形图">
      {rows.map((r, i) => {
        const y = 4 + i * rh, w = r.value == null ? 0 : (Math.max(0, Math.min(max, r.value)) / max) * (W - L - Rr);
        return (
          <g key={r.id}>
            <text x={L - 10} y={y + rh / 2} textAnchor="end" dominantBaseline="middle" className="tick b">{r.label}</text>
            <rect x={L} y={y + 8} width={W - L - Rr} height={rh - 16} rx={(rh - 16) / 2} className="track" />
            {r.value != null && <rect x={L} y={y + 8} width={Math.max(w, 4)} height={rh - 16} rx={(rh - 16) / 2} fill={r.color || color || 'var(--accent)'} className="bar"><title>{`${r.label} ${r.value.toFixed(1)}${r.note ? ' · ' + r.note : ''}`}</title></rect>}
            <text x={W - Rr + 8} y={y + rh / 2} dominantBaseline="middle" className="val">{r.value == null ? '—' : r.value.toFixed(1)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------ 热力矩阵
export function Heatmap({ rows, cols, value, text, onCell, cell = 54, rowW = 180, legend = true }: {
  rows: { id: string; label: string; sub?: string }[]; cols: { id: string; label: string; color?: string }[];
  value: (r: string, c: string) => number | null; text?: (r: string, c: string, v: number | null) => string; onCell?: (r: string, c: string) => void; cell?: number; rowW?: number; legend?: boolean;
}) {
  const ch = 34, head = 40, W = rowW + cols.length * cell + 8, H = head + rows.length * ch + (legend ? 30 : 6);
  return (
    <svg className="chart heat" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, 520) }} role="img" aria-label="热力矩阵">
      {cols.map((c, i) => <text key={c.id} x={rowW + i * cell + cell / 2} y={head - 14} textAnchor="middle" className="tick b" fill={c.color}>{c.label}</text>)}
      {rows.map((r, ri) => (
        <g key={r.id}>
          <text x={rowW - 12} y={head + ri * ch + ch / 2} textAnchor="end" dominantBaseline="middle" className="tick b">{r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label}</text>
          {cols.map((c, ci) => {
            const v = value(r.id, c.id);
            return (
              <g key={c.id} onClick={onCell ? () => onCell(r.id, c.id) : undefined} style={{ cursor: onCell ? 'pointer' : undefined }}>
                <rect x={rowW + ci * cell + 2} y={head + ri * ch + 2} width={cell - 4} height={ch - 4} rx={8} fill={v == null ? 'var(--fill-1)' : heat(v)} className="heat-c" />
                <text x={rowW + ci * cell + cell / 2} y={head + ri * ch + ch / 2 + 1} textAnchor="middle" dominantBaseline="middle" className="heat-t">{text ? text(r.id, c.id, v) : v == null ? '·' : v.toFixed(0)}</text>
                <title>{`${r.label} × ${c.label}：${v == null ? '无数据' : v.toFixed(1)}`}</title>
              </g>
            );
          })}
        </g>
      ))}
      {legend && (
        <g transform={`translate(${rowW}, ${H - 18})`}>
          {[0, 20, 40, 60, 80, 100].map((v, i) => <rect key={v} x={i * 26} y={0} width={24} height={10} rx={3} fill={heat(v)} />)}
          <text x={6 * 26 + 6} y={8} className="tick">0 → 100</text>
        </g>
      )}
    </svg>
  );
}

// ------------------------------------------------------------ 帕累托
export interface ScatterPt { key: string; label: string; x: number; y: number; color: string; frontier?: boolean }
export function Pareto({ points, xLabel = '整套期望成本（美元，对数）', yLabel = '质量总分', height = 320, log = true }: { points: ScatterPt[]; xLabel?: string; yLabel?: string; height?: number; log?: boolean }) {
  const W = 640, H = height, L = 52, B = 42, T = 16, Rr = 24;
  if (!points.length) return <div className="muted small pad">暂无同时具备成本与质量分的参赛者</div>;
  const tx = (v: number) => (log ? Math.log10(Math.max(v, 1e-4)) : v);
  const xs = points.map((p) => tx(p.x));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 0.3) { x0 -= 0.3; x1 += 0.3; }
  const padX = (x1 - x0) * 0.1; x0 -= padX; x1 += padX;
  const ys = points.map((p) => p.y);
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10), y1 = Math.min(100, Math.ceil((Math.max(...ys) + 5) / 10) * 10);
  const X = (v: number) => L + ((tx(v) - x0) / (x1 - x0)) * (W - L - Rr);
  const Y = (v: number) => T + (1 - (v - y0) / Math.max(1, y1 - y0)) * (H - T - B);
  const front = points.filter((p) => p.frontier).sort((a, b) => a.x - b.x);
  const ticksX: number[] = [];
  if (log) for (let e = Math.floor(x0); e <= Math.ceil(x1); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (tx(v) >= x0 && tx(v) <= x1) ticksX.push(v); }
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="帕累托前沿">
      {Array.from({ length: 6 }, (_, i) => y0 + ((y1 - y0) * i) / 5).map((v) => <g key={v}><line x1={L} x2={W - Rr} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{Math.round(v)}</text></g>)}
      {ticksX.map((v) => <g key={v}><line x1={X(v)} x2={X(v)} y1={T} y2={H - B} className="grid" /><text x={X(v)} y={H - B + 16} textAnchor="middle" className="tick">{v < 1 ? v : v.toFixed(0)}</text></g>)}
      <text x={(L + W) / 2} y={H - 6} textAnchor="middle" className="axis-l">{xLabel}</text>
      <text x={14} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(T + H - B) / 2})`} className="axis-l">{yLabel}</text>
      {front.length > 1 && <polyline points={front.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} className="frontier" />}
      {points.map((p) => (
        <g key={p.key}>
          <circle cx={X(p.x)} cy={Y(p.y)} r={p.frontier ? 8 : 6} fill={p.color} stroke="var(--bg)" strokeWidth={2}><title>{`${p.label}\n质量 ${p.y.toFixed(1)} · 成本 $${p.x.toFixed(2)}`}</title></circle>
          <text x={X(p.x) + 11} y={Y(p.y) - 9} className="pt-l">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------ 环形
export function Donut({ parts, size = 160, thick = 20, center, sub }: { parts: { label: string; value: number; color: string }[]; size?: number; thick?: number; center?: ReactNode; sub?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = size / 2 - thick / 2 - 2, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg className="chart" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="分布">
      <circle cx={size / 2} cy={size / 2} r={r} className="track" fill="none" strokeWidth={thick} />
      {parts.map((p) => {
        const len = (p.value / total) * c;
        const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={thick} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-acc} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}><title>{`${p.label}：${p.value}（${Math.round((p.value / total) * 100)}%）`}</title></circle>;
        acc += len;
        return el;
      })}
      {center != null && <text x={size / 2} y={size / 2 - (sub ? 4 : 0)} textAnchor="middle" dominantBaseline="middle" className="donut-v">{center}</text>}
      {sub && <text x={size / 2} y={size / 2 + 18} textAnchor="middle" className="tick">{sub}</text>}
    </svg>
  );
}
export function Legend({ items, onHover, active }: { items: { key: string; label: ReactNode; color: string; icon?: ReactNode }[]; onHover?: (k: string | null) => void; active?: string | null }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.key} className={active && active !== it.key ? 'dim' : ''} onMouseEnter={() => onHover?.(it.key)} onMouseLeave={() => onHover?.(null)}>
          <i style={{ background: it.color }} />{it.icon}{it.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ 表格用
export function CiBar({ v, lo, hi, color }: { v: number | null; lo?: number | null; hi?: number | null; color?: string }) {
  if (v == null) return <span className="muted">—</span>;
  return (
    <span className="cibar">
      <span className="cibar-track">
        {lo != null && hi != null && <i className="cibar-ci" style={{ left: `${lo}%`, width: `${Math.max(0.5, hi - lo)}%` }} />}
        <i className="cibar-v" style={{ width: `${v}%`, background: color }} />
      </span>
    </span>
  );
}
/** 热力色（0–100）：低分暖、高分冷绿，透明度随分数提高 */
export function heat(v: number | null | undefined) {
  if (v == null) return undefined;
  const t = Math.max(0, Math.min(1, v / 100));
  const hue = 12 + t * 138;
  return `hsl(${hue} 70% ${52 - t * 8}% / ${0.18 + t * 0.5})`;
}
