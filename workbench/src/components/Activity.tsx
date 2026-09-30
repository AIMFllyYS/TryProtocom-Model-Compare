// 运行 ↔ 后台任务：登记 / 自动评分是串行队列里的 Python 任务，可能要排队、跑几分钟。
// 这里把任务按 subject（工作区 ref / 评分 run_id）挂到对应运行上，给卡片和详情页显示
// “排队中 / 登记中 / 自动评分中（探针 i/n）/ 写入结果 / 失败”，避免用户以为点了没反应或出错了。
// 进度解析、文案与进度条 / 分步组件在 jobview.tsx，与桌面宠物共用。
import { CircleAlert, Loader2, RotateCcw, SquareTerminal, X } from 'lucide-react';
import { activityOf, isBusy, type Activity } from '../../shared/activity';
import { post } from '../api';
import { useWb } from '../state';
import { go } from '../lib/router';
import { cls } from '../lib/format';
import { Btn } from '../ui/kit';
import { toast } from '../ui/toast';
import { ActBar, ActSteps, describe, isBad, useJobProgress, useTick } from './jobview';

export { activityOf, isBusy, type Activity };

export function useRunActivity(ref?: string, runId?: string | null): Activity | null {
  const { jobs } = useWb();
  return activityOf(jobs, ref, runId);
}

/** 看板卡片底部：一行状态 + 细进度条 */
export function ActivityStrip({ a }: { a: Activity }) {
  const p = useJobProgress(a.job.id, a.phase === 'grade'); // 队列串行，同时只有一个在评分：中途打开页面时补齐输出才读得到当前探针
  useTick(isBusy(a));
  const d = describe(a, p);
  const bad = isBad(d);
  return (
    <div className={cls('act-strip', bad ? 'bad' : 'busy')} role="status" aria-live="polite">
      <div className="act-strip-t">
        {bad ? <CircleAlert size={13} /> : <Loader2 size={13} className="spin" />}
        <b>{d.title}</b><span className="muted ellipsis" title={d.sub}>{d.short}</span>
      </div>
      {!bad && <ActBar frac={d.frac} />}
    </div>
  );
}

/** 运行详情页：分步进度 + 实时输出最后一行 + 查看输出 / 取消 / 重试 */
export function ActivityBanner({ a, onRetry }: { a: Activity; onRetry?: () => void }) {
  const p = useJobProgress(a.job.id, true);
  useTick(isBusy(a));
  const d = describe(a, p);
  const bad = isBad(d);
  const view = () => go('settings', ['jobs'], { job: a.job.id });
  const cancel = () => void post(`/api/jobs/${a.job.id}/cancel`).then(() => toast.info('已取消'), (e) => toast.error(e.message));
  return (
    <div className={cls('act-banner glass mt', bad ? 'bad' : 'busy')} role="status" aria-live="polite">
      <div className="act-ico">{bad ? <CircleAlert size={18} /> : <Loader2 size={18} className="spin" />}</div>
      <div className="grow stack s">
        <div className="row gap-s wrap"><b>{d.title}</b><span className="muted small">{d.sub}</span></div>
        {!bad && (
          <>
            <ActSteps a={a} p={p} d={d} />
            <ActBar frac={d.frac} lg />
            <span className="muted xs">通常 1–3 分钟（跑隐藏测试、浏览器探针、ffprobe 等）。可以离开这个页面，完成后会弹出通知；桌面宠物里能看完整日志。</span>
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
