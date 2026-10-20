// 模型与 harness 选择器 + 智能新增模型（只输入名字：自动识别供应商、目录与推荐 harness）。
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FolderPlus, Layers, Plus, Sparkles, Wand2 } from 'lucide-react';
import type { ModelProfile } from '../../shared/types';
import { HARNESSES, harnessById, harnessByName, customHarnessNames, normalizeHarnessName, VENDORS, vendorById } from '../../shared/vendors';
import { get, post } from '../api';
import { useWb } from '../state';
import { cls } from '../lib/format';
import { Btn, Field, Modal, Select, type Opt } from '../ui/kit';
import { BrandIcon, HarnessIcon, ModelAvatar } from '../ui/brand';
import { toast } from '../ui/toast';

export const modelKey = (m: { vendor: string; name: string }) => `${m.vendor}/${m.name}`;

/** 「全部模型」的图标：叠层示意，与品牌头像同尺寸同质感 */
const AllIcon = ({ size = 'xs' }: { size?: 'xs' | 'sm' }) => (
  <span className={cls('avatar lettered', size)} style={{ ['--c' as string]: '#8a8fa3' }} aria-hidden><Layers size={size === 'sm' ? 14 : 12} /></span>
);

export function ModelPicker({ value, onChange, size, glassy = true, block, placeholder = '选择测评模型', allowAdd = true, allowAll = false, allLabel = '全部模型', className }: { value: string; onChange: (k: string) => void; size?: 'xs' | 'sm' | 'lg'; glassy?: boolean; block?: boolean; placeholder?: string; allowAdd?: boolean; allowAll?: boolean; allLabel?: string; className?: string }) {
  const { store, blind } = useWb();
  const [add, setAdd] = useState(false);
  // 「全部」用空串表示：与筛选器默认值一致，选中即不筛选模型
  const all: Opt[] = allowAll ? [{ value: '', text: '全部模型', group: '全部', label: allLabel, desc: '不筛选模型', icon: <AllIcon size="sm" /> }] : [];
  const opts: Opt[] = [...all, ...(store?.models || []).map((m) => ({
    value: modelKey(m), text: `${m.vendor} ${m.name} ${m.display || ''}`, group: vendorById(m.vendor)?.name || m.vendor,
    label: m.display || m.name, desc: m.harness ? `${m.vendor} · ${m.harness}` : m.vendor,
    icon: <ModelAvatar vendor={m.vendor} model={m.name} size="sm" blind={blind} />,
  }))];
  return (
    <>
      <Select value={value} onChange={onChange} options={opts} placeholder={placeholder} size={size} glassy={glassy} block={block} searchable={opts.length > 6} label="测评模型" className={cls('model-pick', className)}
        render={(o) => {
          if (allowAll && !value) return <><AllIcon /><span className="ellipsis">{allLabel}</span></>;
          const m = store?.models.find((x) => modelKey(x) === o?.value);
          return m ? <><ModelAvatar vendor={m.vendor} model={m.name} size="xs" blind={blind} /><span className="ellipsis">{blind ? '当前模型' : m.display || m.name}</span></> : <span className="sel-ph">{placeholder}</span>;
        }}
        footer={allowAdd ? <button type="button" className="opt" onClick={() => setAdd(true)}><Plus size={15} /><span className="opt-t">新增模型…</span></button> : undefined} />
      {add && <AddModelDialog onClose={() => setAdd(false)} onSaved={(m) => onChange(modelKey(m))} />}
    </>
  );
}

export function HarnessPicker({ value, onChange, size, block, onlyInstalled = false }: { value: string; onChange: (name: string) => void; size?: 'xs' | 'sm' | 'lg'; block?: boolean; onlyInstalled?: boolean }) {
  const wb = useWb();
  const { harness } = wb;
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  let error = '';
  try { normalizeHarnessName(custom); } catch (e) { error = (e as Error).message; }
  const opts: Opt[] = HARNESSES.filter((h) => !onlyInstalled || harness.find((x) => x.id === h.id)?.installed).map((h) => {
    const inst = harness.find((x) => x.id === h.id)?.installed;
    return { value: h.name, label: h.name, group: inst ? '本机已安装' : '未检测到', desc: h.kind === 'cli' ? '命令行' : h.kind === 'ide' ? 'IDE' : '桌面应用', icon: <HarnessIcon name={h.name} size="xs" /> };
  }).sort((a, b) => (a.group === b.group ? 0 : a.group === '本机已安装' ? -1 : 1));
  if (!onlyInstalled) {
    const names = customHarnessNames([...(wb.store?.settings.custom_harnesses || []), ...(wb.store?.models || []).map((m) => m.harness || '').filter(Boolean), ...(wb.store?.workspaces || []).map((w) => w.harness).filter(Boolean), ...(wb.store?.runs || []).map((r) => r.harness).filter(Boolean)]);
    opts.push(...names.map((name) => ({ value: name, label: name, group: '用户自定义', desc: '手动打开并粘贴提示词', icon: <HarnessIcon name={name} size="xs" /> })));
  }
  if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value, group: '当前选择', icon: <HarnessIcon name={value} size="xs" /> });
  const save = async () => {
    if (busy || error) return;
    setBusy(true);
    try {
      const r = await post<{ name: string }>('/api/harness/custom', { name: custom });
      await wb.refresh(['store']);
      onChange(r.name); setAdding(false); setCustom('');
      toast.ok('已保存自定义 harness');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return <>
    <Select value={value} onChange={onChange} options={opts} size={size} block={block} searchable label="Harness" placeholder="选择 harness"
      footer={!onlyInstalled ? <button type="button" className="opt" onClick={() => setAdding(true)}><Plus size={15} /><span className="opt-t">新增用户自定义…</span></button> : undefined}
      render={(o) => o ? <><HarnessIcon name={String(o.value)} size="xs" /><span className="ellipsis">{o.label}</span></> : <span className="sel-ph">选择 harness</span>} />
    {adding && <Modal open onClose={() => setAdding(false)} title="用户自定义 harness" width={460}
      sub="保存后可在各处的 Harness 选择器中重复使用。"
      footer={<><Btn tone="ghost" onClick={() => setAdding(false)}>取消</Btn><Btn tone="primary" disabled={busy || !!error} onClick={() => void save()}>{busy ? '保存中…' : '保存并使用'}</Btn></>}>
      <Field label="Harness 名称" error={custom ? error : undefined} hint="例如 私有 Agent / 网页对话 + 本地中继。自定义项由你手动打开，再粘贴提示词。">
        <input autoFocus maxLength={100} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void save(); } }} placeholder="填写你使用的 Agent 软件名称" aria-label="自定义 harness 名称" />
      </Field>
    </Modal>}
  </>;
}

interface Infer { vendor: string | null; name: string; inferred: boolean; icon: string | null; harness: { id: string; name: string } | null; exists: boolean; vendors: string[] }

export function AddModelDialog({ onClose, onSaved, init }: { onClose: () => void; onSaved?: (m: ModelProfile) => void; init?: ModelProfile }) {
  const wb = useWb();
  const edit = !!init;
  const [raw, setRaw] = useState(init ? init.name : '');
  const [inf, setInf] = useState<Infer | null>(null);
  const [vendor, setVendor] = useState<string>(init?.vendor || '');
  const [vendorTouched, setVendorTouched] = useState(!!init);
  const [harness, setHarness] = useState(init?.harness || '');
  const [harnessTouched, setHarnessTouched] = useState(!!init?.harness);
  const [more, setMore] = useState(edit);
  const [f, setF] = useState<Partial<ModelProfile>>(init || {});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (edit) return;
    const s = raw.trim();
    if (!s) { setInf(null); return; }
    const t = setTimeout(() => void get<Infer>('/api/models/infer', { name: s }).then((r) => {
      setInf(r);
      if (!vendorTouched) setVendor(r.vendor || '');
      if (!harnessTouched && r.harness) setHarness(r.harness.name);
    }).catch(() => {}), 180);
    return () => clearTimeout(t);
  }, [raw]); // eslint-disable-line

  const name = edit ? init!.name : (inf?.name || raw.trim().split('/').pop() || '').trim();
  const bad = /[<>:"/\\|?*]/;
  const errN = name && (bad.test(name) || /[. ]$/.test(name)) ? '名称不能含 <>:"/\\|?*，不能以点或空格结尾' : null;
  const errV = vendor && bad.test(vendor) ? '供应商不能含特殊字符' : null;
  const existingVendors = useMemo(() => [...new Set([...(inf?.vendors || []), ...(wb.store?.models || []).map((m) => m.vendor)])], [inf, wb.store]);
  const vendorOpts: Opt[] = [
    ...VENDORS.map((v) => ({ value: v.id, label: v.name, text: `${v.id} ${v.name} ${v.cn || ''}`, desc: v.cn, icon: <BrandIcon icon={v.icon} fallback={v.id} size="xs" />, group: existingVendors.includes(v.id) ? '已有目录' : '常见供应商', right: existingVendors.includes(v.id) ? <span className="badge">已有</span> : undefined })),
    ...existingVendors.filter((v) => !vendorById(v)).map((v) => ({ value: v, label: v, group: '已有目录', icon: <BrandIcon icon={null} fallback={v} size="xs" /> })),
  ].sort((a, b) => (a.group === b.group ? 0 : a.group === '已有目录' ? -1 : 1));
  const [customV, setCustomV] = useState('');
  const newVendorDir = vendor && !existingVendors.includes(vendor);
  const dup = !edit && wb.store?.models.some((m) => m.vendor === vendor && m.name === name);
  const hdef = harnessByName(harness);
  const installed = hdef ? wb.harness.find((h) => h.id === hdef.id)?.installed : undefined;

  const save = async () => {
    setBusy(true);
    try {
      const m = await post<ModelProfile>('/api/models', { ...f, vendor, name, harness, tags: typeof f.tags === 'string' ? String(f.tags).split(/[,，\s]+/).filter(Boolean) : f.tags });
      toast.ok(edit ? `已更新 ${m.name}` : `已新增 ${m.name} · 目录 model/${m.vendor}/${m.name}/ 已创建`);
      await wb.refresh(['store']);
      if (!edit) wb.setCurrent(modelKey(m));
      onSaved?.(m);
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (k: keyof ModelProfile) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal open onClose={onClose} width={620} title={edit ? `编辑模型` : '新增模型'} sub={edit ? `${init!.vendor} / ${init!.name}` : '只需输入模型名称，供应商、工作区目录和 harness 会自动识别'}
      footer={<>
        {!edit && <Btn tone="ghost" size="sm" icon={<ChevronRight size={14} style={{ transform: more ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }} />} onClick={() => setMore(!more)}>更多信息</Btn>}
        <span className="grow" />
        <Btn tone="ghost" onClick={onClose}>取消</Btn>
        <Btn tone="primary" busy={busy} disabled={!name || !vendor || !!errN || !!errV || dup} onClick={save}>{edit ? '保存' : '新增并设为当前模型'}</Btn>
      </>}>
      <div className="stack l">
        {!edit && (
          <div className="add-hero">
            <input className="input lg" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name && vendor && !dup) void save(); }}
              placeholder="例如 GPT-6.1-Sol、claude-opus-5.5、DeepSeek-V4" aria-label="模型名称" spellCheck={false} />
          </div>
        )}
        {(name || edit) && (
          <div className="add-preview glass">
            <ModelAvatar vendor={vendor} model={name} size="xl" />
            <div className="grow stack s">
              <div className="row gap-s wrap"><b className="add-name">{name || '—'}</b>{inf?.inferred && inf.vendor && !vendorTouched && <span className="badge tone-accent"><Wand2 size={11} /> 自动识别</span>}{dup && <span className="badge tone-warn">已存在</span>}</div>
              <div className="add-path mono"><FolderPlus size={13} />model/<b className={cls(newVendorDir && 'new')}>{vendor || '？'}</b>/<b className="new">{name || '？'}</b>/</div>
              <div className="muted xs">{!vendor ? '无法识别供应商，请在下方选择或输入' : newVendorDir ? `将新建供应商目录 ${vendor}/ 与模型目录` : `供应商目录已存在，将新建模型目录`}</div>
            </div>
          </div>
        )}
        <div className="form-grid">
          <Field label="供应商" hint={vendor && !vendorById(vendor) ? '自定义供应商' : undefined} error={errV}>
            <Select value={vendor} onChange={(v) => { setVendor(v); setVendorTouched(true); }} options={vendorOpts} searchable block disabled={edit} placeholder="选择供应商"
              render={(o) => vendor ? <><BrandIcon icon={vendorById(vendor)?.icon || null} fallback={vendor} size="xs" /><span>{o?.label || vendor}</span></> : <span className="sel-ph">选择供应商</span>}
              footer={<div className="row gap-s pad" style={{ padding: 6 }}><input className="input sm" placeholder="自定义供应商目录名" value={customV} onChange={(e) => setCustomV(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><Btn size="sm" disabled={!customV.trim()} onClick={() => { setVendor(customV.trim()); setVendorTouched(true); }}>使用</Btn></div>} />
          </Field>
          <Field label="默认 harness" hint={hdef ? (installed ? `本机已安装 · ${hdef.kind === 'cli' ? '命令行' : hdef.kind === 'ide' ? 'IDE' : '桌面应用'}` : '本机未检测到，仍可手动使用') : '被测模型运行所在的 Agent 软件'}>
            <HarnessPicker value={harness} onChange={(v) => { setHarness(v); setHarnessTouched(true); }} block />
          </Field>
        </div>
        {inf?.harness && !harnessTouched && <div className="alert info"><Sparkles size={14} />已根据供应商与本机安装情况推荐 <b>{inf.harness.name}</b>；复制提示词时可一键打开它。</div>}
        {more && (
          <div className="form-grid">
            <Field label="显示名"><input value={f.display || ''} onChange={set('display')} placeholder={name || 'GPT-6.1 Sol'} /></Field>
            <Field label="系列 / 家族"><input value={f.family || ''} onChange={set('family')} placeholder="GPT-6" /></Field>
            <Field label="发布日期"><input type="date" value={f.release || ''} onChange={set('release')} /></Field>
            <Field label="标签" hint="逗号分隔"><input value={Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags as unknown as string) || ''} onChange={(e) => setF({ ...f, tags: e.target.value as unknown as string[] })} placeholder="reasoning, preview" /></Field>
            <Field label="备注" className="span-all"><textarea rows={3} value={f.notes || ''} onChange={set('notes')} placeholder="上下文长度、推理档位、API 版本等" /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 查询 harness 定义：显示名或 id */
export const findHarness = (nameOrId?: string | null) => harnessByName(nameOrId) || harnessById(nameOrId || '');
