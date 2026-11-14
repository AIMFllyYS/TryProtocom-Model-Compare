// 运行详情里的单项打分。人工项用 1–10，Agent 项仍是 0–3。
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ManualScore, SpecItem } from '../../shared/types';
import { post } from '../api';
import { cls } from '../lib/format';
import { displayLevel, LEVEL_LETTERS, levelBand } from '../lib/humanScale';
import { toast } from '../ui/toast';

export function ItemScorer({ runId, item, cur, compact, by = 'human', onSaved, autoFocus }: { runId: string; item: SpecItem; cur?: ManualScore | null; compact?: boolean; by?: string; onSaved?: (score: number | null) => void; autoFocus?: boolean }) {
  const human10 = item.method === 'human' && (item.levels?.length === 10);
  const [score, setScore] = useState<number | null>(cur?.score ?? null);
  const [scale, setScale] = useState(cur?.scale);
  const [note, setNote] = useState(cur?.note || '');
  const [saved, setSaved] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { setScore(cur?.score ?? null); setScale(cur?.scale); setNote(cur?.note || ''); }, [cur?.score, cur?.note, cur?.scale, runId, item.id]);
  const shown = human10 ? displayLevel(score, scale) : score;
  const save = (s: number | null, n = note, nextScale?: string) => {
    if (human10 && s != null && displayLevel(score, scale) === s && nextScale === 'human-10') return;
    const prev = { score, scale };
    setScore(s);
    setScale(s == null ? undefined : nextScale);
    queue.current = queue.current.then(async () => {
      try {
        await post(`/api/runs/${encodeURIComponent(runId)}/manual`, { item: item.id, score: s ?? '', note: n.trim(), by, scale: nextScale === 'human-10' ? 'human-10' : '' });
        setSaved(true); setTimeout(() => setSaved(false), 1200);
        onSaved?.(s);
      } catch (e: any) { setScore(prev.score); setScale(prev.scale); toast.error(e.message); }
    });
  };
  const levels = human10 ? item.levels! : (item.anchors.length ? item.anchors : ['0 分', '1 分', '2 分', '3 分']);
  return (
    <div className={cls('scorer', compact && 'compact', human10 && 'human10')}>
      <div className="scorer-btns" role="radiogroup" aria-label={`${item.id} 打分`}>
        {levels.map((a, i) => {
          const value = human10 ? i + 1 : i;
          const on = shown === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={on} className={cls('sc-btn', on && 'on', `s${human10 ? levelBand(value) : i}`)} title={a} autoFocus={autoFocus && i === 0}
              onClick={() => { if (human10) { if (!on) save(value, note, 'human-10'); } else save(on ? null : value); }}>
              <b>{human10 ? LEVEL_LETTERS[i] : i}</b>{!compact && <span>{a}</span>}
            </button>
          );
        })}
      </div>
      <div className="scorer-note">
        <input placeholder={item.method === 'agent' ? '证据（文件路径、行号、观察）' : score == null ? '备注（选分时一起保存）' : '备注（可选，回车保存）'} value={note} onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const v = note.trim();
            if (score == null && (human10 ? /^(10|[1-9])$/.test(v) : /^[0-3]$/.test(v))) { setNote(''); save(Number(v), '', human10 ? 'human-10' : undefined); return; }
            if (score != null && v !== (cur?.note || '')) save(score, v, scale);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {saved && <span className="ok-mark"><Check size={14} /></span>}
        {score == null && note.trim() && <span className="muted xs">草稿</span>}
        {cur?.by && <span className="muted xs">by {cur.by}</span>}
      </div>
    </div>
  );
}
