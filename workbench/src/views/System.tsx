// 系统：设置、可移植存储文件（导出 / 导入合并）、评测机依赖与素材、报告目录、CLI 与 Agent 接入说明。
import { useEffect, useRef, useState } from 'react';
import { Database, Download, FolderOpen, Keyboard, Save, Terminal, Upload, Wrench } from 'lucide-react';
import { get, post } from '../api';
import { useWb } from '../state';
import { fmt } from '../lib/format';
import { Btn, Card, CopyBtn, Field, Kv } from '../ui/kit';
import { toast } from '../ui/toast';
import { HarnessList } from '../components/common';

export default function System() {
  const wb = useWb();
  const s = wb.session;
  const st = wb.store;
  const [tts, setTts] = useState(st?.settings.tts_command || '');
  const [harness, setHarness] = useState(st?.settings.default_harness || '');
  const [reports, setReports] = useState<{ name: string; files: string[]; mtime: number }[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { get<typeof reports>('/api/reports').then(setReports).catch(() => {}); }, [wb.jobs.length]);
  const saveSettings = async () => { try { await post('/api/settings', { tts_command: tts, default_harness: harness }); toast.ok('设置已保存到存储文件'); } catch (e: any) { toast.error(e.message); } };
  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const r = await post<Record<string, number>>('/api/store/import', data);
      toast.ok(`已合并：${Object.entries(r).map(([k, v]) => `${k} ${v}`).join('，')}`);
    } catch (e: any) { toast.error('导入失败：' + e.message); }
  };
  const rel = (p: string) => p.startsWith(s.root) ? p.slice(s.root.length + 1).replace(/\\/g, '/') : p;
  const cli = `${s.root}\\wb.cmd`;
  return (
    <div className="page">
      <div className="grid-2">
        <Card title={<><Save size={15} /> 评测设置</>} extra={<Btn size="sm" tone="primary" onClick={() => void saveSettings()}>保存</Btn>}>
          <Field label="TTS 命令（替换提示词中的 {TTS_COMMAND}）" hint="评测机上所有模型统一使用的同一个命令，例如 edge-tts --voice zh-CN-XiaoxiaoNeural"><input className="mono" value={tts} onChange={(e) => setTts(e.target.value)} placeholder="edge-tts --voice zh-CN-XiaoxiaoNeural --text" /></Field>
          <Field label="默认 harness"><input list="wb-harness" value={harness} onChange={(e) => setHarness(e.target.value)} placeholder="Claude Code" /><HarnessList /></Field>
        </Card>

        <Card title={<><Database size={15} /> 可移植存储文件</>}>
          <p className="muted small">全部模型档案、运行登记、分数、人工评分、用量与笔记都保存在一个 JSON 文件里。复制到另一台电脑的同一位置（或在那里点“导入”）即可恢复全部对比数据；导入按运行 id 合并，较新的记录覆盖较旧的。</p>
          <Kv rows={[
            ['文件', <code key="f">{rel(s.paths.store)}</code>],
            ['更新于', fmt.time(st?.updated_at)],
            ['内容', `${st?.models.length || 0} 个模型 · ${st?.workspaces.length || 0} 个工作区运行 · ${st?.runs.length || 0} 次登记运行 · ${st?.notes.length || 0} 条笔记`],
            ['来源机器', st?.machine || '—'],
          ]} />
          <div className="row gap-s mt-s wrap">
            <a className="btn primary sm" href="/api/store/export"><Download size={14} /><span>导出存储文件</span></a>
            <Btn size="sm" icon={<Upload size={14} />} onClick={() => file.current?.click()}>导入并合并…</Btn>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            <Btn size="sm" tone="ghost" icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { path: 'data' })}>打开 data/</Btn>
            <Btn size="sm" tone="ghost" onClick={() => void wb.runJob({ kind: 'sync' })}>重新同步</Btn>
          </div>
        </Card>

        <Card title={<><Wrench size={15} /> 评测机与 bench-grader</>}>
          <Kv rows={[
            ['Python', s.python ? <code key="p">{s.python}</code> : <span className="bad">未找到（评分、规范读取需要 Python 3）</span>],
            ['bench-grader', <code key="g">{rel(s.paths.grader)}</code>],
            ['评分数据', <code key="d">{rel(s.paths.bench_data)}</code>],
            ['模型工作区', <code key="m">{rel(s.paths.model)}/&lt;供应商&gt;/&lt;模型&gt;/</code>],
            ['全局报告', <code key="r">{rel(s.paths.reports)}/</code>],
            ['端口', `工作台 ${s.port} · 预览 ${s.preview_ports[0]}–${s.preview_ports[1]}（每个预览独立源）`],
          ]} />
          <div className="row gap-s mt-s wrap">
            <Btn size="sm" onClick={() => void wb.runJob({ kind: 'doctor' }, '依赖检查')}>依赖检查（doctor）</Btn>
            <Btn size="sm" onClick={() => void wb.runJob({ kind: 'validate' }, 'rubric 自检')}>rubric 自检</Btn>
            <Btn size="sm" onClick={() => void wb.runJob({ kind: 'materials' }, '生成素材')}>生成 T03/T04 素材</Btn>
            <Btn size="sm" onClick={() => void wb.runJob({ kind: 'build-spec' }, '生成规范页')}>重新生成 benchmark-spec.html</Btn>
          </div>
        </Card>

        <Card title={<><FolderOpen size={15} /> 报告</>}>
          <p className="muted small">单模型报告：<code>model/&lt;供应商&gt;/&lt;模型&gt;/_report/REPORT.md</code>（在模型页生成）。全局导出：<code>reports/&lt;时间&gt;-&lt;标签&gt;/</code>，含 CSV / Markdown / Excel / 雷达图 / 帕累托图 / 单页 HTML，以及当时的存储文件快照。</p>
          <div className="row gap-s"><Btn size="sm" tone="primary" onClick={() => void wb.runJob({ kind: 'export' }, '导出报表')}>导出全部报表</Btn></div>
          <ul className="feed mt-s">
            {reports.slice(0, 10).map((r) => <li key={r.name}><span className="mono small">{r.name}</span><span className="muted xs">{r.files.length} 个文件 · {fmt.ago(r.mtime)}</span><Btn size="xs" tone="ghost" onClick={() => void post('/api/open-folder', { path: 'reports/' + r.name })}>打开</Btn></li>)}
            {!reports.length && <li className="muted small">还没有导出</li>}
          </ul>
        </Card>

        <Card title={<><Terminal size={15} /> CLI 与 Agent 接入</>} className="span-2">
          <p className="muted small">通用 Agent（Claude Code、Codex CLI、Kiro 等）读取 <code>skills/bench-workbench/SKILL.md</code> 后，用 <code>wb</code> 命令完成新建运行、计时、登记、评分、Agent 审查打分、无头检查页面报错、出榜与导出；配合 <code>skills/bench-grader</code> 的评分口径。所有命令支持 <code>--json</code>，服务未启动时自动在后台启动。</p>
          <div className="grid-2">
            <pre className="formula">{`# Windows（仓库根目录）
wb status
wb run new OpenAI/GPT-6.1-Sol T05 --harness "Codex CLI"
wb run start OpenAI/GPT-6.1-Sol/T05/r1
wb run finish OpenAI/GPT-6.1-Sol/T05/r1 --final-file final.md --register
wb pending --method agent --json
wb score <run_id> <item_id> 2 --note "证据" --by agent
wb check OpenAI/GPT-6.1-Sol/T05/r1 --mobile --json
wb logs <session> --errors --follow
wb board --json`}</pre>
            <div className="stack">
              <Kv rows={[['CLI', <code key="c">{cli}</code>], ['Skill', <code key="s">{rel(s.paths.skill)}/SKILL.md</code>], ['运行信息', <code key="r">workbench/.runtime/runtime.json</code>]]} />
              <div className="row gap-s wrap"><CopyBtn text={cli} label="复制 CLI 路径" /><CopyBtn text={`请阅读 ${s.root}\\skills\\bench-workbench\\SKILL.md 与 ${s.root}\\skills\\bench-grader\\SKILL.md，然后用 wb CLI 完成评测。`} label="复制给 Agent 的开场指令" /></div>
              <p className="muted xs">安全：服务只监听 127.0.0.1；写操作需要启动时随机生成的令牌（CLI 从 runtime.json 读取）；跨源请求被拒绝；模型产物在独立端口的预览源中运行，无法调用工作台接口。</p>
            </div>
          </div>
        </Card>

        <Card title={<><Keyboard size={15} /> 快捷键</>}>
          <Kv rows={[
            ['Ctrl / ⌘ + K', '命令面板（跳转、操作、搜索模型 / 运行 / 题目）'],
            ['G 然后 O/B/M/R/V/S/K/J', '跳转：总览 / 排行 / 模型 / 运行 / 评审 / 舞台 / 规范 / 任务'],
            ['评审页', '← → 或 J K 切换运行，0–3 打分，N 下一个检查项'],
            ['视频播放器', '空格 播放，, . 逐帧，[ ] A-B 循环，f 全屏'],
            ['桌面版预览', 'F12 打开原生 Chromium DevTools'],
          ]} />
        </Card>
      </div>
    </div>
  );
}
