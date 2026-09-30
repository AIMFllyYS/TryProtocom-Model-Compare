// 评审：按“检查项”横向盲评——同一检查项的所有运行并排展示（与 bench-grader 评分包一致），0–3 锚点打分。
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, EyeOff, ListFilter, MonitorPlay, PlayCircle } from 'lucide-react';
import type { PreviewSession, SpecItem, StoreRun } from '../../shared/types';
import { rawUrl } from '../api';
import { useWb } from '../state';
import { go, useLocal, useRoute } from '../lib/router';
import { cls, fmt, METHOD_LABEL, TIER_LABEL } from '../lib/format';
import { Badge, Btn, Card, Empty, Seg, Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { DimChip } from '../components/common';
import { ItemScorer } from '../components/ItemScorer';
import { VideoPlayer } from '../components/VideoPlayer';
import { openArtifact, resolveArtifact } from '../components/artifact';

interface Q { key: string; task: string; tkey: string; item: SpecItem; runs: StoreRun[]; pending: number }

export default function Review() {
  const wb = useWb();
  const route = useRoute();
  const [method, setMethod] = useLocal<'human' | 'agent' | 'all'>('review.method', 'human');
  const [showDone, setShowDone] = useLocal('review.done', false);
  const onlyRun = route.query.get('run');
  const m = (route.query.get('method') as 'human' | 'agent' | null) || method;
  useEffect(() => { if (route.query.get('method')) setMethod(route.query.get('method') as 'human' | 'agent'); }, [route.query.get('method')]); // eslint-disable-line
  const spec = wb.spec, runs = wb.store?.runs || [];

  const queue = useMemo<Q[]>(() => {
    if (!spec) return [];
    const out: Q[] = [];
    for (const t of spec.tasks) {
      const tkeys = Object.keys(t.variants || {}).length ? Object.keys(t.variants).map((v) => t.id + v) : [t.id];
      for (const tk of tkeys) {
        const rs = runs.filter((r) => r.tkey === tk && r.graded && r.score && (!onlyRun || r.run_id === onlyRun));
        if (!rs.length) continue;
        for (const it of t.items) {
          if (it.method === 'auto' || (m !== 'all' && it.method !== m)) continue;
          if (it.variants.length && !it.variants.includes(tk.slice(3))) continue;
          const withItem = rs.filter((r) => r.score!.items.some((x) => x.id === it.id));
          if (!withItem.length) continue;
          const pending = withItem.filter((r) => r.score!.items.find((x) => x.id === it.id)?.status === 'pending').length;
          if (!pending && !showDone) continue;
          out.push({ key: tk + ':' + it.id, task: t.id, tkey: tk, item: it, runs: withItem.sort((a, b) => (a.alias || a.run_id).localeCompare(b.alias || b.run_id)), pending });
        }
      }
    }
    return out;
  }, [spec, runs, m, showDone, onlyRun]);
  const [cur, setCur] = useState<string | null>(null);
  const q = queue.find((x) => x.key === cur) || queue[0];
  const totalPending = queue.reduce((a, x) => a + x.pending, 0);
  const next = () => { const i = queue.findIndex((x) => x.key === q?.key); const n = queue.slice(i + 1).find((x) => x.pending) || queue.find((x) => x.pending && x.key !== q?.key); if (n) setCur(n.key); else toast.ok('本队列已全部评完'); };

  if (!spec) return <div className="page"><Spinner /></div>;
  return (
    <div className="page page-split">
      <aside className="side-list">
        <div className="side-h col gap-s">
          <Seg value={m} onChange={(v) => { setMethod(v); go('review', [], { run: onlyRun }, true); }} options={[{ value: 'human', label: '人工' }, { value: 'agent', label: 'Agent 项' }, { value: 'all', label: '全部' }]} />
          <label className="check xs"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />显示已评完的检查项</label>
          {onlyRun && <div className="row gap-s"><Badge tone="accent"><ListFilter size={11} /> 仅一次运行</Badge><button className="link xs" onClick={() => go('review', [], {}, true)}>显示全部</button></div>}
          <div className="muted xs">{queue.length} 个检查项 · {totalPending} 个待评分格</div>
        </div>
        <div className="side-scroll">
          {!queue.length && <p className="muted small pad">没有待评项。需要先登记并自动评分运行，人工 / Agent 项才会进入队列。</p>}
          {queue.map((x) => (
            <button key={x.key} className={cls('rv-i', q?.key === x.key && 'on')} onClick={() => setCur(x.key)}>
              <div className="row gap-xs"><span className="mono tid">{x.tkey}</span><span className="mono small">{x.item.id}</span><span className={`m-${x.item.method} xs`}>{METHOD_LABEL[x.item.method]}</span><div className="grow" />{x.pending ? <Badge tone="warn">{x.pending}</Badge> : <Badge tone="ok">✓</Badge>}</div>
              <div className="small ellipsis2">{x.item.desc}</div>
            </button>
          ))}
        </div>
      </aside>
      <div className="side-main">
        {!q ? <Empty icon={<ClipboardCheck size={30} />} title="没有待评检查项" /> : <ItemBoard q={q} onNext={next} key={q.key} />}
      </div>
    </div>
  );
}

function ItemBoard({ q, onNext }: { q: Q; onNext: () => void }) {
  const wb = useWb();
  const [focus, setFocus] = useState(0);
  const [preview, setPreview] = useLocal<'inline' | 'none'>('review.preview', 'inline');
  const it = q.item;
  // 键盘：J/K 或 ←/→ 切换运行，0–3 打分，N 下一个检查项
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); setFocus((f) => Math.min(q.runs.length - 1, f + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (e.key === 'n') { e.preventDefault(); onNext(); }
      else if (/^[0-3]$/.test(e.key)) {
        const btn = document.querySelector<HTMLButtonElement>(`.rv-card[data-i="${focus}"] .sc-btn.s${e.key}`);
        btn?.click();
        setTimeout(() => setFocus((f) => Math.min(q.runs.length - 1, f + 1)), 150);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [q, focus, onNext]);
  useEffect(() => { document.querySelector(`.rv-card[data-i="${focus}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focus]);
  return (
    <div className="stack">
      <Card>
        <div className="rv-head">
          <div className="grow">
            <div className="row gap-s wrap"><span className="mono tid">{q.tkey}</span><b className="mono">{it.id}</b><DimChip id={it.dim} /><span className={`tier-${it.tier} small`}>{TIER_LABEL[it.tier]}</span><span className={`m-${it.method} small`}>{METHOD_LABEL[it.method]}</span><span className="muted small">权重 {it.weight}</span></div>
            <h3 className="rv-t">{it.desc}</h3>
            {it.evidence && <div className="muted small">依据：{it.evidence}</div>}
          </div>
          <div className="col gap-s">
            <Badge tone={wb.blind ? 'accent' : 'warn'}><EyeOff size={11} /> {wb.blind ? '盲评中' : '未开启盲评'}</Badge>
            <Seg size="xs" value={preview} onChange={setPreview} options={[{ value: 'inline', label: '内嵌预览' }, { value: 'none', label: '仅打分' }]} />
          </div>
        </div>
        <div className="anchors">{it.anchors.map((a, i) => <div key={i} className={`anchor s${i}`}><b>{i}</b>{a}</div>)}</div>
        <div className="muted xs">快捷键：← → / J K 切换运行 · 0–3 打分并跳到下一个 · N 下一个检查项</div>
      </Card>
      <div className={cls('rv-grid', preview === 'none' && 'compact')}>
        {q.runs.map((r, i) => {
          const cur = r.manual[it.id];
          const sc = r.score!.items.find((x) => x.id === it.id);
          const ws = wb.store?.workspaces.find((w) => w.grader_run_id === r.run_id || w.ref === r.ws_ref);
          return (
            <div key={r.run_id} data-i={i} className={cls('rv-card', i === focus && 'focus', sc?.status === 'pending' && 'pending')} onMouseDown={() => setFocus(i)}>
              <div className="rv-card-h">
                <b className="mono">{wb.blind ? r.alias || `R${String(i + 1).padStart(3, '0')}` : r.run_id}</b>
                {!wb.blind && <span className="muted small ellipsis">{r.model} @ {r.harness}</span>}
                <div className="grow" />
                {sc?.status === 'scored' ? <Badge tone="ok">{fmt.n((sc.s || 0) * 3, 0)} 分</Badge> : <Badge tone="warn">待评</Badge>}
                <Btn size="xs" tone="ghost" icon={<MonitorPlay size={12} />} onClick={() => go('stage', [], { open: ws ? 'ws:' + ws.ref : 'run:' + r.run_id })}>舞台</Btn>
              </div>
              {preview === 'inline' && <MiniPreview r={r} label={wb.blind ? r.alias || r.run_id : r.run_id} />}
              <ItemScorer runId={r.run_id} item={it} cur={cur} by={it.method === 'agent' ? 'human (复核 agent 项)' : 'human'} />
            </div>
          );
        })}
      </div>
      <div className="row gap-s"><div className="grow" /><Btn tone="primary" onClick={onNext}>下一个检查项（N）</Btn></div>
    </div>
  );
}

function MiniPreview({ r, label }: { r: StoreRun; label: string }) {
  const wb = useWb();
  const ws = wb.store?.workspaces.find((w) => w.grader_run_id === r.run_id || w.ref === r.ws_ref);
  const a = resolveArtifact(ws, r, label);
  const [sess, setSess] = useState<PreviewSession | null>(null);
  const [on, setOn] = useState(a.kind === 'video');
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setSess(await openArtifact(a)); setOn(true); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  if (a.kind === 'none') return <div className="mini-prev muted small center-v">{a.reason}</div>;
  if (a.kind === 'video') return <div className="mini-prev"><VideoPlayer src={rawUrl(a.path)} name={label} /></div>;
  return (
    <div className="mini-prev">
      {on && sess ? <div className="mini-frame"><iframe src={sess.url} title={label} allow="autoplay; fullscreen" /></div>
        : <button className="mini-load" onClick={() => void load()} disabled={busy}>{busy ? <Spinner /> : <PlayCircle size={28} />}<span>加载预览</span></button>}
    </div>
  );
}
