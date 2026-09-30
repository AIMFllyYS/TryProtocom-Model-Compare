// 把“一次运行”解析成可预览的产物：视频直接播放，HTML / 目录开静态预览会话。
import type { PreviewSession, StoreRun, WorkspaceRun } from '../../shared/types';
import { post } from '../api';
import { isVideo } from '../lib/format';

export type Artifact =
  | { kind: 'video'; path: string; label: string }
  | { kind: 'static'; body: Record<string, unknown>; label: string }
  | { kind: 'none'; label: string; reason: string };

export function resolveArtifact(ws: WorkspaceRun | undefined, run: StoreRun | undefined, label: string): Artifact {
  // 1) bench-grader 为动画题渲染的统一评审视频优先（避免各家渲染环境差异）
  const vids = Object.entries(run?.artifacts || {}).filter(([, p]) => isVideo(p));
  const review = vids.find(([k]) => /review|评审/i.test(k)) || vids[0];
  if (review && !review[1].match(/^[a-z]:[\\/]|^\//i)) return { kind: 'video', path: review[1], label };
  // 2) 本地工作区的入口（dist/index.html → index.html → final.mp4 …）
  if (ws?.entry) {
    if (isVideo(ws.entry)) return { kind: 'video', path: `model/${ws.ref}/${ws.entry}`, label };
    return { kind: 'static', body: { ref: ws.ref, entry: ws.entry, label }, label };
  }
  if (ws) return { kind: 'static', body: { ref: ws.ref, entry: ws.deliverable_dir || '', label }, label };
  // 3) 只有存储记录：bench-grader 运行目录里的交付物副本
  if (run?.dir && !/^[a-z]:[\\/]|^\//i.test(run.dir)) return { kind: 'static', body: { path: `${run.dir}/output`, label }, label };
  return { kind: 'none', label, reason: '这台电脑上没有该运行的产物文件（仅有存储文件中的分数）' };
}

export async function openArtifact(a: Artifact): Promise<PreviewSession | null> {
  if (a.kind !== 'static') return null;
  return post<PreviewSession>('/api/preview', a.body);
}
