// 跨视图复用的业务组件：盲评命名、维度标签、分数单元、新建模型 / 新建运行对话框、状态徽标。
import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ModelProfile, SpecTask, WorkspaceRun } from '../../shared/types';
import { post } from '../api';
import { useWb } from '../state';
import { cls, colorFor, fmt, scoreTone, WS_STATUS, wsStatus } from '../lib/format';
import { go } from '../lib/router';
import { Badge, Btn, CopyBtn, Field, Modal } from '../ui/kit';
import { toast } from '../ui/toast';

/** 盲评：把参赛者名替换成稳定的代号（按字典序编号，同一会话内一致）。 */
export function useNamer() {
  const { blind, agg, store } = useWb();
  return useMemo(() => {
    const ents = [...(agg?.entrants || [])].sort();
    const code = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : 'Z' + (i - 25));
    const models = [...new Set((store?.models || []).map((m) => `${m.vendor}/${m.name}`))].sort();
    return {
      blind,
      entrant: (e: string) => (blind ? `参赛者 ${code(Math.max(0, ents.indexOf(e)))}` : e),
      model: (vendor: string | null | undefined, name: string) => (blind ? `模型 ${code(Math.max(0, models.indexOf(`${vendor}/${name}`)))}` : vendor ? `${vendor} / ${name}` : name),
      run: (r: { alias?: string | null; run_id: string }) => (blind ? r.alias || '匿名运行' : r.run_id),
      ref: (ref: string) => {
        if (!blind) return ref;
        const [v, m, ...rest] = ref.split('/');
        return `模型 ${code(Math.max(0, models.indexOf(`${v}/${m}`)))}/${rest.join('/')}`;
      },
      color: (key: string) => colorFor(key, store?.models.find((m) => key.startsWith(m.name + ' @') || key === `${m.vendor}/${m.name}`)?.color),
    };
  }, [blind, agg, store]);
}

export function DimChip({ id, w, name }: { id: string; w?: number; name?: string }) {
  const { spec } = useWb();
  const d = spec?.dims.find((x) => x.id === id);
  return <span className={cls('chip', w === 0.5 && 'w05')}><i className="dot" style={{ background: `var(--d-${id}, var(--accent))` }} />{name || d?.name || id}{w != null && <span className="mono muted"> {w}</span>}</span>;
}

export function Score({ v, d = 1, big }: { v: number | null | undefined; d?: number; big?: boolean }) {
  return <span className={cls('score', `tone-${scoreTone(v)}`, big && 'big')}>{fmt.n(v, d)}</span>;
}

export function WsBadge({ w }: { w: WorkspaceRun }) {
  const s = WS_STATUS[wsStatus(w)];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function TaskLabel({ task, variant }: { task: string; variant?: string | null }) {
  const { spec } = useWb();
  const t = spec?.tasks.find((x) => x.id === task);
  return <span className="task-l"><span className="mono tid">{task}{variant || ''}</span>{t && <span className="task-n">{t.name}</span>}</span>;
}

// ---------- 新建 / 编辑模型 ----------
export function ModelModal({ open, onClose, init }: { open: boolean; onClose: () => void; init?: Partial<ModelProfile> }) {
  const { store, refresh } = useWb();
  const [f, setF] = useState<Partial<ModelProfile>>(init || { vendor: '', name: '', harness: store?.settings.default_harness || '' });
  const [busy, setBusy] = useState(false);
  const vendors = [...new Set((store?.models || []).map((m) => m.vendor))];
  const bad = /[<>:"/\\|?*]/;
  const errV = f.vendor && bad.test(f.vendor) ? '不能包含 <>:"/\\|?*' : null;
  const errN = f.name && (bad.test(f.name) || /[. ]$/.test(f.name)) ? '不能包含 <>:"/\\|?*，不能以点或空格结尾' : null;
  const save = async () => {
    setBusy(true);
    try {
      const m = await post<ModelProfile>('/api/models', { ...f, tags: typeof f.tags === 'string' ? String(f.tags).split(/[,，\s]+/).filter(Boolean) : f.tags });
      toast.ok(`已保存 ${m.vendor}/${m.name} → model/${m.vendor}/${m.name}/`);
      await refresh(['store']);
      onClose();
      if (!init) go('models', [m.vendor, m.name]);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (k: keyof ModelProfile) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={init ? `编辑模型 · ${init.vendor}/${init.name}` : '新增模型'} width={600}
      footer={<><Btn tone="ghost" onClick={onClose}>取消</Btn><Btn tone="primary" busy={busy} disabled={!f.vendor || !f.name || !!errV || !!errN} onClick={save}>保存</Btn></>}>
      <div className="form-grid">
        <Field label="供应商" hint="目录名，例如 OpenAI、Anthropic、Google、DeepSeek" error={errV}>
          <input list="wb-vendors" value={f.vendor || ''} onChange={set('vendor')} disabled={!!init} placeholder="OpenAI" autoFocus />
          <datalist id="wb-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="模型名称" hint="支持点与短横，例如 GPT-6.1-Sol、claude-opus-5.5" error={errN}>
          <input value={f.name || ''} onChange={set('name')} disabled={!!init} placeholder="GPT-6.1-Sol" />
        </Field>
        <Field label="显示名（可选）"><input value={f.display || ''} onChange={set('display')} placeholder="GPT-6.1 Sol" /></Field>
        <Field label="默认 harness" hint="运行时使用的 Agent 软件"><input list="wb-harness" value={f.harness || ''} onChange={set('harness')} placeholder="Codex CLI" /></Field>
        <Field label="系列 / 家族"><input value={f.family || ''} onChange={set('family')} placeholder="GPT-6" /></Field>
        <Field label="发布日期"><input type="date" value={f.release || ''} onChange={set('release')} /></Field>
        <Field label="标识色"><input type="color" value={f.color || colorFor(`${f.vendor}/${f.name}`)} onChange={set('color')} /></Field>
        <Field label="标签" hint="逗号分隔"><input value={Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags as unknown as string) || ''} onChange={(e) => setF({ ...f, tags: e.target.value as unknown as string[] })} placeholder="reasoning, preview" /></Field>
      </div>
      <Field label="备注"><textarea rows={3} value={f.notes || ''} onChange={set('notes')} placeholder="上下文长度、推理档位、API 版本等" /></Field>
      <HarnessList />
      {f.vendor && f.name && <p className="muted small">工作区：<code>model/{f.vendor}/{f.name}/</code></p>}
    </Modal>
  );
}
export function HarnessList() {
  const { store } = useWb();
  const hs = [...new Set(['Claude Code', 'Codex CLI', 'Gemini CLI', 'Kiro', 'Cursor', 'OpenCode', ...(store?.models || []).map((m) => m.harness || ''), ...(store?.workspaces || []).map((w) => w.harness)].filter(Boolean))];
  return <datalist id="wb-harness">{hs.map((h) => <option key={h} value={h} />)}</datalist>;
}

// ---------- 新建运行 ----------
export function NewRunModal({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: { vendor?: string; model?: string; task?: string; variant?: string } }) {
  const { store, spec, refresh } = useWb();
  const models = store?.models || [];
  const [key, setKey] = useState(preset?.vendor && preset?.model ? `${preset.vendor}/${preset.model}` : models[0] ? `${models[0].vendor}/${models[0].name}` : '');
  const [task, setTask] = useState(preset?.task || spec?.tasks[0]?.id || 'T01');
  const [variant, setVariant] = useState(preset?.variant || '');
  const m = models.find((x) => `${x.vendor}/${x.name}` === key);
  const [harness, setHarness] = useState(m?.harness || store?.settings.default_harness || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ run: WorkspaceRun; prompt: string; warnings: string[]; workspace?: string } | null>(null);
  const t: SpecTask | undefined = spec?.tasks.find((x) => x.id === task);
  const variants = Object.keys(t?.variants || {});
  const existing = (store?.workspaces || []).filter((w) => `${w.vendor}/${w.model}` === key && w.task === task && (w.variant || '') === (variant || ''));
  const create = async () => {
    if (!m) return;
    setBusy(true);
    try {
      const r = await post<{ run: WorkspaceRun; prompt: string; warnings: string[]; workspace: string }>('/api/ws/create', { vendor: m.vendor, model: m.name, task, variant: variant || null, harness });
      setResult(r);
      await refresh(['store']);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const close = () => { setResult(null); onClose(); };
  if (result) {
    return (
      <Modal open={open} onClose={close} title={`已创建 ${result.run.ref}`} width={760}
        footer={<><Btn tone="ghost" onClick={() => void post('/api/open-folder', { ref: result.run.ref })}>打开工作目录</Btn><CopyBtn text={result.prompt} label="复制提示词" /><Btn tone="primary" onClick={() => { close(); go('runs', [result.run.ref]); }}>进入运行</Btn></>}>
        <ol className="steps">
          <li>在 Agent 软件（{result.run.harness || 'harness'}）中把工作目录设为：<code className="sel">{result.workspace}</code></li>
          <li>复制下面的提示词发给模型；开始时点“开始计时”，结束后填写最后一条回复并登记。</li>
        </ol>
        {result.warnings.map((w, i) => <div key={i} className="alert warn"><TriangleAlert size={15} />{w}</div>)}
        <pre className="prompt">{result.prompt}</pre>
      </Modal>
    );
  }
  return (
    <Modal open={open} onClose={close} title="新建运行" width={620}
      footer={<><Btn tone="ghost" onClick={close}>取消</Btn><Btn tone="primary" busy={busy} disabled={!m || !task || (variants.length > 0 && !variant)} onClick={create}>创建干净工作目录</Btn></>}>
      {!models.length ? <p className="muted">还没有模型，先在“模型”页新增一个。</p> : (
        <div className="form-grid">
          <Field label="模型">
            <select value={key} onChange={(e) => { setKey(e.target.value); const mm = models.find((x) => `${x.vendor}/${x.name}` === e.target.value); if (mm?.harness) setHarness(mm.harness); }}>
              {models.map((x) => <option key={x.vendor + x.name} value={`${x.vendor}/${x.name}`}>{x.vendor} / {x.name}</option>)}
            </select>
          </Field>
          <Field label="Harness" hint="模型运行所在的 Agent 软件"><input list="wb-harness" value={harness} onChange={(e) => setHarness(e.target.value)} placeholder="Claude Code" /><HarnessList /></Field>
          <Field label="题目">
            <select value={task} onChange={(e) => { setTask(e.target.value); setVariant(''); }}>
              {(spec?.tasks || []).map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name}</option>)}
            </select>
          </Field>
          {variants.length > 0 && (
            <Field label="对照组">
              <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                <option value="">请选择</option>
                {variants.map((v) => <option key={v} value={v}>{v} 组 · {t?.variants[v].desc}</option>)}
              </select>
            </Field>
          )}
        </div>
      )}
      {t && (
        <div className="hint-box">
          <div><b>{t.id} {t.name}</b> · {t.short}</div>
          <div className="muted small">交付目录 <code>{t.deliverable}/</code> · 时间上限 {t.time_limit || '—'} 分钟 · {t.condition}</div>
          {t.materials.length > 0 && <div className="muted small">预置素材会自动复制：{t.materials.join('；')}</div>}
          {existing.length > 0 && <div className="small">已有 {existing.length} 次运行，这将是第 r{Math.max(...existing.map((w) => w.index)) + 1} 次（规范要求每题 {spec?.cfg.runs_per_task} 次）。</div>}
        </div>
      )}
    </Modal>
  );
}
