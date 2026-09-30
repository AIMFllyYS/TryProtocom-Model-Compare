// 总览：一眼看清“评测进行到哪一步、下一步该做什么”。
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, CheckCircle2, CircleDashed, ClipboardCheck, Clock3, FlaskConical, Play, Plus, Timer, TriangleAlert, Trophy } from 'lucide-react';
import { useWb } from '../state';
import { go, href } from '../lib/router';
import { fmt, wsStatus } from '../lib/format';
import { Badge, Btn, Card, Empty, Stat } from '../ui/kit';
import { Radar } from '../ui/charts';
import { ModelModal, NewRunModal, Score, TaskLabel, useNamer } from '../components/common';

export function Overview() {
  const wb = useWb();
  const nm = useNamer();
  const [newRun, setNewRun] = useState(false);
  const [newModel, setNewModel] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const st = wb.store, agg = wb.agg, spec = wb.spec;
  const ws = st?.workspaces || [];
  const runs = st?.runs || [];
  const running = ws.filter((w) => wsStatus(w) === 'running');
  const finishedUnreg = ws.filter((w) => wsStatus(w) === 'finished');
  const board = agg?.board || [];
  const qdims = (spec?.dims || []).filter((d) => d.kind === 'quality');
  const missingMat = Object.entries(spec?.materials_state || {}).filter(([, v]) => v.missing.length);
  const needsTts = (spec?.tasks || []).some((t) => t.prompt.includes('{TTS_COMMAND}')) && !st?.settings.tts_command;

  const todos = useMemo(() => {
    const out: { tone: string; text: string; action: string; run: () => void }[] = [];
    if (!st?.models.length) out.push({ tone: 'accent', text: '还没有任何模型', action: '新增模型', run: () => setNewModel(true) });
    if (finishedUnreg.length) out.push({ tone: 'warn', text: `${finishedUnreg.length} 次运行已结束但未登记到 bench-grader`, action: '去登记', run: () => go('runs', [], { status: 'finished' }) });
    if (agg?.pending.ungraded) out.push({ tone: 'warn', text: `${agg.pending.ungraded} 次登记运行尚未自动评分`, action: '一键评分', run: () => void wb.runJob({ kind: 'grade', all: true, skip_graded: true }, '评分全部未评分运行') });
    if (agg?.pending.agent) out.push({ tone: 'info', text: `${agg.pending.agent} 个 Agent 审查项待评（可交给 Agent 用 wb score 完成）`, action: '去评审', run: () => go('review', [], { method: 'agent' }) });
    if (agg?.pending.human) out.push({ tone: 'info', text: `${agg.pending.human} 个人工检查项待盲评`, action: '开始盲评', run: () => go('review', [], { method: 'human' }) });
    if (agg?.pending.usage_missing) out.push({ tone: 'muted', text: `${agg.pending.usage_missing} 次运行缺少用时或费用`, action: '补填', run: () => go('runs', [], { usage: 'missing' }) });
    if (agg?.pending.low_confidence) out.push({ tone: 'muted', text: `${agg.pending.low_confidence} 次运行 N/A 占比过高（低可信）`, action: '查看', run: () => go('runs', [], { flag: 'low' }) });
    if (missingMat.length) out.push({ tone: 'warn', text: `题目素材缺失：${missingMat.map(([k]) => k).join('、')}`, action: '生成素材', run: () => void wb.runJob({ kind: 'materials' }, '生成素材') });
    if (needsTts) out.push({ tone: 'warn', text: 'T04 提示词需要统一的 TTS 命令', action: '去设置', run: () => go('system') });
    return out;
  }, [st, agg, finishedUnreg.length, missingMat.length, needsTts, wb]);

  const top = board.slice(0, 4);
  const coverage = useMemo(() => {
    // 模型 × 题目 完成度：已评分运行数 / 规范要求次数
    const need = spec?.cfg.runs_per_task || 3;
    const tkeys = (spec?.tasks || []).flatMap((t) => (Object.keys(t.variants || {}).length ? Object.keys(t.variants).map((v) => t.id + v) : [t.id]));
    const rows = (st?.models || []).map((m) => {
      const cells = tkeys.map((k) => {
        const rs = ws.filter((w) => w.vendor === m.vendor && w.model === m.name && w.tkey === k);
        const graded = rs.filter((w) => w.grader_run_id && runs.find((r) => r.run_id === w.grader_run_id)?.graded).length;
        return { k, total: rs.length, graded, need };
      });
      return { m, cells, done: cells.reduce((a, c) => a + Math.min(c.graded, need), 0), all: cells.length * need };
    });
    return { tkeys, rows };
  }, [spec, st, ws, runs]);

  return (
    <div className="page">
      <div className="hero-row">
        <div>
          <div className="eyebrow">{spec ? `${spec.cfg.name} ${spec.cfg.version}${spec.cfg.frozen_date ? ' · 冻结于 ' + spec.cfg.frozen_date : ''}` : '题库加载中'}</div>
          <h2 className="hero-t">模型评测工作台</h2>
          <p className="muted">{spec ? `${spec.tasks.length} 道题 · ${spec.tasks.reduce((a, t) => a + t.items.length, 0)} 个检查项 · ${spec.dims.length} 个雷达维度 · 每题每参赛者 ${spec.cfg.runs_per_task} 次` : '…'}</p>
        </div>
        <div className="row gap-s wrap">
          <Btn icon={<Plus size={15} />} onClick={() => setNewModel(true)}>新增模型</Btn>
          <Btn tone="primary" icon={<Play size={15} />} onClick={() => setNewRun(true)} disabled={!st?.models.length}>新建运行</Btn>
        </div>
      </div>

      <div className="stats">
        <Stat icon={<Boxes size={14} />} label="模型" value={st?.models.length ?? '—'} sub={`${new Set(st?.models.map((m) => m.vendor)).size || 0} 个供应商`} onClick={() => go('models')} />
        <Stat icon={<FlaskConical size={14} />} label="工作区运行" value={ws.length} sub={`${running.length} 进行中 · ${finishedUnreg.length} 待登记`} onClick={() => go('runs')} />
        <Stat icon={<CheckCircle2 size={14} />} label="已评分" value={`${runs.filter((r) => r.graded).length}`} sub={`共登记 ${runs.length} 次`} tone={runs.length && runs.every((r) => r.graded) ? 'ok' : undefined} onClick={() => go('runs')} />
        <Stat icon={<ClipboardCheck size={14} />} label="待评检查项" value={(agg?.pending.human || 0) + (agg?.pending.agent || 0)} sub={`人工 ${agg?.pending.human || 0} · Agent ${agg?.pending.agent || 0}`} tone={(agg?.pending.human || 0) + (agg?.pending.agent || 0) ? 'warn' : undefined} onClick={() => go('review')} />
        <Stat icon={<Trophy size={14} />} label="上榜参赛者" value={board.length} sub={board[0] ? `第一：${nm.entrant(board[0].entrant)}` : '尚无结果'} onClick={() => go('board')} />
      </div>

      <div className="grid-main">
        <div className="col">
          <Card title="下一步" sub={todos.length ? `${todos.length} 项` : undefined}>
            {!todos.length ? <div className="ok-line"><CheckCircle2 size={16} /> 一切就绪，没有待办。</div> : (
              <ul className="todo">
                {todos.map((t, i) => (
                  <li key={i}><Badge tone={t.tone} dot>{t.tone === 'warn' ? '需处理' : t.tone === 'info' ? '待评' : '提示'}</Badge><span>{t.text}</span><Btn size="sm" tone="ghost" onClick={t.run}>{t.action}<ArrowRight size={13} /></Btn></li>
                ))}
              </ul>
            )}
          </Card>

          {running.length > 0 && (
            <Card title={<><Timer size={15} /> 进行中的运行</>}>
              <div className="list">
                {running.map((w) => {
                  const t = spec?.tasks.find((x) => x.id === w.task);
                  const el = Date.now() - Date.parse(w.started_at!);
                  const over = t?.time_limit && el > t.time_limit * 60000;
                  return (
                    <a key={w.ref} className="list-i" href={href('runs', [w.ref])}>
                      <span className="mono">{nm.ref(w.ref)}</span>
                      <span className="muted small">{w.harness}</span>
                      <span className={over ? 'clock bad' : 'clock'}>{fmt.clock(el)}{t?.time_limit ? <span className="muted"> / {t.time_limit}:00</span> : null}</span>
                    </a>
                  );
                })}
              </div>
            </Card>
          )}

          <Card title="完成度矩阵" sub={`已评分运行 / 每题 ${spec?.cfg.runs_per_task || 3} 次`} extra={<a className="link small" href={href('runs')}>全部运行 →</a>} pad={false}>
            {!coverage.rows.length ? <Empty icon={<Boxes size={26} />} title="暂无模型" action={<Btn tone="primary" onClick={() => setNewModel(true)}>新增模型</Btn>}>模型工作区统一放在 <code>model/&lt;供应商&gt;/&lt;模型&gt;/</code></Empty> : (
              <div className="tw">
                <table className="tbl cov">
                  <thead><tr><th>模型</th>{coverage.tkeys.map((k) => <th key={k} className="c mono">{k}</th>)}<th className="num">进度</th></tr></thead>
                  <tbody>
                    {coverage.rows.map(({ m, cells, done, all }) => (
                      <tr key={m.vendor + m.name}>
                        <td><a className="link" href={href('models', [m.vendor, m.name])}>{nm.model(m.vendor, m.name)}</a></td>
                        {cells.map((c) => (
                          <td key={c.k} className="c">
                            <button className={`cov-cell ${c.graded >= c.need ? 'full' : c.total ? 'part' : ''}`} title={`${c.k}：已评分 ${c.graded} / 已创建 ${c.total} / 需 ${c.need}`}
                              onClick={() => c.total ? go('runs', [], { model: `${m.vendor}/${m.name}`, task: c.k }) : setNewRun(true)}>
                              {c.total ? `${c.graded}/${c.need}` : <CircleDashed size={12} />}
                            </button>
                          </td>
                        ))}
                        <td className="num mono">{all ? Math.round((done / all) * 100) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="col">
          <Card title="排行榜" extra={<a className="link small" href={href('board')}>完整榜单 →</a>}>
            {!top.length ? <Empty icon={<Trophy size={26} />} title="还没有评分结果">登记并评分运行后，这里显示质量总分、置信区间和雷达图。</Empty> : (
              <>
                <Radar axes={qdims.map((d) => ({ id: d.id, label: d.name }))} series={top.map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: nm.color(b.entrant), values: b.dims }))} size={340} />
                <ol className="mini-board">
                  {top.map((b) => (
                    <li key={b.entrant}>
                      <span className="rank">{b.rank}</span>
                      <i className="dot" style={{ background: nm.color(b.entrant) }} />
                      <span className="grow ellipsis">{nm.entrant(b.entrant)}</span>
                      {!b.complete && <Badge tone="warn">未完整</Badge>}
                      <Score v={b.quality} />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Card>

          <Card title={<><Clock3 size={15} /> 最近活动</>}>
            <ul className="feed">
              {wb.jobs.slice(0, 4).map((j) => (
                <li key={j.id}><a href={href('jobs', [j.id])}><Badge tone={j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'info'} dot>{j.status === 'done' ? '完成' : j.status === 'failed' ? '失败' : j.status === 'queued' ? '排队' : '运行中'}</Badge> {j.title}</a><span className="muted small">{fmt.ago(j.started_at)}</span></li>
              ))}
              {(st?.history || []).slice(0, 8).map((h, i) => (
                <li key={i}><span><span className="mono muted small">{h.action}</span> {nm.blind ? '' : h.detail}</span><span className="muted small">{fmt.ago(h.at)}</span></li>
              ))}
              {!wb.jobs.length && !st?.history.length && <li className="muted">暂无</li>}
            </ul>
          </Card>

          {(missingMat.length > 0) && (
            <Card title={<><TriangleAlert size={15} /> 素材状态</>}>
              {missingMat.map(([k, v]) => <div key={k} className="small"><TaskLabel task={k} />：缺 {v.missing.join('、')}</div>)}
            </Card>
          )}
        </div>
      </div>
      {newRun && <NewRunModal open onClose={() => setNewRun(false)} />}
      {newModel && <ModelModal open onClose={() => setNewModel(false)} />}
    </div>
  );
}
