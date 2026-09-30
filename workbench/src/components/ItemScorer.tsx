// 单个人工 / Agent 检查项的 0–3 锚点打分控件（运行详情与评审页共用）。
// 乐观更新：点下立刻选中，后台保存，失败回滚。备注以分数为主键保存：没选分时写的备注保留为草稿，选分时一起保存。
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ManualScore, SpecItem } from '../../shared/types';
import { post } from '../api';
import { cls } from '../lib/format';
import { toast } from '../ui/toast';

export function ItemScorer({ runId, item, cur, compact, by = 'human', onSaved, autoFocus }: { runId: string; item: SpecItem; cur?: ManualScore | null; compact?: boolean; by?: string; onSaved?: (score: number | null) => void; autoFocus?: boolean }) {
  const [score, setScore] = useState<number | null>(cur?.score ?? null);
  const [note, setNote] = useState(cur?.note || '');
  const [saved, setSaved] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { setScore(cur?.score ?? null); setNote(cur?.note || ''); }, [cur?.score, cur?.note, runId, item.id]);
  const save = (s: number | null, n = note) => {
    const prev = score;
    setScore(s);
    queue.current = queue.current.then(async () => {
      try {
        await post(`/api/runs/${encodeURIComponent(runId)}/manual`, { item: item.id, score: s ?? '', note: n.trim(), by });
        setSaved(true); setTimeout(() => setSaved(false), 1200);
        onSaved?.(s);
      } catch (e: any) { setScore(prev); toast.error(e.message); }
    });
  };
  const anchors = item.anchors.length ? item.anchors : ['0 分', '1 分', '2 分', '3 分'];
  return (
    <div className={cls('scorer', compact && 'compact')}>
      <div className="scorer-btns" role="radiogroup" aria-label={`${item.id} 打分`}>
        {anchors.map((a, i) => (
          <button key={i} type="button" role="radio" aria-checked={score === i} className={cls('sc-btn', score === i && 'on', `s${i}`)} title={a} autoFocus={autoFocus && i === 0}
            onClick={() => save(score === i ? null : i)}>
            <b>{i}</b>{!compact && <span>{a}</span>}
          </button>
        ))}
      </div>
      <div className="scorer-note">
        <input placeholder={item.method === 'agent' ? '证据（文件路径、行号、观察）' : score == null ? '备注（选分时一起保存）' : '备注（可选，回车保存）'} value={note} onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const v = note.trim();
            if (score == null && /^[0-3]$/.test(v)) { setNote(''); save(Number(v), ''); return; } // 在备注里敲了分数：当作选分
            if (score != null && v !== (cur?.note || '')) save(score, v);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {saved && <span className="ok-mark"><Check size={14} /></span>}
        {score == null && note.trim() && !/^[0-3]$/.test(note.trim()) && <span className="muted xs">草稿</span>}
        {cur?.by && <span className="muted xs">by {cur.by}</span>}
      </div>
    </div>
  );
}
