// 运行 ↔ 后台任务的关联（纯函数，界面与测试共用）。
import type { JobInfo } from './types';

export type Phase = 'queued' | 'register' | 'grade' | 'sync' | 'work' | 'done' | 'failed' | 'cancelled';
export interface Activity { job: JobInfo; phase: Phase; ahead: number }

const ACTIVE = (j: JobInfo) => j.status === 'running' || j.status === 'queued';
export const FAIL_WINDOW = 30 * 60000; // 失败提示保留 30 分钟（之后以运行本身的状态为准）
const hit = (j: JobInfo, ref?: string, runId?: string | null) =>
  (j.kind === 'register' || j.kind === 'grade') && !!j.subject && ((!!ref && !!j.subject.refs?.includes(ref)) || (!!runId && !!j.subject.run_ids?.includes(runId)));
export const queuedAt = (j: JobInfo) => j.queued_at ?? j.started_at;

/** 这次运行当前关联的任务：进行中优先（running > queued），其次是 30 分钟内最近一次失败 / 取消；之后成功过就不再显示 */
export function activityOf(jobs: JobInfo[], ref?: string, runId?: string | null, now = Date.now()): Activity | null {
  const mine = jobs.filter((j) => hit(j, ref, runId)).sort((a, b) => queuedAt(b) - queuedAt(a));
  if (!mine.length) return null;
  const act = mine.find((j) => j.status === 'running') || mine.find(ACTIVE);
  if (act) {
    const ahead = act.status === 'queued' ? jobs.filter((j) => ACTIVE(j) && j.id !== act.id && queuedAt(j) <= queuedAt(act)).length : 0;
    return { job: act, phase: act.status === 'queued' ? 'queued' : act.kind === 'register' ? 'register' : 'grade', ahead };
  }
  const last = mine[0];
  if ((last.status === 'failed' || last.status === 'cancelled') && now - (last.ended_at || 0) < FAIL_WINDOW) return { job: last, phase: last.status === 'failed' ? 'failed' : 'cancelled', ahead: 0 };
  return null;
}
export const isBusy = (a: Activity | null) => !!a && (a.phase === 'queued' || a.phase === 'register' || a.phase === 'grade' || a.phase === 'sync' || a.phase === 'work');

/** 单个任务的阶段（桌面宠物按任务列出，不经过运行） */
export function activityOfJob(job: JobInfo, jobs: JobInfo[]): Activity {
  if (job.status === 'queued') return { job, phase: 'queued', ahead: jobs.filter((j) => ACTIVE(j) && j.id !== job.id && queuedAt(j) <= queuedAt(job)).length };
  const phase: Phase = job.status === 'running' ? (job.kind === 'register' ? 'register' : job.kind === 'grade' ? 'grade' : 'work') : job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : 'cancelled';
  return { job, phase, ahead: 0 };
}
/** 桌面宠物关心的任务：进行中的全部 + 最近 windowMs 内结束的登记 / 评分（最多 max 个，进行中在前） */
export function petJobs(jobs: JobInfo[], now = Date.now(), windowMs = 15 * 60000, max = 6): JobInfo[] {
  const act = jobs.filter(ACTIVE).sort((a, b) => (a.status === b.status ? queuedAt(a) - queuedAt(b) : a.status === 'running' ? -1 : 1));
  const recent = jobs.filter((j) => !ACTIVE(j) && (j.kind === 'register' || j.kind === 'grade') && now - (j.ended_at || 0) < windowMs).sort((a, b) => (b.ended_at || 0) - (a.ended_at || 0));
  return [...act, ...recent].slice(0, max);
}
/** 进度里程碑：评分器每个探针打印一行 “[probe i/n] type”，结果写入阶段打印 “[after] …” */
export function parseProgress(lines: readonly string[]) {
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
export type Progress = ReturnType<typeof parseProgress>;
