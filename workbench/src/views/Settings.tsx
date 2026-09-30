// 设置：提示词约定 · Harness · 评测机 · 存储文件 · 后台任务 · CLI 与 Agent · 关于。
import { useEffect, useRef, useState } from 'react';
import { Ban, Bot, Database, FileCode2, FolderOpen, Gauge, Info, Keyboard, MessageSquareText, RefreshCw, Save, Terminal, Wrench } from 'lucide-react';
import type { JobInfo, WbSettings } from '../../shared/types';
import { HARNESSES, harnessById } from '../../shared/vendors';
import { get, post, desktop } from '../api';
import { bus, jobKey, useBus, useWb } from '../state';
import { go, href, useRoute } from '../lib/router';
import { cls, copyText, fmt } from '../lib/format';
import { Badge, Btn, Card, CopyBtn, Empty, Field, Kv, Select, ToggleRow } from '../ui/kit';
import { GithubIcon, HarnessIcon } from '../ui/brand';
import { toast } from '../ui/toast';

const SEC = [
  { id: 'prompt', label: '提示词与计时', icon: MessageSquareText },
  { id: 'harness', label: 'Harness', icon: Terminal },
  { id: 'machine', label: '评测机', icon: Wrench },
  { id: 'store', label: '存储文件', icon: Database },
  { id: 'jobs', label: '后台任务', icon: Gauge },
  { id: 'agent', label: 'CLI 与 Agent', icon: Bot },
  { id: 'about', label: '关于', icon: Info },
];

export default function Settings() {
  const route = useRoute();
  const sec = route.parts[0] || 'prompt';
  return (
    <div className="page settings">
      <div className="page-head"><div className="page-head-t"><h1 className="page-title">设置</h1><p className="page-sub">所有设置保存在可移植存储文件中，换电脑后随数据一起迁移。</p></div></div>
      <div className="settings-grid">
        <nav className="settings-nav glass-thin">
          {SEC.map((s) => <a key={s.id} href={href('settings', [s.id])} className={cls('toc-i', sec === s.id && 'on')}><s.icon size={15} />{s.label}</a>)}
        </nav>
        <div className="stack l">
          {sec === 'prompt' && <PromptSettings />}
          {sec === 'harness' && <HarnessSettings />}
          {sec === 'machine' && <Machine />}
          {sec === 'store' && <StoreSettings />}
          {sec === 'jobs' && <Jobs />}
          {sec === 'agent' && <AgentInfo />}
          {sec === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

function useSettings() {
  const wb = useWb();
  const s = wb.store?.settings || {};
  const save = async (patch: Partial<WbSettings>, msg = '已保存') => { try { await post('/api/settings', patch); toast.ok(msg); await wb.refresh(['store']); } catch (e: any) { toast.error(e.message); } };
  return { s, save };
}

function PromptSettings() {
  const { s, save } = useSettings();
  const [tts, setTts] = useState(s.tts_command || '');
  return (
    <>
      <Card title="复制提示词时">
        <ToggleRow title="附带统一运行约定" desc="在题目原文前加入工作目录绝对路径、交付文件夹名、必须存在的文件与 FINAL_MESSAGE.md 约定。关闭后只发送 prompt.md 原文。" checked={s.prompt_header !== false} onChange={(v) => void save({ prompt_header: v })} />
        <ToggleRow title="复制即开始计时" desc="复制提示词时记录开始时间；模型写出 FINAL_MESSAGE.md 时自动结束。" checked={s.auto_start !== false} onChange={(v) => void save({ auto_start: v })} />
        <ToggleRow title="复制后自动打开 harness" desc="题目页的「复制提示词」同时启动模型绑定的 harness（也可以随时用旁边的「复制并打开」按钮）。" checked={!!s.open_harness} onChange={(v) => void save({ open_harness: v })} />
      </Card>
      <Card title="TTS 命令" sub="替换 T04 提示词中的 {TTS_COMMAND}" extra={<Btn size="sm" tone="primary" icon={<Save size={14} />} onClick={() => void save({ tts_command: tts })}>保存</Btn>}>
        <Field label="评测机上所有模型统一使用的 TTS 命令" hint="例如 edge-tts --voice zh-CN-XiaoxiaoNeural --text"><input className="mono" value={tts} onChange={(e) => setTts(e.target.value)} placeholder="edge-tts --voice zh-CN-XiaoxiaoNeural --text" /></Field>
      </Card>
    </>
  );
}

function HarnessSettings() {
  const wb = useWb();
  const { s, save } = useSettings();
  const inst = wb.harness.filter((h) => h.installed);
  return (
    <>
      <Card title="默认 harness" sub="新增模型时推荐；模型档案里的 harness 优先">
        <Select value={s.default_harness || ''} onChange={(v) => void save({ default_harness: v }, '已设为默认 harness')} block searchable placeholder="选择默认 harness"
          options={HARNESSES.map((h) => ({ value: h.id, label: h.name, icon: <HarnessIcon name={h.name} size="xs" />, group: wb.harness.find((x) => x.id === h.id)?.installed ? '本机已安装' : '未检测到' })).sort((a, b) => (a.group === b.group ? 0 : a.group === '本机已安装' ? -1 : 1))} />
      </Card>
      <Card title="本机检测到的 harness" sub={`${inst.length} / ${HARNESSES.length}`} extra={<Btn size="sm" icon={<RefreshCw size={13} />} onClick={() => void get('/api/harness', { refresh: 1 }).then(() => wb.refresh(['harness']))}>重新检测</Btn>} pad={false}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Harness</th><th>类型</th><th>路径</th><th /></tr></thead>
          <tbody>{HARNESSES.map((h) => {
            const d = wb.harness.find((x) => x.id === h.id);
            return (
              <tr key={h.id}>
                <td><span className="row gap-s"><HarnessIcon name={h.name} size="sm" /><b>{h.name}</b>{s.default_harness === h.id && <Badge tone="accent">默认</Badge>}</span></td>
                <td className="small">{h.kind === 'cli' ? '命令行（在工作目录开新终端）' : h.kind === 'ide' ? 'IDE（打开工作目录）' : '桌面应用'}</td>
                <td className="mono xs muted ellipsis" style={{ maxWidth: 360 }}>{d?.path || '未检测到'}</td>
                <td>{d?.installed ? <Btn size="xs" onClick={() => void post<{ how: string }>('/api/harness/open', { id: h.id }).then((r) => toast.ok(r.how), (e) => toast.error(e.message))}>试打开</Btn> : <Badge>未安装</Badge>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
      <p className="muted small">只会启动这张表里登记且在本机检测到的程序；参数不经过 shell 拼接。命令行 harness 会在工作目录里新开一个终端窗口运行。</p>
    </>
  );
}

function Machine() {
  const wb = useWb();
  const s = wb.session;
  const rel = (p: string) => (p.startsWith(s.root) ? p.slice(s.root.length + 1).replace(/\\/g, '/') : p);
  return (
    <Card title="评测机与 bench-grader">
      <Kv rows={[
        ['Python', s.python ? <code key="p">{s.python}</code> : <span className="tone-text-bad">未找到（评分、规范读取需要 Python 3）</span>],
        ['bench-grader', <code key="g">{rel(s.paths.grader)}</code>],
        ['评分数据', <code key="d">{rel(s.paths.bench_data)}</code>],
        ['模型工作区', <code key="m">{rel(s.paths.model)}/&lt;供应商&gt;/&lt;模型&gt;/</code>],
        ['Agent skills 镜像', <code key="a">{rel(s.paths.agents_skills)}</code>],
        ['端口', `工作台 ${s.port} · 预览 ${s.preview_ports[0]}–${s.preview_ports[1]}（每个预览独立源）`],
        ['题库来源', wb.spec?._source === 'python' ? 'bench-grader（实时）' : wb.spec?._source === 'cache' ? '存储文件缓存' : '规范页'],
      ]} />
      <div className="row gap-s mt wrap">
        <Btn size="sm" onClick={() => void wb.runJob({ kind: 'doctor' }, '依赖检查')}>依赖检查（doctor）</Btn>
        <Btn size="sm" onClick={() => void wb.runJob({ kind: 'validate' }, 'rubric 自检')}>rubric 自检</Btn>
        <Btn size="sm" onClick={() => void wb.runJob({ kind: 'materials' }, '生成素材')}>生成 T03/T04 素材</Btn>
        <Btn size="sm" onClick={() => void wb.runJob({ kind: 'build-spec' }, '生成规范页')}>重新生成 benchmark-spec.html</Btn>
        <Btn size="sm" onClick={() => void post<{ copied: number }>('/api/skills/sync').then((r) => toast.ok(`skills 已同步到 .agents/skills（更新 ${r.copied} 个文件）`), (e) => toast.error(e.message))}>同步 skills 到 .agents</Btn>
        <Btn size="sm" tone="ghost" onClick={() => void get('/api/spec', { refresh: 1 }).then(() => wb.refresh(['spec']))}>重新读取题库</Btn>
      </div>
    </Card>
  );
}

function StoreSettings() {
  const wb = useWb();
  const st = wb.store;
  return (
    <Card title="可移植存储文件" extra={<Btn size="sm" onClick={() => go('exports')}>导入 / 导出</Btn>}>
      <p className="dim small">全部模型档案、运行登记、分数、人工评分、用量、设置与笔记都在一个 JSON 文件里。复制到另一台电脑即可恢复全部对比数据。</p>
      <div className="mt"><Kv rows={[
        ['文件', <code key="f">{wb.session.paths.store}</code>], ['更新于', fmt.time(st?.updated_at)],
        ['内容', `${st?.models.length || 0} 个模型 · ${st?.workspaces.length || 0} 个工作区运行 · ${st?.runs.length || 0} 次登记运行 · ${st?.notes.length || 0} 条笔记`],
        ['来源机器', st?.machine || '—'],
      ]} /></div>
      <div className="row gap-s mt"><Btn size="sm" icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { path: 'data' })}>打开 data/</Btn><Btn size="sm" tone="ghost" onClick={() => void wb.runJob({ kind: 'sync' }, '同步')}>重新同步</Btn></div>
      <div className="section-h mt-l" style={{ padding: 0 }}><h2 style={{ fontSize: 15 }}>最近动态</h2></div>
      <ul className="feed">{(st?.history || []).slice(-20).reverse().map((h, i) => <li key={i}><span className="badge">{h.action}</span><span className="grow small ellipsis">{h.detail}</span><span className="muted xs">{fmt.ago(h.at)}</span></li>)}</ul>
    </Card>
  );
}

const TONE: Record<JobInfo['status'], string> = { queued: 'muted', running: 'info', done: 'ok', failed: 'bad', cancelled: 'muted' };
const LABEL: Record<JobInfo['status'], string> = { queued: '排队中', running: '运行中', done: '完成', failed: '失败', cancelled: '已取消' };
function Jobs() {
  const wb = useWb();
  const route = useRoute();
  const jobs = [...wb.jobs].sort((a, b) => b.started_at - a.started_at);
  const cur = jobs.find((j) => j.id === route.query.get('job')) || jobs[0];
  const quick: [string, Record<string, unknown>][] = [['评分未评分运行', { kind: 'grade', all: true, skip_graded: true }], ['生成评分包', { kind: 'review' }], ['导出报表', { kind: 'export' }], ['依赖检查', { kind: 'doctor' }], ['同步存储', { kind: 'sync' }]];
  return (
    <Card title="后台任务" sub="评分、导出等按顺序逐个执行，避免同时占用大量内存" extra={<div className="btn-group">{quick.map(([l, b]) => <Btn key={l} size="xs" onClick={() => void wb.runJob(b, l)}>{l}</Btn>)}</div>}>
      {!jobs.length ? <Empty icon={<Gauge size={28} />} title="本次启动后还没有任务" /> : (
        <div className="jobs">
          <div className="job-list">{jobs.map((j) => (
            <a key={j.id} href={href('settings', ['jobs'], { job: j.id })} className={cls('job-i', cur?.id === j.id && 'on')}>
              <div className="row gap-s"><Badge tone={TONE[j.status]} dot>{LABEL[j.status]}</Badge><span className="muted xs">{fmt.ago(j.started_at)}</span></div>
              <div className="small ellipsis">{j.title}</div>
            </a>
          ))}</div>
          {cur && <JobDetail j={cur} key={cur.id} />}
        </div>
      )}
    </Card>
  );
}
function JobDetail({ j }: { j: JobInfo }) {
  const lines = useBus<string>(jobKey(j.id));
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => { get<{ output: string[] }>(`/api/jobs/${j.id}`).then((r) => bus.set(jobKey(j.id), r.output || [])).catch(() => {}); }, [j.id]);
  useEffect(() => { const el = box.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight; }, [lines.length]);
  return (
    <div className="stack">
      <div className="row gap-s">
        <div className="grow"><b>{j.title}</b><div className="muted xs">{j.kind} · 开始 {fmt.time(j.started_at)} · 耗时 {fmt.clock((j.ended_at || Date.now()) - j.started_at)}{j.code != null ? ` · 退出码 ${j.code}` : ''}{j.error ? ` · ${j.error}` : ''}</div></div>
        {(j.status === 'running' || j.status === 'queued') && <Btn size="sm" tone="danger" icon={<Ban size={14} />} onClick={() => void post(`/api/jobs/${j.id}/cancel`)}>取消</Btn>}
      </div>
      {j.result != null && <pre className="prompt">{JSON.stringify(j.result, null, 2)}</pre>}
      <pre ref={box} className="term">{lines.map((l, i) => <span key={i} className={/error|错误|失败|Traceback/i.test(l) ? 'err' : /warn|警告/i.test(l) ? 'warn' : undefined}>{l}{'\n'}</span>)}{!lines.length && <span className="muted">（暂无输出）</span>}</pre>
    </div>
  );
}

function AgentInfo() {
  const wb = useWb();
  const s = wb.session;
  const sep = s.root.includes('\\') ? '\\' : '/';
  const ai = async () => { const r = await get<{ text: string }>('/api/review-prompt'); if (await copyText(r.text)) toast.ok('已复制 AI 评审提示词'); };
  return (
    <>
      <Card title="让任何 Agent 驱动评测" sub="CLI + skills，无需接入 Agent 框架">
        <ol className="plain-list small dim">
          <li>两个 skill 已镜像到 <code>.agents/skills/</code>：<code>bench-workbench</code>（wb CLI 用法）与 <code>bench-grader</code>（评分口径）。源文件在 <code>skills/</code>。</li>
          <li>被测模型的工作目录是独立 git 根，看不到这些评分 skill；只有评分 Agent 在仓库根目录工作时才会读到。</li>
          <li>把「AI 评审提示词」粘贴给评分 Agent（例如 DeepSeek Harness），它会读 skill、用 <code>wb pending / wb score</code> 完成 Agent 审查项并附证据。</li>
        </ol>
        <div className="row gap-s mt"><Btn tone="primary" icon={<Bot size={15} />} onClick={() => void ai()}>复制 AI 评审提示词</Btn><Btn icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { path: '.agents/skills' }).catch((e) => toast.error(e.message))}>打开 .agents/skills</Btn></div>
      </Card>
      <Card title="路径" pad={true}>
        <Kv rows={[
          ['wb CLI', <code key="c">{s.root}{sep}wb.cmd</code>],
          ['skill（相对）', <code key="r">.agents/skills/bench-workbench/SKILL.md</code>],
          ['skill（绝对，备用）', <code key="a">{s.root}{sep}skills{sep}bench-workbench{sep}SKILL.md</code>],
          ['评分口径', <code key="g">{s.root}{sep}skills{sep}bench-grader{sep}SKILL.md</code>],
          ['HTTP API', <code key="h">http://127.0.0.1:{s.port}/api/*（写操作需 x-wb-token）</code>],
        ]} />
      </Card>
      <Card title={<span className="row gap-s"><Keyboard size={15} />快捷键</span>}>
        <div className="kbd-grid small">
          {[['Ctrl K', '命令面板'], ['G 然后 O / M / T / R / S / B / C / E / D', '跳转页面'], ['C', '题目页：复制提示词'], ['0 – 3', '评分面板：打分'], ['J / K', '评分面板：下一项 / 上一项'], ['N', '评分面板：写备注'], ['Esc', '关闭弹层']].map(([k, d]) => <div key={k} className="row gap-s"><kbd>{k}</kbd><span className="dim">{d}</span></div>)}
        </div>
      </Card>
    </>
  );
}

function About() {
  const wb = useWb();
  const gh = wb.session.github;
  const open = (u: string) => { const D = desktop(); if (D) void D.openExternal(u); else window.open(u, '_blank', 'noopener'); };
  return (
    <Card title="Bench Workbench" sub={`v${wb.session.version}${wb.session.desktop ? ' · 桌面版' : ''}`}>
      <p className="dim small">TryProtocom Model-Compare：个人 Coding Bench 的评测工作台。选题复制 → 自动检测交付 → 预览打分 → 出榜对比导出。</p>
      <div className="row gap-s mt">
        <Btn icon={<GithubIcon size={15} />} onClick={() => open(gh)}>GitHub 仓库</Btn>
        <Btn icon={<FileCode2 size={15} />} onClick={() => { location.href = '/api/source.zip'; }}>下载源码 ZIP</Btn>
        <CopyBtn text={gh} label="复制仓库地址" />
      </div>
      <p className="muted xs mt">品牌图标来自 Lobe Icons（MIT）。源码包不含 <code>tasks/*/hidden/</code>。</p>
    </Card>
  );
}
