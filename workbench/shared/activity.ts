// 运行 ↔ 后台任务的关联（纯函数，界面与测试共用）。
import type { JobInfo } from './types';

export type Phase = 'queued' | 'register' | 'grade' | 'sync' | 'failed' | 'cancelled';
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
export const isBusy = (a: Activity | null) => !!a && (a.phase === 'queued' || a.phase === 'register' || a.phase === 'grade' || a.phase === 'sync');
