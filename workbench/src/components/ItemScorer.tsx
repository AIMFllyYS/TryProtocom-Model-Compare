// 单个人工 / Agent 检查项的 0–3 锚点打分控件（运行详情与评审页共用）。
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { ManualScore, SpecItem } from '../../shared/types';
import { post } from '../api';
import { cls } from '../lib/format';
import { toast } from '../ui/toast';

export function ItemScorer({ runId, item, cur, compact, by = 'human', onSaved, autoFocus }: { runId: string; item: SpecItem; cur?: ManualScore | null; compact?: boolean; by?: string; onSaved?: (score: number | null) => void; autoFocus?: boolean }) {
  const [score, setScore] = useState<number | null>(cur?.score ?? null);
  const [note, setNote] = useState(cur?.note || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setScore(cur?.score ?? null); setNote(cur?.note || ''); }, [cur?.score, cur?.note, runId, item.id]);
  const save = async (s: number | null, n = note) => {
    setSaving(true);
    try {
      await post(`/api/runs/${encodeURIComponent(runId)}/manual`, { item: item.id, score: s ?? '', note: n, by });
      setScore(s); setSaved(true); setTimeout(() => setSaved(false), 1200);
      onSaved?.(s);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  const anchors = item.anchors.length ? item.anchors : ['0 分', '1 分', '2 分', '3 分'];
  return (
    <div className={cls('scorer', compact && 'compact')}>
      <div className="scorer-btns" role="radiogroup" aria-label={`${item.id} 打分`}>
        {anchors.map((a, i) => (
          <button key={i} role="radio" aria-checked={score === i} className={cls('sc-btn', score === i && 'on', `s${i}`)} disabled={saving} title={a} autoFocus={autoFocus && i === 0}
            onClick={() => void save(score === i ? null : i)}>
            <b>{i}</b>{!compact && <span>{a}</span>}
          </button>
        ))}
      </div>
      <div className="scorer-note">
        <input placeholder={item.method === 'agent' ? '证据（文件路径、行号、观察）' : '备注（可选）'} value={note} onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (score != null && note !== (cur?.note || '')) void save(score, note); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {saved && <span className="ok-mark"><Check size={14} /></span>}
        {cur?.by && <span className="muted xs">by {cur.by}</span>}
      </div>
    </div>
  );
}
