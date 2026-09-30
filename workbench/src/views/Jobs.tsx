// 任务：后台串行执行的评分 / 导出 / 依赖检查等，实时输出。
import { useEffect, useRef } from 'react';
import { Ban, Gauge } from 'lucide-react';
import type { JobInfo } from '../../shared/types';
import { get, post } from '../api';
import { bus, jobKey, useBus, useWb } from '../state';
import { href, useRoute } from '../lib/router';
import { cls, fmt } from '../lib/format';
import { Badge, Btn, Empty } from '../ui/kit';

const TONE: Record<JobInfo['status'], string> = { queued: 'muted', running: 'info', done: 'ok', failed: 'bad', cancelled: 'muted' };
const LABEL: Record<JobInfo['status'], string> = { queued: '排队中', running: '运行中', done: '完成', failed: '失败', cancelled: '已取消' };

export default function Jobs() {
  const wb = useWb();
  const route = useRoute();
  const cur = wb.jobs.find((j) => j.id === route.parts[0]) || wb.jobs[0];
  const quick: [string, Record<string, unknown>][] = [
    ['评分未评分运行', { kind: 'grade', all: true, skip_graded: true }], ['生成评分包', { kind: 'review' }], ['导出报表', { kind: 'export' }],
    ['依赖检查', { kind: 'doctor' }], ['rubric 自检', { kind: 'validate' }], ['同步存储', { kind: 'sync' }],
  ];
  return (
    <div className="page page-split">
      <aside className="side-list">
        <div className="side-h wrap gap-xs">{quick.map(([l, b]) => <Btn key={l} size="xs" onClick={() => void wb.runJob(b, l)}>{l}</Btn>)}</div>
        <div className="side-scroll">
          {!wb.jobs.length && <p className="muted small pad">本次启动后还没有任务。任务按顺序逐个执行，避免同时占用大量内存。</p>}
          {wb.jobs.map((j) => (
            <a key={j.id} href={href('jobs', [j.id])} className={cls('job-i', cur?.id === j.id && 'on')}>
              <div className="row gap-s"><Badge tone={TONE[j.status]} dot>{LABEL[j.status]}</Badge><span className="muted xs">{fmt.ago(j.started_at)}</span></div>
              <div className="small ellipsis2">{j.title}</div>
            </a>
          ))}
        </div>
      </aside>
      <div className="side-main">{cur ? <JobDetail j={cur} key={cur.id} /> : <Empty icon={<Gauge size={30} />} title="没有任务" />}</div>
    </div>
  );
}

function JobDetail({ j }: { j: JobInfo }) {
  const lines = useBus<string>(jobKey(j.id));
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => { get<{ output: string[] }>(`/api/jobs/${j.id}`).then((r) => bus.set(jobKey(j.id), r.output || [])).catch(() => {}); }, [j.id]);
  useEffect(() => { const el = box.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight; }, [lines.length]);
  const dur = (j.ended_at || Date.now()) - j.started_at;
  return (
    <div className="stack fill">
      <div className="detail-h">
        <div className="grow">
          <div className="row gap-s"><Badge tone={TONE[j.status]} dot>{LABEL[j.status]}</Badge><span className="mono muted small">{j.kind} · {j.id}</span></div>
          <h2>{j.title}</h2>
          <div className="muted small">开始 {fmt.time(j.started_at)} · 耗时 {fmt.clock(dur)}{j.code != null ? ` · 退出码 ${j.code}` : ''}{j.error ? ` · ${j.error}` : ''}</div>
        </div>
        {(j.status === 'running' || j.status === 'queued') && <Btn tone="danger" icon={<Ban size={14} />} onClick={() => void post(`/api/jobs/${j.id}/cancel`)}>取消</Btn>}
      </div>
      {j.result != null && <pre className="code small">{JSON.stringify(j.result, null, 2)}</pre>}
      <pre ref={box} className="term grow-term">{lines.map((l, i) => <span key={i} className={/error|错误|失败|Traceback/i.test(l) ? 'err' : /warn|警告/i.test(l) ? 'warn' : undefined}>{l}{'\n'}</span>)}{!lines.length && <span className="muted">（暂无输出）</span>}</pre>
    </div>
  );
}
