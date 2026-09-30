// 格式化、分类标签与维度配色等纯函数。
import type { Method, Tier, WorkspaceRun, WsStatus } from '../../shared/types';

export const fmt = {
  n(v: number | null | undefined, d = 1) { return v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d); },
  int(v: number | null | undefined) { return v == null ? '—' : Math.round(v).toLocaleString('zh-CN'); },
  pct(v: number | null | undefined, d = 0) { return v == null ? '—' : (v * 100).toFixed(d) + '%'; },
  usd(v: number | null | undefined) { return v == null ? '—' : v >= 100 ? '$' + v.toFixed(0) : v >= 1 ? '$' + v.toFixed(2) : '$' + v.toFixed(3); },
  min(v: number | null | undefined) {
    if (v == null) return '—';
    if (v < 1) return Math.round(v * 60) + ' 秒';
    if (v < 90) return v.toFixed(v < 10 ? 1 : 0) + ' 分';
    return (v / 60).toFixed(1) + ' 时';
  },
  tokens(v: number | null | undefined) { return v == null ? '—' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v); },
  bytes(v: number) { return v >= 1 << 30 ? (v / (1 << 30)).toFixed(2) + ' GB' : v >= 1 << 20 ? (v / (1 << 20)).toFixed(1) + ' MB' : v >= 1024 ? (v / 1024).toFixed(1) + ' KB' : v + ' B'; },
  ago(iso: string | number | null | undefined) {
    if (!iso) return '—';
    const t = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!t) return '—';
    const s = (Date.now() - t) / 1000;
    if (s < 45) return '刚刚';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' 天前';
    return new Date(t).toLocaleDateString('zh-CN');
  },
  time(iso: string | number | null | undefined) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  clock(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0');
  },
};

export const TIER_LABEL: Record<Tier, string> = { basic: '基础', advanced: '进阶', excellent: '卓越', clean: '扣分项' };
export const METHOD_LABEL: Record<Method, string> = { auto: '自动', agent: 'Agent', human: '人工' };
export const WS_STATUS: Record<WsStatus, { label: string; tone: string }> = {
  prepared: { label: '待开跑', tone: 'muted' },
  running: { label: '运行中', tone: 'info' },
  finished: { label: '已完成', tone: 'warn' },
  registered: { label: '已登记', tone: 'accent' },
  graded: { label: '已评分', tone: 'ok' },
  reviewed: { label: '已复核', tone: 'ok' },
};
export const wsStatus = (w: WorkspaceRun): WsStatus => w.status || (w.grader_run_id ? 'registered' : w.ended_at ? 'finished' : w.started_at ? 'running' : 'prepared');

/** 维度配色（与 benchmark-spec.html 保持一致，深浅主题各一套，通过 CSS 变量 --d-<id> 提供） */
export const dimVar = (id: string) => `var(--d-${id}, var(--accent))`;

/** 参赛者稳定配色：模型档案里的 color 优先，否则按名字哈希取色 */
const PALETTE = ['#7c9cff', '#f0885a', '#4cc9b0', '#c792ea', '#e6c15a', '#ff6b8b', '#62c1ff', '#9ad26a', '#ffa35c', '#b39dff', '#5ad1d1', '#f78fb3'];
export function colorFor(key: string, override?: string | null) {
  if (override) return override;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const scoreTone = (v: number | null | undefined) => (v == null ? 'muted' : v >= 80 ? 'ok' : v >= 60 ? 'accent' : v >= 40 ? 'warn' : 'bad');

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true, () => fallbackCopy(text)) ?? Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export const isVideo = (p: string) => /\.(mp4|webm|mov|m4v|mkv)$/i.test(p);
export const isAudio = (p: string) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(p);
export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(p);
export const isHtml = (p: string) => /\.html?$/i.test(p);
export const isText = (p: string) => /\.(md|txt|json|ya?ml|csv|log|ts|tsx|js|jsx|mjs|cjs|css|py|srt|vtt|xml|toml|ini|sh|cmd|bat|ps1)$/i.test(p);

export const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function download(name: string, content: string | Blob, type = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const splitEntrant = (e: string) => { const i = e.indexOf(' @ '); return i < 0 ? { model: e, harness: '' } : { model: e.slice(0, i), harness: e.slice(i + 3) }; };
