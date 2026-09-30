// 运行 ↔ 后台任务：登记 / 自动评分是串行队列里的 Python 任务，可能要排队、跑几分钟。
// 这里把任务按 subject（工作区 ref / 评分 run_id）挂到对应运行上，给卡片和详情页显示
// “排队中 / 登记中 / 自动评分中（探针 i/n）/ 写入结果 / 失败”，避免用户以为点了没反应或出错了。
import { useEffect, useState } from 'react';
import { CircleAlert, Loader2, RotateCcw, SquareTerminal, X } from 'lucide-react';
import { activityOf, isBusy, queuedAt as qat, type Activity, type Phase } from '../../shared/activity';
import { post } from '../api';
import { jobKey, useBus, useWb } from '../state';
import { go } from '../lib/router';
import { cls, fmt } from '../lib/format';
import { Btn } from '../ui/kit';
import { toast } from '../ui/toast';

export { activityOf, isBusy, type Activity };

export function useRunActivity(ref?: string, runId?: string | null): Activity | null {
  const { jobs } = useWb();
  return activityOf(jobs, ref, runId);
}

const PROBE: Record<string, string> = { api: 'API 测试', browser: '浏览器探针', build: '构建', claims: '汇报核对', diff: '代码改动', docs: '文档检查', files: '文件检查', mcproject: '工程检查', timeline: '时间线', transcript: '对话记录', video: '视频分析' };

/** 从任务输出里读当前进度：探针 i/n、是否进入“写入结果” */
function useProgress(a: Activity | null) {
  const lines = useBus<string>(a ? jobKey(a.job.id) : 'job:none');
  let probe: { i: number; n: number; type: string } | null = null;
  let syncing = false;
  let last = '';
  for (let k = lines.length - 1; k >= 0 && k >= lines.length - 400; k--) {
    const l = String(lines[k]);
    if (!last && l.trim() && !l.startsWith('$ ')) last = l.trim();
    if (l.startsWith('[after]')) { syncing = true; continue; }
    const m = /^\[probe (\d+)\/(\d+)\] (\S+)/.exec(l);
    if (m) { probe = { i: +m[1], n: +m[2], type: m[3] }; break; }
  }
  return { probe, syncing, last };
}

function useTick(on: boolean, ms = 1000) {
  const [, t] = useState(0);
  useEffect(() => { if (!on) return; const h = setInterval(() => t((x) => x + 1), ms); return () => clearInterval(h); }, [on, ms]);
}

function describe(a: Activity, p: ReturnType<typeof useProgress>) {
  const phase: Phase = a.phase === 'grade' && p.syncing ? 'sync' : a.phase;
  const el = Date.now() - (a.phase === 'queued' ? qat(a.job) : a.job.started_at);
  const t = fmt.clock(Math.max(0, el));
  switch (phase) {
    case 'queued': return { phase, title: a.job.kind === 'register' ? '排队等待登记' : '排队等待自动评分', sub: a.ahead ? `前面还有 ${a.ahead} 个任务 · 已等 ${t}` : `即将开始 · 已等 ${t}`, short: a.ahead ? `前面 ${a.ahead} 个任务` : '即将开始', frac: null as number | null };
    case 'register': return { phase, title: '正在登记', sub: `复制交付物、解析用时 · ${t}`, short: t, frac: null };
    case 'grade': return { phase, title: '自动评分中', sub: `${p.probe ? `探针 ${p.probe.i}/${p.probe.n} · ${PROBE[p.probe.type] || p.probe.type}` : '准备中'} · ${t}`, short: `${p.probe ? `${p.probe.i}/${p.probe.n} ${PROBE[p.probe.type] || p.probe.type}` : '准备中'} · ${t}`, frac: p.probe ? (p.probe.i - 0.5) / p.probe.n : 0.03 };
    case 'sync': return { phase, title: '写入结果', sub: `汇总得分 · ${t}`, short: t, frac: 0.97 };
    case 'failed': return { phase, title: a.job.kind === 'register' ? '登记失败' : '自动评分失败', sub: a.job.error || `退出码 ${a.job.code ?? '—'}`, short: '点开查看原因', frac: null };
    default: return { phase, title: '已取消', sub: a.job.title, short: '', frac: null };
  }
}

/** 看板卡片底部：一行状态 + 细进度条 */
export function ActivityStrip({ a }: { a: Activity }) {
  const p = useProgress(a);
  useTick(isBusy(a));
  const d = describe(a, p);
  const bad = d.phase === 'failed' || d.phase === 'cancelled';
  return (
    <div className={cls('act-strip', bad ? 'bad' : 'busy')} role="status" aria-live="polite">
      <div className="act-strip-t">
        {bad ? <CircleAlert size={13} /> : <Loader2 size={13} className="spin" />}
        <b>{d.title}</b><span className="muted ellipsis" title={d.sub}>{d.short}</span>
      </div>
      {!bad && <div className={cls('act-bar', d.frac == null && 'indet')}><i style={d.frac != null ? { transform: `scaleX(${d.frac})` } : undefined} /></div>}
    </div>
  );
}

/** 运行详情页：分步进度 + 实时输出最后一行 + 查看输出 / 取消 / 重试 */
export function ActivityBanner({ a, onRetry }: { a: Activity; onRetry?: () => void }) {
  const p = useProgress(a);
  useTick(isBusy(a));
  const d = describe(a, p);
  const bad = d.phase === 'failed' || d.phase === 'cancelled';
  const steps: { id: Phase[]; label: string }[] = [
    ...(a.job.kind === 'register' || d.phase === 'queued' ? [{ id: ['register'] as Phase[], label: '登记' }] : []),
    { id: ['grade'], label: p.probe ? `自动评分 ${p.probe.i}/${p.probe.n}` : '自动评分' },
    { id: ['sync'], label: '写入结果' },
  ];
  const curIdx = d.phase === 'queued' ? 0 : steps.findIndex((s) => s.id.includes(d.phase));
  const view = () => go('settings', ['jobs'], { job: a.job.id });
  const cancel = () => void post(`/api/jobs/${a.job.id}/cancel`).then(() => toast.info('已取消'), (e) => toast.error(e.message));
  return (
    <div className={cls('act-banner glass mt', bad ? 'bad' : 'busy')} role="status" aria-live="polite">
      <div className="act-ico">{bad ? <CircleAlert size={18} /> : <Loader2 size={18} className="spin" />}</div>
      <div className="grow stack s">
        <div className="row gap-s wrap"><b>{d.title}</b><span className="muted small">{d.sub}</span></div>
        {!bad && (
          <>
            <ol className="act-steps">{steps.map((s, i) => <li key={s.label} className={cls(curIdx > i && 'done', curIdx === i && 'cur')}><i />{s.label}</li>)}</ol>
            <div className={cls('act-bar lg', d.frac == null && 'indet')}><i style={d.frac != null ? { transform: `scaleX(${d.frac})` } : undefined} /></div>
            <span className="muted xs">通常 1–3 分钟（跑隐藏测试、浏览器探针、ffprobe 等）。可以离开这个页面，完成后会弹出通知。</span>
          </>
        )}
        {p.last && <code className="act-last ellipsis" title={p.last}>{p.last}</code>}
      </div>
      <div className="row gap-s act-x">
        <Btn size="sm" tone="ghost" icon={<SquareTerminal size={14} />} onClick={view}>查看输出</Btn>
        {isBusy(a) && <Btn size="sm" tone="ghost" icon={<X size={14} />} onClick={cancel}>取消</Btn>}
        {bad && onRetry && <Btn size="sm" icon={<RotateCcw size={14} />} onClick={onRetry}>重试</Btn>}
      </div>
    </div>
  );
}
