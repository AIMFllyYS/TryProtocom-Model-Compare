// 把一次运行解析成可预览的产物：视频题播成片，网页题开 HTML。评分器另存的评审视频不代替网页。
import type { PreviewSession, StoreRun, WorkspaceRun } from '../../shared/types';
import { choosePreview } from '../../shared/artifact-selection';
import { post } from '../api';

export type Artifact =
  | { kind: 'video'; path: string; label: string }
  | { kind: 'static'; body: Record<string, unknown>; label: string }
  | { kind: 'none'; label: string; reason: string };

export function resolveArtifact(ws: WorkspaceRun | undefined, run: StoreRun | undefined, label: string): Artifact {
  const choice = choosePreview({
    task: ws?.task || run?.task, ref: ws?.ref, entry: ws?.entry, deliverableDir: ws?.deliverable_dir,
    artifacts: run?.artifacts, runDir: run?.dir,
  });
  if (choice.kind === 'video') return { kind: 'video', path: choice.path, label };
  if (choice.kind === 'static') return { kind: 'static', body: { ...choice.body, label }, label };
  return { kind: 'none', label, reason: choice.reason };
}

export async function openArtifact(a: Artifact): Promise<PreviewSession | null> {
  if (a.kind !== 'static') return null;
  return post<PreviewSession>('/api/preview', a.body);
}
