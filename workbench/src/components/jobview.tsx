// 后台任务（登记 / 自动评分 / 其他 Python 任务）的进度与日志视图：纯展示组件。
// 工作台主界面（运行卡片、运行详情、设置 → 后台任务）和桌面宠物共用同一套，
// 所以这里只依赖 React、lib/bus 和 api，不引用全局上下文、路由或提示条。
import { useEffect, useRef, useState } from 'react';
import { parseProgress, type Activity, type Phase, type Progress, queuedAt } from '../../shared/activity';
import type { JobInfo } from '../../shared/types';
import { get } from '../api';
import { bus, jobKey, useBus } from '../lib/bus';
import { cls, fmt } from '../lib/format';

export const PROBE: Record<string, string> = { api: 'API 测试', browser: '浏览器探针', build: '构建', claims: '汇报核对', diff: '代码改动', docs: '文档检查', files: '文件检查', mcproject: '工程检查', timeline: '时间线', transcript: '对话记录', video: '视频分析' };

/** 每个任务只补齐一次完整输出（多个组件同时要时共用一个请求），之后靠 SSE 追加保持最新 */
const seeding = new Map<string, Promise<void>>();
function seedJob(id: string) {
  const k = jobKey(id);
  let p = seeding.get(k);
  if (p) return p;
  const n0 = bus.get<string>(k).length;
  p = get<{ output: string[] }>(`/api/jobs/${id}`).then((r) => {
    if (!Array.isArray(r?.output)) return; // 任务已不在服务端（重启过等）：保留已收到的行
    // 请求期间经 SSE 到达的行接在快照后面（去掉与快照结尾重叠的部分），避免被快照覆盖掉
    const snap = r.output;
    const extra = bus.get<string>(k).slice(n0);
    let m = Math.min(extra.length, snap.length);
    while (m > 0 && !extra.slice(0, m).every((l, i) => l === snap[snap.length - m + i])) m--;
    bus.set(k, snap.concat(extra.slice(m)));
  }, () => { seeding.delete(k); });
  seeding.set(k, p);
  return p;
}
/** SSE 断线重连后调用：期间可能漏了行，下次打开日志时重新补齐 */
export const forgetJobSeeds = () => seeding.clear();

/** 订阅任务输出（SSE 追加到 bus）；seed=true 时先向服务端补齐一次完整输出（打开日志 / 中途打开时用） */
export function useJobLines(id: string | null | undefined, seed = false): string[] {
  const lines = useBus<string>(id ? jobKey(id) : 'job:none');
  useEffect(() => { if (id && seed) void seedJob(id); }, [id, seed]);
  return lines;
}
export const useJobProgress = (id: string | null | undefined, seed = false): Progress => parseProgress(useJobLines(id, seed));

export function useTick(on: boolean, ms = 1000) {
  const [, t] = useState(0);
  useEffect(() => { if (!on) return; const h = setInterval(() => t((x) => x + 1), ms); return () => clearInterval(h); }, [on, ms]);
}

export interface Described { phase: Phase; title: string; sub: string; short: string; frac: number | null }
/** 把任务阶段 + 输出里程碑翻译成人话（标题、说明、卡片短句、进度比例） */
export function describe(a: Activity, p: Progress, now = Date.now()): Described {
  const phase: Phase = a.phase === 'grade' && p.syncing ? 'sync' : a.phase;
  const el = (a.job.ended_at && !['queued', 'register', 'grade', 'sync', 'work'].includes(phase) ? a.job.ended_at : now) - (phase === 'queued' ? queuedAt(a.job) : a.job.started_at);
  const t = fmt.clock(Math.max(0, el));
  const probe = p.probe ? `${p.probe.i}/${p.probe.n} ${PROBE[p.probe.type] || p.probe.type}` : '';
  switch (phase) {
    case 'queued': return { phase, title: a.job.kind === 'register' ? '排队等待登记' : a.job.kind === 'grade' ? '排队等待自动评分' : '排队中', sub: a.ahead ? `前面还有 ${a.ahead} 个任务 · 已等 ${t}` : `即将开始 · 已等 ${t}`, short: a.ahead ? `前面 ${a.ahead} 个任务` : '即将开始', frac: null };
    case 'register': return { phase, title: '正在登记', sub: `复制交付物、解析用时 · ${t}`, short: t, frac: null };
    case 'grade': return { phase, title: '自动评分中', sub: `${p.probe ? `探针 ${p.probe.i}/${p.probe.n} · ${PROBE[p.probe.type] || p.probe.type}` : '准备中'} · ${t}`, short: `${probe || '准备中'} · ${t}`, frac: p.probe ? (p.probe.i - 0.5) / p.probe.n : 0.03 };
    case 'sync': return { phase, title: '写入结果', sub: `汇总得分 · ${t}`, short: t, frac: 0.97 };
    case 'work': return { phase, title: a.job.title, sub: `运行中 · ${t}`, short: t, frac: null };
    case 'done': return { phase, title: a.job.kind === 'register' ? '登记完成' : a.job.kind === 'grade' ? '自动评分完成' : '完成', sub: `用时 ${t}`, short: `用时 ${t}`, frac: 1 };
    case 'failed': return { phase, title: a.job.kind === 'register' ? '登记失败' : a.job.kind === 'grade' ? '自动评分失败' : '失败', sub: a.job.error || `退出码 ${a.job.code ?? '—'}`, short: '点开查看原因', frac: null };
    default: return { phase, title: '已取消', sub: a.job.title, short: '', frac: null };
  }
}
export const isBad = (d: Described) => d.phase === 'failed' || d.phase === 'cancelled';

/** 细进度条：已知比例用 scaleX，未知时用不确定动画（减少动画偏好下改为原地明暗脉动） */
export function ActBar({ frac, lg }: { frac: number | null; lg?: boolean }) {
  return <div className={cls('act-bar', lg && 'lg', frac == null && 'indet')}><i style={frac != null ? { transform: `scaleX(${frac})` } : undefined} /></div>;
}

/** 分步进度：登记 → 自动评分 i/n → 写入结果 */
export function ActSteps({ a, p, d }: { a: Activity; p: Progress; d: Described }) {
  if (a.job.kind !== 'register' && a.job.kind !== 'grade') return null;
  const steps: { id: Phase[]; label: string }[] = [
    ...(a.job.kind === 'register' || d.phase === 'queued' ? [{ id: ['register'] as Phase[], label: '登记' }] : []),
    { id: ['grade'], label: p.probe ? `自动评分 ${p.probe.i}/${p.probe.n}` : '自动评分' },
    { id: ['sync'], label: '写入结果' },
  ];
  const curIdx = d.phase === 'done' ? steps.length : d.phase === 'queued' ? 0 : steps.findIndex((s) => s.id.includes(d.phase));
  return <ol className="act-steps">{steps.map((s, i) => <li key={s.label} className={cls(curIdx > i && 'done', curIdx === i && 'cur')}><i />{s.label}</li>)}</ol>;
}

// “控制台 0 错误”“0 failed” 这类计数不算报错
const lineTone = (l: string) => (/Traceback|✘|(?<![0０]\s?)(error|错误|失败|failed)/i.test(l) ? 'err' : /(?<![0０]\s?)(warn|警告)/i.test(l) ? 'warn' : /^\[probe \d+\/\d+\]/.test(l) ? 'mark' : l.startsWith('$ ') ? 'cmd' : undefined);

/** 任务输出终端：贴底自动滚动（向上翻看时不打断），错误 / 警告 / 探针里程碑着色 */
export function JobTerm({ lines, className, empty = '（暂无输出）' }: { lines: readonly string[]; className?: string; empty?: string }) {
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines.length]);
  return (
    <pre ref={box} className={cls('term', className)} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {lines.map((l, i) => <span key={i} className={lineTone(l)}>{l}{'\n'}</span>)}
      {!lines.length && <span className="muted">{empty}</span>}
    </pre>
  );
}

/** 任务标题行的短描述（宠物列表与设置页共用） */
export const jobMeta = (j: JobInfo) => `${fmt.time(j.started_at)} 开始${j.ended_at ? ` · 用时 ${fmt.clock(j.ended_at - j.started_at)}` : ''}${j.code != null ? ` · 退出码 ${j.code}` : ''}`;
