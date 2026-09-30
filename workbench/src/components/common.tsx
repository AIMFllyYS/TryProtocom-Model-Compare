// 跨视图复用的业务组件：盲评命名、维度标签、分数、运行状态、题目标签。
import { useMemo } from 'react';
import type { WorkspaceRun } from '../../shared/types';
import { useWb } from '../state';
import { cls, fmt, scoreTone, WS_STATUS, wsStatus } from '../lib/format';
import { vendorById } from '../../shared/vendors';
import { seriesColor } from '../ui/charts';
import { Badge } from '../ui/kit';

/** 盲评：把参赛者名替换成稳定代号（按字典序编号，同一会话内一致）。 */
export function useNamer() {
  const { blind, agg, store } = useWb();
  return useMemo(() => {
    const ents = [...(agg?.entrants || [])].sort();
    const code = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : 'Z' + (i - 25));
    const models = [...new Set((store?.models || []).map((m) => `${m.vendor}/${m.name}`))].sort();
    const vendorOf = (e: string) => store?.models.find((m) => e === m.name || e.startsWith(m.name + ' @'))?.vendor || null;
    return {
      blind,
      entrant: (e: string) => (blind ? `参赛者 ${code(Math.max(0, ents.indexOf(e)))}` : e),
      model: (vendor: string | null | undefined, name: string) => (blind ? `模型 ${code(Math.max(0, models.indexOf(`${vendor}/${name}`)))}` : name),
      run: (r: { alias?: string | null; run_id: string }) => (blind ? r.alias || '匿名运行' : r.run_id),
      ref: (ref: string) => {
        if (!blind) return ref;
        const [v, m, ...rest] = ref.split('/');
        return `模型 ${code(Math.max(0, models.indexOf(`${v}/${m}`)))}/${rest.join('/')}`;
      },
      vendorOf,
      /** 参赛者稳定配色：按排名中的位置取系列色 */
      color: (e: string) => seriesColor(Math.max(0, ents.indexOf(e))),
      vendorColor: (e: string) => vendorById(vendorOf(e))?.color || seriesColor(Math.max(0, ents.indexOf(e))),
    };
  }, [blind, agg, store]);
}

export function DimChip({ id, w, name }: { id: string; w?: number; name?: string }) {
  const { spec } = useWb();
  const d = spec?.dims.find((x) => x.id === id);
  return <span className={cls('chip', w === 0.5 && 'w05')}><i className="dot" style={{ background: `var(--d-${id}, var(--accent))` }} />{name || d?.name || id}{w != null && <span className="mono muted"> ×{w}</span>}</span>;
}

export function Score({ v, d = 1, big }: { v: number | null | undefined; d?: number; big?: boolean }) {
  return <span className={cls('score', `tone-${scoreTone(v)}`, big && 'big')}>{fmt.n(v, d)}</span>;
}

export function WsBadge({ w }: { w: WorkspaceRun }) {
  const s = WS_STATUS[wsStatus(w)];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function TaskLabel({ task, variant, short }: { task: string; variant?: string | null; short?: boolean }) {
  const { spec } = useWb();
  const t = spec?.tasks.find((x) => x.id === task);
  return <span className="task-l"><span className="tid">{task}{variant || ''}</span>{t && !short && <span className="task-n">{t.name}</span>}</span>;
}
