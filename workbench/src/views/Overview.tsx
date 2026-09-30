// 总览：当前测评模型的进度与「下一步」、全局待办、榜单前五与最近动态。
import { useMemo } from 'react';
import { ArrowRight, BookOpen, Boxes, CircleCheck, ClipboardCopy, FileCheck2, Hourglass, ListChecks, MonitorPlay, Plus, Sparkles, Trophy } from 'lucide-react';
import { vendorById } from '../../shared/vendors';
import { useWb } from '../state';
import { go, href } from '../lib/router';
import { cls, fmt, splitEntrant } from '../lib/format';
import { Btn, Card, Empty, Ring, Stat } from '../ui/kit';
import { HarnessIcon, ModelAvatar } from '../ui/brand';
import { Legend, Radar } from '../ui/charts';
import { Score, useNamer } from '../components/common';
import { ModelPicker } from '../components/pickers';
import { launch } from '../components/LaunchPad';
import { colOf, useRows } from './Runs';

export default function Overview() {
  const wb = useWb();
  const nm = useNamer();
  const rows = useRows();
  const tasks = wb.spec?.tasks || [];
  const need = wb.spec?.cfg.runs_per_task || 3;
  const [vendor, model] = wb.current ? [wb.current.split('/')[0], wb.current.split('/').slice(1).join('/')] : [null, null];
  const prof = wb.store?.models.find((m) => m.vendor === vendor && m.name === model);
  const mine = rows.filter((r) => r.ws && r.ws.vendor === vendor && r.ws.model === model);
  const perTask = useMemo(() => tasks.map((t) => {
    const rs = mine.filter((r) => r.ws!.task === t.id);
    const scores = rs.map((r) => r.run?.score?.total).filter((v): v is number => v != null);
    return { t, rs, done: rs.filter((r) => colOf(r) !== 'running').length, best: scores.length ? Math.max(...scores) : null, graded: rs.filter((r) => r.run?.graded).length };
  }), [tasks, mine]);
  const running = rows.filter((r) => colOf(r) === 'running' && r.ws?.started_at);
  const delivered = rows.filter((r) => colOf(r) === 'delivered');
  const pend = wb.agg?.pending;
  const humanRun = rows.find((r) => r.run?.score?.items.some((i) => i.status === 'pending' && i.method === 'human'));
  const nextTask = perTask.find((p) => p.done < need);
  const progress = tasks.length ? perTask.reduce((s, p) => s + Math.min(need, p.done), 0) / (tasks.length * need) : 0;

  let cta: { icon: typeof Plus; title: string; sub: string; label: string; run: () => void } | null = null;
  if (!wb.store?.models.length) cta = { icon: Plus, title: '先新增一个模型', sub: '只需输入名称，供应商、目录与 harness 自动识别', label: '新增模型', run: () => go('models') };
  else if (!prof) cta = { icon: Boxes, title: '选择当前测评模型', sub: '右上角或下方选择；题目页复制的提示词会写入它的工作目录', label: '去模型页', run: () => go('models') };
  else if (delivered.length) cta = { icon: FileCheck2, title: `${delivered.length} 次运行已交付`, sub: '检测到 FINAL_MESSAGE.md，登记后自动评分', label: '去登记评分', run: () => go('runs') };
  else if (humanRun) cta = { icon: MonitorPlay, title: `还有 ${pend?.human || 0} 个人工项待评`, sub: '预览产物时同屏打分，键盘 0–3 即可', label: '预览并打分', run: () => go('stage', [], { open: humanRun.ws ? 'ws:' + humanRun.ws.ref : 'run:' + humanRun.run!.run_id, score: humanRun.run!.run_id }) };
  else if (running.length) cta = { icon: Hourglass, title: `${running.length} 个运行进行中`, sub: '模型完成后工作台会自动检测交付', label: '查看运行', run: () => go('runs') };
  else if (nextTask) cta = { icon: ClipboardCopy, title: `下一题：${nextTask.t.id} ${nextTask.t.name}`, sub: `${nextTask.t.short}`, label: '打开发车台', run: () => launch(`${prof.vendor}/${prof.name}`, nextTask.t.id) };
  else cta = { icon: Trophy, title: '这个模型的全部题目都已完成', sub: '去排行榜查看名次，或对比其他模型', label: '查看排行榜', run: () => go('board') };

  const top = (wb.agg?.board || []).slice(0, 5);
  const dims = (wb.spec?.dims || []).filter((d) => d.kind === 'quality');
  const colors = ['#7c6cff', '#ff7a59', '#1fb89a'];

  return (
    <div className="page">
      <section className="ov-hero glass">
        <div className="ov-cur">
          {prof ? <ModelAvatar vendor={vendor} model={model!} size="xl" blind={wb.blind} /> : <span className="avatar xl"><Sparkles size={26} /></span>}
          <div className="grow">
            <div className="eyebrow">当前测评</div>
            <div className="row gap-s wrap"><h1 className="page-title">{prof ? (wb.blind ? nm.model(vendor, model!) : prof.display || prof.name) : '未选择模型'}</h1></div>
            {prof ? <div className="row gap-s muted small mt-s"><span>{vendorById(vendor)?.name || vendor}</span>·<HarnessIcon name={prof.harness} size="xs" /><span>{prof.harness || '未设置 harness'}</span></div> : <div className="mt-s"><ModelPicker value={wb.current} onChange={wb.setCurrent} /></div>}
          </div>
          {prof && <Ring value={progress * 100} size={78} tone={progress >= 1 ? 'ok' : 'accent'}><span style={{ fontSize: 16 }}>{Math.round(progress * 100)}%</span></Ring>}
        </div>
        {cta && (
          <div className="ov-cta glass-thin">
            <span className="ov-cta-ic"><cta.icon size={20} /></span>
            <div className="grow"><b>{cta.title}</b><div className="muted small ellipsis">{cta.sub}</div></div>
            <Btn tone="primary" size="lg" iconRight={<ArrowRight size={16} />} onClick={cta.run}>{cta.label}</Btn>
          </div>
        )}
        {prof && (
          <div className="ov-tasks">
            {perTask.map((p) => (
              <a key={p.t.id} className={cls('ov-task', p.done >= need && 'full', p.done > 0 && 'some')} href={href('tasks', [p.t.id])}>
                <div className="row"><b className="mono">{p.t.id}</b><span className="grow" />{p.best != null ? <Score v={p.best} /> : null}</div>
                <div className="ellipsis small">{p.t.name.replace(/（.*?）/g, '')}</div>
                <div className="tt-dots">{Array.from({ length: need }, (_, i) => <i key={i} className={cls(i < p.graded ? 'graded' : i < p.done && 'on')} />)}</div>
              </a>
            ))}
          </div>
        )}
      </section>

      <div className="grid g-4 mt-l">
        <Stat label="模型" icon={<Boxes size={13} />} value={wb.store?.models.length || 0} sub={`${new Set((wb.store?.models || []).map((m) => m.vendor)).size} 个供应商`} onClick={() => go('models')} />
        <Stat label="运行" icon={<ListChecks size={13} />} value={rows.length} sub={`${running.length} 进行中 · ${delivered.length} 待登记`} onClick={() => go('runs')} />
        <Stat label="待评" icon={<Sparkles size={13} />} value={(pend?.human || 0) + (pend?.agent || 0)} sub={`人工 ${pend?.human || 0} · Agent ${pend?.agent || 0} · 缺用量 ${pend?.usage_missing || 0}`} tone={(pend?.human || 0) + (pend?.agent || 0) ? 'warn' : undefined} onClick={() => go('runs')} />
        <Stat label="榜首" icon={<Trophy size={13} />} value={top[0] ? fmt.n(top[0].quality) : '—'} sub={top[0] ? nm.entrant(top[0].entrant) : '尚无评分结果'} onClick={() => go('board')} />
      </div>

      <div className="grid g-2 mt-l">
        <Card title="排行榜前五" extra={<Btn size="sm" tone="ghost" iconRight={<ArrowRight size={14} />} onClick={() => go('board')}>完整榜单</Btn>}>
          {!top.length ? <Empty icon={<Trophy size={26} />} title="还没有评分结果">完成至少一次运行的评分后出现。</Empty> : (
            <div className="mini-board">
              {top.map((b) => {
                const { model: mm, harness } = splitEntrant(b.entrant);
                return (
                  <a key={b.entrant} className="mb-row" href={href('models', [nm.vendorOf(b.entrant) || '', mm])}>
                    <span className="mb-rank mono">{b.rank}</span>
                    <ModelAvatar vendor={nm.vendorOf(b.entrant)} model={mm} size="sm" blind={nm.blind} />
                    <span className="who-t grow"><b>{nm.blind ? nm.entrant(b.entrant) : mm}</b><span>{harness}</span></span>
                    <span className="mb-bar"><i style={{ width: `${b.quality || 0}%`, background: nm.color(b.entrant) }} /></span>
                    <Score v={b.quality} />
                  </a>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="维度对比" sub="前三名">
          {top.length ? <><div className="center"><Radar size={340} axes={dims.map((d) => ({ id: d.id, label: d.name }))} series={top.slice(0, 3).map((b, i) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: colors[i], values: b.dims }))} /></div>
            <Legend items={top.slice(0, 3).map((b, i) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: colors[i] }))} /></> : <Empty title="暂无数据" />}
        </Card>
        <Card title="最近动态">
          <ul className="feed">{(wb.store?.history || []).slice(-10).reverse().map((h, i) => <li key={i}><span className="badge">{h.action}</span><span className="grow small ellipsis">{h.detail}</span><span className="muted xs">{fmt.ago(h.at)}</span></li>)}
            {!(wb.store?.history || []).length && <li className="muted small">还没有动态</li>}</ul>
        </Card>
        <a className="doc-promo glass sheen" href={href('docs')}>
          <span className="sheen-l" aria-hidden />
          <span className="pr-ic"><BookOpen size={20} /></span>
          <div className="grow"><b>方法论</b><p className="small dim">设计原则、9 个雷达维度、题目 × 维度矩阵、评分体系与运行协议——给读榜的人看的完整规则。</p></div>
          <ArrowRight size={18} className="muted" />
        </a>
      </div>
    </div>
  );
}
