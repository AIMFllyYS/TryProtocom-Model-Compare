// 发车台：为一个模型连续发题。左侧选题 → 中间是可拖拽的「提示词胶囊」→ 拖到右侧 harness 坞（或点击）即复制并记下时间戳 → 顺手记录开跑前剩余额度。
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { ArrowRight, Check, ClipboardCopy, Clock3, FolderOpen, Gauge, Grip, ListChecks, Package, Rocket, Wallet } from 'lucide-react';
import type { Billing, ModelProfile, SpecTask, WorkspaceRun } from '../../shared/types';
import { HARNESSES, harnessHint } from '../../shared/vendors';
import { deliverableFor } from '../../shared/deliverables';
import { QUOTA_UNITS, unitPrice } from '../../shared/quota';
import { get, post } from '../api';
import { useWb } from '../state';
import { go } from '../lib/router';
import { cls, copyText, fmt } from '../lib/format';
import { Badge, Btn, Field, Modal, Seg, Select } from '../ui/kit';
import { HarnessIcon, ModelAvatar } from '../ui/brand';
import { toast } from '../ui/toast';
import { findHarness, modelKey } from './pickers';

interface PromptRes { text: string; warnings: string[]; ref: string | null; workspace: string | null; index: number | null; exists: boolean }
interface Slot { t: SpecTask; v: string | null; key: string }

// ---------- 全局入口：任何页面调用 launch('供应商/模型', 'T05') 打开发车台 ----------
let host: ((k: { key: string; task?: string } | null) => void) | null = null;
export const launch = (key: string, task?: string) => { if (host) host({ key, task }); };
export function LaunchPadHost() {
  const wb = useWb();
  const [st, setSt] = useState<{ key: string; task?: string } | null>(null);
  useEffect(() => { host = setSt; return () => { host = null; }; }, []);
  const m = st && wb.store?.models.find((x) => modelKey(x) === st.key);
  useEffect(() => { if (m && wb.current !== st!.key) wb.setCurrent(st!.key); }, [m]); // eslint-disable-line
  if (!st || !m) return null;
  return <LaunchPad model={m} initialTask={st.task} onClose={() => setSt(null)} />;
}

export function LaunchPad({ model, onClose, initialTask }: { model: ModelProfile; onClose: () => void; initialTask?: string }) {
  const wb = useWb();
  const need = wb.spec?.cfg.runs_per_task || 3;
  const slots = useMemo<Slot[]>(() => (wb.spec?.tasks || []).flatMap((t): Slot[] => { const vs = Object.keys(t.variants || {}); return vs.length ? vs.map((v) => ({ t, v, key: t.id + v })) : [{ t, v: null, key: t.id }]; }), [wb.spec]);
  const runsOf = (s: Slot) => (wb.store?.workspaces || []).filter((w) => w.vendor === model.vendor && w.model === model.name && w.tkey === s.key);
  const doneOf = (s: Slot) => runsOf(s).filter((w) => w.started_at || w.grader_run_id).length;
  const [sel, setSel] = useState(() => initialTask ? slots.findIndex((s) => s.key.startsWith(initialTask)) : Math.max(0, slots.findIndex((s) => doneOf(s) < need)));
  const slot = slots[Math.max(0, sel)];
  const [pr, setPr] = useState<PromptRes | null>(null);
  const [stamp, setStamp] = useState<{ run: WorkspaceRun; opened: string | null; copied: boolean; text: string } | null>(null);
  const [harness, setHarness] = useState(model.harness || findHarness(wb.store?.settings.default_harness)?.name || '');
  useEffect(() => {
    if (!slot) return;
    setPr(null); setStamp(null);
    get<PromptRes>('/api/ws/prompt', { task: slot.t.id, variant: slot.v || undefined, for: modelKey(model) }).then(setPr, (e) => toast.error(e.message));
  }, [slot?.key, model.vendor, model.name]); // eslint-disable-line

  const installed = HARNESSES.filter((h) => wb.harness.find((x) => x.id === h.id)?.installed);
  const dock = [...installed].sort((a, b) => (a.name === harness ? -1 : b.name === harness ? 1 : 0)).slice(0, 6);

  const dispatch = useCallback(async (target: string | null) => {
    if (!pr?.text || !slot) return;
    const ok = await copyText(pr.text); // 用户手势内先复制
    const hname = target ? HARNESSES.find((h) => h.id === target)?.name || harness : harness;
    try {
      const r = await post<{ run: WorkspaceRun; text: string; opened: string | null }>('/api/ws/claim', { vendor: model.vendor, model: model.name, task: slot.t.id, variant: slot.v, index: pr.index, start: true, harness: hname, open: !!target });
      let copied = ok;
      if (r.text !== pr.text) copied = await copyText(r.text);
      if (target && hname !== model.harness) { setHarness(hname); void post('/api/models', { ...model, harness: hname }); }
      setStamp({ run: r.run, opened: r.opened, copied, text: r.text });
      await wb.refresh(['store']);
    } catch (e: any) { toast.error(e.message); }
  }, [pr, slot, model, harness, wb]);

  const next = () => { const i = slots.findIndex((s, k) => k > sel && doneOf(s) < need); setSel(i >= 0 ? i : Math.min(slots.length - 1, sel + 1)); };
  const total = slots.length * need;
  const done = slots.reduce((n, s) => n + Math.min(need, doneOf(s)), 0);

  return (
    <Modal open onClose={onClose} width={1120} className="launchpad" title={<span className="row gap-s"><ModelAvatar vendor={model.vendor} model={model.name} size="md" blind={wb.blind} /><span className="stack s" style={{ gap: 0 }}><span>{wb.blind ? '开始测评' : `开始测评 · ${model.display || model.name}`}</span><span className="modal-sub">已发车 {done}/{total} · 每题 {need} 次 · 拖动提示词胶囊到右侧的 harness 上即可发车</span></span></span>}>
      <div className="lp">
        <nav className="lp-tasks" aria-label="题目">
          {slots.map((s, i) => {
            const n = doneOf(s);
            return (
              <button key={s.key} className={cls('lp-task', i === sel && 'on', n >= need && 'full')} onClick={() => setSel(i)}>
                <b className="mono">{s.key}</b><span className="ellipsis grow">{s.t.name.replace(/（.*?）/g, '')}</span>
                <span className="tt-dots">{Array.from({ length: need }, (_, k) => <i key={k} className={cls(k < n && 'on')} />)}</span>
              </button>
            );
          })}
        </nav>
        <div className="lp-center">
          {slot && !stamp && <Capsule slot={slot} pr={pr} onDrop={dispatch} />}
          {slot && stamp && <StampCard stamp={stamp} model={model} slot={slot} onNext={next} onRecopy={() => void copyText(stamp.text).then((ok) => ok && setStamp({ ...stamp, copied: true }))} />}
        </div>
        <aside className="lp-dock" aria-label="harness 坞">
          <div className="lp-dock-h">发车坞</div>
          {dock.map((h) => (
            <button key={h.id} data-drop={h.id} className={cls('dock-t', h.name === harness && 'pref')} onClick={() => void dispatch(h.id)} disabled={!pr || !!stamp}>
              <HarnessIcon name={h.name} size="md" />
              <span className="stack s" style={{ gap: 0, minWidth: 0 }}><b className="ellipsis">{h.name}</b><span className="muted xs">{harnessHint(h.kind, wb.harness.find((x) => x.id === h.id)?.opens_dir)}</span></span>
            </button>
          ))}
          <button data-drop="__copy" className="dock-t copy" onClick={() => void dispatch(null)} disabled={!pr || !!stamp}>
            <span className="avatar md"><ClipboardCopy size={18} /></span>
            <span className="stack s" style={{ gap: 0 }}><b>仅复制</b><span className="muted xs">自己粘贴到任意软件</span></span>
          </button>
          {!installed.length && <p className="muted xs">本机没有检测到 harness，可在「设置 → Harness」重新检测。</p>}
        </aside>
      </div>
    </Modal>
  );
}

/** 可拖拽的提示词胶囊 */
function Capsule({ slot, pr, onDrop }: { slot: Slot; pr: PromptRes | null; onDrop: (target: string | null) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<{ x: number; y: number; id: number; drag: boolean } | null>(null);
  const [pos, setPos] = useState<{ dx: number; dy: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [fly, setFly] = useState<{ dx: number; dy: number } | null>(null);
  const d = deliverableFor(slot.t.id, slot.t.deliverable);
  const hit = (x: number, y: number) => (document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.drop) as HTMLElement | undefined);
  const mark = (id: string | null) => {
    document.querySelectorAll('[data-drop]').forEach((n) => n.classList.toggle('over', (n as HTMLElement).dataset.drop === id));
    setOver(id);
  };
  const down = (e: RPE) => { if (!pr || e.button !== 0) return; st.current = { x: e.clientX, y: e.clientY, id: e.pointerId, drag: false }; el.current?.setPointerCapture(e.pointerId); };
  const move = (e: RPE) => {
    const s = st.current; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.drag && Math.hypot(dx, dy) < 6) return;
    if (!s.drag) { s.drag = true; document.body.classList.add('lp-dragging'); }
    setPos({ dx, dy });
    const t = hit(e.clientX, e.clientY);
    mark(t?.dataset.drop || null);
  };
  const up = (e: RPE) => {
    const s = st.current; st.current = null;
    document.body.classList.remove('lp-dragging');
    if (!s?.drag) return;
    const t = hit(e.clientX, e.clientY);
    mark(null);
    if (t && el.current) {
      const a = t.getBoundingClientRect(), b = el.current.getBoundingClientRect();
      setFly({ dx: (pos?.dx || 0) + a.left + a.width / 2 - (b.left + b.width / 2), dy: (pos?.dy || 0) + a.top + a.height / 2 - (b.top + b.height / 2) });
      t.classList.add('hit');
      setTimeout(() => t.classList.remove('hit'), 700);
      onDrop(t.dataset.drop === '__copy' ? null : t.dataset.drop!);
    } else setPos(null);
  };
  const style = fly ? { transform: `translate(${fly.dx}px, ${fly.dy}px) scale(.2)`, opacity: 0, transition: 'transform .45s cubic-bezier(.5,0,.2,1), opacity .45s' }
    : pos ? { transform: `translate(${pos.dx}px, ${pos.dy}px) rotate(${Math.max(-6, Math.min(6, pos.dx / 40))}deg) scale(${over ? 0.42 : 0.55})`, transition: 'transform .12s ease-out', transformOrigin: '50% 12%' } : undefined;
  return (
    <div className="lp-stage">
      <div ref={el} className={cls('capsule glass-thick', pos && 'dragging', !pr && 'loading')} style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { st.current = null; setPos(null); mark(null); document.body.classList.remove('lp-dragging'); }} role="button" aria-label="拖动到 harness 发车">
        <div className="cap-grip"><Grip size={14} />拖我发车</div>
        <div className="row gap-s"><span className="task-badge sm">{slot.key}</span><b className="cap-t ellipsis">{slot.t.name}</b></div>
        <p className="muted small">{slot.t.short}</p>
        <div className="chips">
          {slot.t.time_limit && <span className="chip"><Clock3 size={12} />{slot.t.time_limit} 分钟</span>}
          <span className="chip"><Package size={12} />{d.dir}/</span>
          <span className="chip"><ListChecks size={12} />{slot.t.items.length} 项</span>
        </div>
        <div className="cap-ws mono"><FolderOpen size={12} />{pr?.workspace ? pr.workspace.split(/[\\/]/).slice(-4).join('\\') : '…'}<Badge tone={pr?.exists ? 'info' : 'accent'}>{pr?.exists ? '复用' : `r${pr?.index ?? '?'}`}</Badge></div>
        <pre className="cap-prompt">{pr ? pr.text.split('\n').slice(0, 14).join('\n') : ''}</pre>
      </div>
      <p className="lp-hint muted small"><ArrowRight size={13} />拖到右侧 harness：复制提示词 + 打开它 + 记下时间戳。也可以直接点右侧按钮。</p>
    </div>
  );
}

/** 发车后的时间戳 + 额度记录 */
function StampCard({ stamp, model, slot, onNext, onRecopy }: { stamp: { run: WorkspaceRun; opened: string | null; copied: boolean }; model: ModelProfile; slot: Slot; onNext: () => void; onRecopy: () => void }) {
  const wb = useWb();
  const t = stamp.run.started_at ? new Date(stamp.run.started_at) : new Date();
  return (
    <div className="stamp glass-thick">
      <div className="stamp-top">
        <span className="stamp-ic"><Rocket size={20} /></span>
        <div className="grow">
          <div className="muted xs">{slot.key} · r{stamp.run.index} 已发车{stamp.opened ? ` · ${stamp.opened}` : ''}</div>
          <div className="stamp-time">{t.toLocaleTimeString('zh-CN', { hour12: false })}</div>
          <div className="muted xs">{t.toLocaleDateString('zh-CN')} · 只记时间戳，不在后台持续计时；模型写出 FINAL_MESSAGE.md 时自动记结束时间</div>
        </div>
      </div>
      {!stamp.copied && <div className="alert warn">浏览器没允许自动写剪贴板（拖得太久）。<Btn size="xs" tone="tinted" onClick={onRecopy}>点此复制提示词</Btn></div>}
      <QuotaForm run={stamp.run} model={model} phase="before" />
      <div className="row gap-s">
        <Btn icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { ref: stamp.run.ref })}>工作目录</Btn>
        <Btn tone="ghost" onClick={() => go('runs', [stamp.run.ref])}>查看运行</Btn>
        <span className="grow" />
        <Btn tone="primary" iconRight={<ArrowRight size={15} />} onClick={onNext}>下一题</Btn>
      </div>
    </div>
  );
}

/** 额度记录：开跑前 / 结束后剩余额度；订阅制按周期费用 ÷ 周期额度换算成美元 */
export function QuotaForm({ run, model, phase, compact, onSaved }: { run: WorkspaceRun; model: ModelProfile; phase: 'before' | 'after'; compact?: boolean; onSaved?: () => void }) {
  const wb = useWb();
  const b0: Billing = model.billing || { mode: 'subscription', unit: '次' };
  const [bill, setBill] = useState<Billing>(b0);
  const [edit, setEdit] = useState(!model.billing);
  const [unit, setUnit] = useState(run.quota?.unit || b0.unit || '次');
  const [val, setVal] = useState<string>(phase === 'before' ? (run.quota?.before ?? '').toString() : (run.quota?.after ?? '').toString());
  const [saved, setSaved] = useState(false);
  const price = unitPrice({ ...bill, unit });
  const before = run.quota?.before;
  const used = phase === 'after' && before != null && val !== '' ? Math.max(0, before - Number(val)) : null;
  const save = async () => {
    try {
      if (edit || JSON.stringify(bill) !== JSON.stringify(model.billing || null)) await post('/api/models', { ...model, billing: { ...bill, unit } });
      if (val !== '' && bill.mode !== 'free') await post('/api/ws/quota', { ref: run.ref, unit, [phase]: Number(val) });
      setSaved(true); setEdit(false);
      await wb.refresh(['store']);
      onSaved?.();
      toast.ok(phase === 'before' ? '已记录开跑前额度' : '已记录结束后额度');
    } catch (e: any) { toast.error(e.message); }
  };
  if (bill.mode === 'token' && !edit) return (
    <div className="quota q-token"><Gauge size={15} /><span className="grow small dim">{model.name} 按 token 计费：费用由 harness 日志 × 单价自动估算，无需记录额度。</span><Btn size="xs" tone="ghost" onClick={() => setEdit(true)}>改计费方式</Btn></div>
  );
  return (
    <div className={cls('quota', compact && 'compact')}>
      <div className="row gap-s"><Wallet size={15} /><b className="small">{phase === 'before' ? '开跑前剩余额度' : '结束后剩余额度'}</b><span className="muted xs">{bill.plan ? `· ${bill.plan}` : ''}{price != null ? ` · 约 $${price.toFixed(price < 0.1 ? 4 : 3)}/${unit}` : ''}</span><span className="grow" />{!edit && <Btn size="xs" tone="ghost" onClick={() => setEdit(true)}>计费设置</Btn>}</div>
      {edit && (
        <div className="quota-cfg">
          <Seg size="xs" value={bill.mode} onChange={(m) => setBill({ ...bill, mode: m })} options={[{ value: 'subscription', label: '订阅额度' }, { value: 'token', label: '按 token' }, { value: 'free', label: '不记录' }]} />
          {bill.mode === 'subscription' && (
            <div className="form-grid">
              <Field label="套餐"><input value={bill.plan || ''} onChange={(e) => setBill({ ...bill, plan: e.target.value })} placeholder="例如 ChatGPT Pro / Claude Max" /></Field>
              <Field label="每周期费用（美元）"><input type="number" step="0.01" value={bill.monthly_fee ?? ''} onChange={(e) => setBill({ ...bill, monthly_fee: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="200" /></Field>
              <Field label={`每周期总额度（${unit}）`}><input type="number" value={bill.monthly_quota ?? ''} onChange={(e) => setBill({ ...bill, monthly_quota: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="例如 5 小时窗口 100%" /></Field>
            </div>
          )}
        </div>
      )}
      {bill.mode === 'subscription' && (
        <div className="row gap-s">
          <input className="input" type="number" step="any" value={val} onChange={(e) => { setVal(e.target.value); setSaved(false); }} placeholder={phase === 'before' ? '现在还剩多少' : '现在还剩多少'} style={{ maxWidth: 180 }} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          <Select size="sm" value={unit} onChange={setUnit} options={QUOTA_UNITS.map((u) => ({ value: u, label: u }))} />
          {used != null && <span className="small dim">用掉 <b>{fmt.n(used, 1)}</b> {unit}{price != null ? <> ≈ <b>{fmt.usd(used * price)}</b></> : unit === '美元' ? <> = <b>{fmt.usd(used)}</b></> : ''}</span>}
          <span className="grow" />
          {saved ? <Badge tone="ok"><Check size={11} />已记录</Badge> : <Btn size="sm" tone="tinted" onClick={() => void save()}>{edit ? '保存' : '记录'}</Btn>}
        </div>
      )}
      {bill.mode === 'free' && <div className="row"><span className="muted small grow">不记录额度（免费额度或不关心成本）。</span>{edit && <Btn size="sm" tone="tinted" onClick={() => void save()}>保存</Btn>}</div>}
      {bill.mode === 'token' && edit && <div className="row"><span className="muted small grow">费用由 harness 日志 × 单价自动估算。</span><Btn size="sm" tone="tinted" onClick={() => void save()}>保存</Btn></div>}
    </div>
  );
}

