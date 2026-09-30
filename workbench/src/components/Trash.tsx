// 运行的作废与回收站：右键菜单（彻底停止 / 删除）、右下角回收站（可把卡片拖进去）、恢复、二次确认的永久删除。
// 作废 = 移入回收站：不参与排行、对比、待评清单、导出、报告和桌面宠物；文件原地保留，随时可恢复。
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArchiveRestore, Bot, Copy, FileCheck2, Flag, FolderOpen, MonitorPlay, OctagonX, PanelRight, RefreshCw, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import type { TrashEntry } from '../../shared/types';
import { get, post } from '../api';
import { useWb } from '../state';
import { go } from '../lib/router';
import { cls, copyText, fmt } from '../lib/format';
import { Badge, Btn, CheckBox, Drawer, Empty, IconBtn, Modal, openContextMenu, type MenuItem } from '../ui/kit';
import { HarnessIcon, ModelAvatar } from '../ui/brand';
import { toast } from '../ui/toast';
import { Score, useNamer } from './common';
import type { Row } from '../views/Runs';

export const DRAG_MIME = 'application/x-wb-run';
const idOf = (r: Row) => r.ws ? r.ws.ref : 'run:' + r.run!.run_id;
/** 还在跑：已开始、没结束、模型也没写 FINAL_MESSAGE.md */
export const isLive = (r: Row) => !!r.ws && !r.run && !!r.ws.started_at && !r.ws.ended_at && !r.ws.detect?.final;

/** 去掉开头 / 结尾 / 连续的分隔线 */
function tidy(items: (MenuItem | false | null | undefined)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it.sep && (!out.length || out[out.length - 1].sep)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].sep) out.pop();
  return out;
}

export function useRunActions() {
  const wb = useWb();
  const nm = useNamer();
  const nameOf = (r: Row) => {
    const w = r.ws, run = r.run;
    return `${w ? nm.model(w.vendor, w.model) : nm.blind ? nm.run(run!) : run!.model} · ${w?.tkey || run!.tkey}${w ? ` r${w.index}` : run?.run_index ? ` r${run.run_index}` : ''}`;
  };
  const restore = async (id: string, quiet = false) => {
    try { await post('/api/runs/restore', { id }); await wb.refresh(['store', 'agg']); if (!quiet) toast.ok('已从回收站恢复'); return true; }
    catch (e: any) { toast.error(e.message); return false; }
  };
  const discard = async (r: Row, stop = false) => {
    try {
      const res = await post<{ id: string; already?: boolean; released: { procs: number; previews: number } }>('/api/runs/discard', r.ws ? { ref: r.ws.ref, stop } : { run_id: r.run!.run_id, stop });
      await wb.refresh(['store', 'agg']);
      if (res.already) { toast.info('它已经在回收站里了'); return; }
      const rel = res.released.procs ? `，已关闭 ${res.released.procs} 个开发服务器` : '';
      const harness = r.ws?.harness || r.run?.harness;
      toast[stop ? 'warn' : 'ok'](stop
        ? `已彻底停止 ${nameOf(r)}${rel}。工作台关不掉外部软件里的会话，请在 ${harness || 'Agent 软件'} 里也停掉它`
        : `已移入回收站：${nameOf(r)}${rel}`, { ttl: 9000, action: { label: '撤销', run: () => void restore(res.id, true).then((ok) => ok && toast.ok('已撤销')) } });
    } catch (e: any) { toast.error(e.message); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.ok(ok); await wb.refresh(['store', 'jobs']); } catch (e: any) { toast.error(e.message); } };
  /** 撤销结束：清掉结束时间和超时标记，开跑时间戳保持不变 */
  const reopen = async (ref: string, quiet = false) => {
    try { await post('/api/ws/patch', { ref, ended_at: null, timed_out: false }); await wb.refresh(['store']); if (!quiet) toast.ok('已撤销结束，继续计时（开跑时间不变）'); return true; }
    catch (e: any) { toast.error(e.message); return false; }
  };
  const endTimer = async (ref: string, body: Record<string, unknown> = {}) => {
    try {
      await post('/api/ws/finish', { ref, ...body });
      await wb.refresh(['store']);
      toast.ok('已结束计时', { ttl: 9000, action: { label: '撤销', run: () => void reopen(ref, true).then((ok) => ok && toast.ok('已撤销，继续计时')) } });
    } catch (e: any) { toast.error(e.message); }
  };

  const items = (r: Row, opts: { detail?: boolean } = {}): MenuItem[] => {
    const w = r.ws, run = r.run;
    const live = isLive(r);
    const delivered = !!w && !run && (!!w.ended_at || !!w.detect?.final);
    const ready = delivered && !!w?.detect && w.detect.done === w.detect.total;
    // 手动结束了、但模型其实还没交付（没写 FINAL_MESSAGE.md、没登记）：允许撤销结束
    const reopenable = !!w && !run && !!w.ended_at && !w.detect?.final && !w.grader_run_id;
    return tidy([
      !opts.detail && { label: '打开详情', icon: <PanelRight size={15} />, kbd: 'Enter', onClick: () => go('runs', w ? [w.ref] : [], w ? undefined : { id: run!.run_id }) },
      (!!w?.entry || !!run) && { label: run?.graded ? '预览并打分' : '预览产物', icon: <MonitorPlay size={15} />, onClick: () => go('stage', [], { open: w ? 'ws:' + w.ref : 'run:' + run!.run_id, score: run?.graded ? run.run_id : undefined }) },
      !!w && { label: '打开工作目录', icon: <FolderOpen size={15} />, onClick: () => void post('/api/open-folder', { ref: w.ref }).catch((e) => toast.error(e.message)) },
      !!w && { label: '复制提示词', icon: <Copy size={15} />, onClick: async () => { const t = await get<{ prompt: string }>('/api/ws/final', { ref: w.ref }); if (t.prompt && (await copyText(t.prompt))) toast.ok('已复制提示词'); else toast.warn('没有找到提示词留档'); } },
      !!run && { label: 'AI 评审提示词', icon: <Bot size={15} />, onClick: async () => { const t = await get<{ text: string }>('/api/review-prompt', { run_id: run.run_id }); if (await copyText(t.text)) toast.ok('已复制 AI 评审提示词'); } },
      { sep: true },
      live && { label: '结束计时', desc: '模型做完了但没写 FINAL_MESSAGE.md · 仍计入评测', icon: <Flag size={15} />, onClick: () => void endTimer(w!.ref) },
      reopenable && { label: '撤销结束，继续计时', desc: '点错了结束：清掉结束时间，开跑时间不变', icon: <Undo2 size={15} />, onClick: () => void reopen(w!.ref) },
      ready && { label: '登记并评分', icon: <FileCheck2 size={15} />, onClick: () => void act(() => post('/api/ws/finish', { ref: w!.ref, at: w!.ended_at, register: true, grade: true }), '已提交登记，完成后自动评分') },
      !!run && { label: '重新评分', icon: <RefreshCw size={15} />, onClick: () => void wb.runJob({ kind: 'grade', runs: [run.run_id] }, '重新评分') },
      { sep: true },
      live && { label: '彻底停止', desc: '作废本次运行并移入回收站 · 不参与任何评估', icon: <OctagonX size={15} />, danger: true, onClick: () => void discard(r, true) },
      { label: '删除', desc: run?.graded ? '移到回收站 · 排行榜里不再计入，可恢复' : '移到回收站 · 可随时恢复', icon: <Trash2 size={15} />, kbd: 'Del', danger: true, onClick: () => void discard(r, false) },
    ]);
  };
  const open = (at: Parameters<typeof openContextMenu>[0], r: Row, opts?: { detail?: boolean }) => openContextMenu(at, items(r, opts), <span className="ellipsis">{nameOf(r)}</span>);
  return { items, open, discard, restore, reopen, endTimer, nameOf };
}

/** 卡片 / 列表行共用：右键菜单、Delete 键删除、拖进回收站 */
export function runHandlers(r: Row, a: ReturnType<typeof useRunActions>) {
  return {
    onContextMenu: (e: React.MouseEvent) => a.open(e, r),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) { e.preventDefault(); void a.discard(r); }
      else if (e.key === 'Enter' && (e.currentTarget as HTMLElement).tagName !== 'A') { e.preventDefault(); go('runs', r.ws ? [r.ws.ref] : [], r.ws ? undefined : { id: r.run!.run_id }); }
    },
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData(DRAG_MIME, idOf(r)); e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('dragging-run'); },
    onDragEnd: () => document.body.classList.remove('dragging-run'),
  };
}

// ============================================================ 右下角回收站
export function TrashDock({ rows }: { rows: Row[] }) {
  const wb = useWb();
  const a = useRunActions();
  const n = wb.store?.trash?.length || 0;
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [bump, setBump] = useState(false);
  const prev = useRef(n);
  useEffect(() => { if (n > prev.current) { setBump(true); const t = setTimeout(() => setBump(false), 520); prev.current = n; return () => clearTimeout(t); } prev.current = n; }, [n]);
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_MIME);
  return (
    <>
      <button type="button" className={cls('trash-dock glass-thick sheen', over && 'over', bump && 'bump', n > 0 && 'has')} aria-label={`回收站，${n} 次作废的运行`}
        onClick={() => setOpen(true)}
        onDragEnter={(e) => { if (accepts(e)) { e.preventDefault(); setOver(true); } }}
        onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          document.body.classList.remove('dragging-run');
          const id = e.dataTransfer.getData(DRAG_MIME);
          const r = rows.find((x) => idOf(x) === id);
          if (r) { e.preventDefault(); void a.discard(r); }
        }}>
        <span className="sheen-l" aria-hidden />
        <span className="td-ic"><Trash2 size={17} /></span>
        <span className="td-t"><b>{over ? '松手移入回收站' : '回收站'}</b><span>{over ? '可随时恢复' : n ? `${n} 次作废 · 不参与评估` : '拖卡片到这里'}</span></span>
        {n > 0 && !over && <span className="td-n">{n}</span>}
      </button>
      <TrashDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ============================================================ 回收站抽屉
export function TrashDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wb = useWb();
  const nm = useNamer();
  const a = useRunActions();
  const list = wb.store?.trash || [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [purge, setPurge] = useState<TrashEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => list.some((t) => t.id === id)))); }, [list]); // eslint-disable-line
  const picked = list.filter((t) => sel.has(t.id));
  const toggle = (id: string, v: boolean) => setSel((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  const restoreMany = async (ts: TrashEntry[]) => {
    setBusy(true);
    let ok = 0;
    for (const t of ts) if (await a.restore(t.id, true)) ok++;
    setBusy(false);
    if (ok) toast.ok(`已恢复 ${ok} 次运行`);
  };
  const byDay = useMemo(() => {
    const g = new Map<string, TrashEntry[]>();
    for (const t of list) { const d = new Date(t.at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }); g.set(d, [...(g.get(d) || []), t]); }
    return [...g];
  }, [list]);
  return (
    <>
      <Drawer open={open} onClose={onClose} width={620}
        title={<span className="row gap-s"><Trash2 size={17} />回收站<span className="badge">{list.length}</span></span>}
        extra={list.length > 0 && <Btn size="sm" tone="danger" icon={<Trash2 size={13} />} onClick={() => setPurge(list)}>清空</Btn>}>
        <p className="muted small trash-lead">这里的运行<b>不参与</b>排行、对比、待评清单、导出和报告。文件都还在原位，恢复后一切照旧；只有「永久删除」才会真正删文件。</p>
        {!list.length ? (
          <Empty icon={<Trash2 size={28} />} title="回收站是空的">在运行卡片上右键选「彻底停止」或「删除」，或者把卡片拖到右下角的回收站。</Empty>
        ) : (
          <>
            <div className="trash-bar">
              <CheckBox checked={picked.length === list.length} onChange={(v) => setSel(v ? new Set(list.map((t) => t.id)) : new Set())} label="全选" />
              <span className="muted small grow">{picked.length ? `已选 ${picked.length} 项` : '全选'}</span>
              {picked.length > 0 && <>
                <Btn size="sm" tone="tinted" busy={busy} icon={<ArchiveRestore size={14} />} onClick={() => void restoreMany(picked)}>恢复所选</Btn>
                <Btn size="sm" tone="danger" icon={<Trash2 size={13} />} onClick={() => setPurge(picked)}>永久删除所选</Btn>
              </>}
            </div>
            {byDay.map(([day, ts]) => (
              <section key={day} className="trash-day">
                <div className="trash-day-h">{day}</div>
                {ts.map((t) => (
                  <div key={t.id} className={cls('trash-row', sel.has(t.id) && 'on')}>
                    <CheckBox checked={sel.has(t.id)} onChange={(v) => toggle(t.id, v)} label="选择" />
                    <ModelAvatar vendor={t.vendor} model={t.model} size="sm" blind={nm.blind} />
                    <div className="grow tr-main">
                      <div className="row gap-s"><b className="ellipsis">{nm.model(t.vendor, t.model)}</b><span className="mono small muted">{t.tkey}{t.index != null ? ` · r${t.index}` : ''}</span></div>
                      <div className="row gap-s wrap tr-meta">
                        <Badge tone={t.stopped ? 'warn' : 'muted'}>{t.stopped ? '彻底停止' : '删除'}</Badge>
                        <span className="muted xs">原在「{t.from}」</span>
                        <span className="muted xs">· {fmt.ago(Date.parse(t.at))}</span>
                        {t.harness && <span className="muted xs row gap-s"><HarnessIcon name={t.harness} size="xs" />{t.harness}</span>}
                        {t.run_id && <Badge tone="info">含评分记录</Badge>}
                      </div>
                      {t.reason && !/^(移入回收站|手动彻底停止)$/.test(t.reason) && <div className="muted xs mt-s">原因：{t.reason}</div>}
                    </div>
                    {t.total != null && <Score v={t.total} />}
                    <Btn size="sm" tone="tinted" icon={<Undo2 size={14} />} onClick={() => void a.restore(t.id)}>恢复</Btn>
                    <IconBtn label="更多" onClick={(e) => openContextMenu(e.currentTarget, [
                      ...(t.ref ? [{ label: '打开工作目录', icon: <FolderOpen size={15} />, onClick: () => void post('/api/open-folder', { ref: t.ref }).catch((er) => toast.error(er.message)) }] : []),
                      { label: '复制引用', desc: t.ref || t.run_id || '', icon: <Copy size={15} />, onClick: () => void copyText(t.ref || t.run_id || t.id).then(() => toast.ok('已复制')) },
                      { sep: true },
                      { label: '永久删除…', desc: '删除这次运行的全部文件，无法恢复', icon: <Trash2 size={15} />, danger: true, onClick: () => setPurge([t]) },
                    ])}><span aria-hidden>⋯</span></IconBtn>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </Drawer>
      <PurgeModal items={purge} onClose={() => setPurge(null)} onDone={() => { setPurge(null); setSel(new Set()); void wb.refresh(['store', 'agg']); }} />
    </>
  );
}

/** 永久删除：单独的删除按钮 + 勾选“我明白无法恢复”的二次确认 */
function PurgeModal({ items, onClose, onDone }: { items: TrashEntry[] | null; onClose: () => void; onDone: () => void }) {
  const nm = useNamer();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAck(false); }, [items]);
  if (!items) return null;
  const graded = items.filter((t) => t.run_id).length;
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ purged: { id: string }[] }>('/api/trash/purge', { ids: items.map((t) => t.id), confirm: 'purge' });
      toast.ok(`已永久删除 ${r.purged.length} 次运行`);
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width={500} title={`永久删除 ${items.length} 次运行？`} sub="这一步删的是磁盘上的文件，删了就找不回来"
      footer={<><Btn tone="ghost" onClick={onClose}>取消</Btn><Btn tone="danger" className="solid-danger" disabled={!ack} busy={busy} icon={<Trash2 size={14} />} onClick={() => void run()}>永久删除</Btn></>}>
      <div className="stack">
        <ul className="purge-list">
          {items.slice(0, 8).map((t) => <li key={t.id}><span className="mono small">{t.ref ? nm.ref(t.ref) : t.run_id}</span>{t.total != null && <span className="muted xs">得分 {fmt.n(t.total)}</span>}</li>)}
          {items.length > 8 && <li className="muted small">…以及另外 {items.length - 8} 次</li>}
        </ul>
        <div className="alert warn"><TriangleAlert size={15} /><span>会删除：工作目录 <code>rN/</code>（模型的全部产物）、提示词留档、最后回复、截图{graded ? `，以及 ${graded} 次运行的评分目录和人工打分` : ''}。模型档案和其他运行不受影响。</span></div>
        <label className="row gap-s small ack"><CheckBox checked={ack} onChange={setAck} label="我明白" />我明白删除后无法恢复</label>
      </div>
    </Modal>
  );
}

/** 详情页：运行在回收站里时显示这个，而不是“运行不存在” */
export function TrashedNotice({ id }: { id: string }) {
  const wb = useWb();
  const a = useRunActions();
  const t = wb.store?.trash?.find((x) => x.id === id || x.ref === id);
  if (!t) return null;
  return (
    <Empty icon={<Trash2 size={28} />} title="这次运行在回收站里" action={<div className="row gap-s"><Btn onClick={() => go('runs')}>返回运行列表</Btn><Btn tone="tinted" icon={<Undo2 size={14} />} onClick={() => void a.restore(t.id)}>恢复它</Btn></div>}>
      {t.ref || t.run_id} · {t.stopped ? '彻底停止' : '删除'}于 {fmt.time(t.at)} · 不参与任何评估
    </Empty>
  );
}