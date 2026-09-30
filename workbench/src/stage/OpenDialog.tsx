// “打开产物”对话框：运行产物 / 仓库内文件 / 开发服务器（自动识别 package.json 脚本并接入代理）/ 地址。
import { useEffect, useMemo, useState } from 'react';
import { Package, Play, Search, TriangleAlert } from 'lucide-react';
import type { PreviewSession, ProcInfo } from '../../shared/types';
import { get, post } from '../api';
import { useWb } from '../state';
import { isVideo } from '../lib/format';
import { Badge, Btn, CheckBox, Empty, Field, Modal, Select, Spinner, Tabs } from '../ui/kit';
import { toast } from '../ui/toast';
import { FileBrowser } from '../components/Files';
import { Score, WsBadge, useNamer } from '../components/common';
import { ProcOutput } from './DevTools';

type T = 'runs' | 'files' | 'dev' | 'url';
interface Scripts { packages: { dir: string; scripts: Record<string, string>; has_modules: boolean }[]; python: string[]; bench_json: any }

export function OpenDialog({ onClose, onOpenSession, onOpenVideo, onOpenRef }: { onClose: () => void; onOpenSession: (s: PreviewSession, replace?: boolean) => void; onOpenVideo: (path: string, label: string) => void; onOpenRef: (x: string) => void }) {
  const wb = useWb();
  const nm = useNamer();
  const [tab, setTab] = useState<T>('runs');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ws = wb.store?.workspaces || [];
  const orphan = (wb.store?.runs || []).filter((r) => !ws.some((w) => w.grader_run_id === r.run_id));
  const list = useMemo(() => [
    ...ws.map((w) => ({ key: 'ws:' + w.ref, title: nm.ref(w.ref), sub: w.harness, entry: w.entry, run: wb.store?.runs.find((r) => r.run_id === w.grader_run_id), w })),
    ...orphan.map((r) => ({ key: 'run:' + r.run_id, title: nm.run(r), sub: r.harness, entry: null as string | null, run: r, w: undefined })),
  ].filter((x) => !q || (x.title + ' ' + x.sub).toLowerCase().includes(q.toLowerCase())), [ws, orphan, q, nm, wb.store]);
  const togglePick = (k: string) => { const s = new Set(picked); if (s.has(k)) s.delete(k); else if (s.size < 4) s.add(k); setPicked(s); };

  return (
    <Modal open onClose={onClose} title="打开产物" width={980} className="open-dlg"
      footer={tab === 'runs' ? <><span className="muted small grow">可多选（最多 4 个）并排对比</span><Btn tone="ghost" onClick={onClose}>取消</Btn><Btn tone="primary" disabled={!picked.size} onClick={() => { [...picked].forEach(onOpenRef); onClose(); }}>打开 {picked.size || ''} 个</Btn></> : undefined}>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'runs', label: '运行产物' }, { value: 'files', label: '仓库文件' }, { value: 'dev', label: '开发服务器' }, { value: 'url', label: '地址' }]} />
      {tab === 'runs' && (
        <div className="stack">
          <div className="search-in"><Search size={14} /><input autoFocus placeholder="搜索 供应商/模型/题号/rN" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="pick-list">
            {!list.length && <Empty title="没有运行">先在“运行”页新建运行。</Empty>}
            {list.map((x) => (
              <label key={x.key} className="pick-i">
                <CheckBox checked={picked.has(x.key)} onChange={() => togglePick(x.key)} label="选择" />
                <span className="mono grow ellipsis">{x.title}</span>
                <span className="muted small">{x.sub}</span>
                <span className="mono xs muted ellipsis" style={{ maxWidth: 200 }}>{x.entry || (x.w ? '未发现入口' : '存储运行')}</span>
                {x.run?.score ? <Score v={x.run.score.total} /> : x.w ? <WsBadge w={x.w} /> : null}
                <Btn size="xs" tone="ghost" onClick={(e) => { e.preventDefault(); onOpenRef(x.key); onClose(); }}>打开</Btn>
              </label>
            ))}
          </div>
        </div>
      )}
      {tab === 'files' && (
        <FileBrowser root="model" title="model" height={460} onOpenHtml={(p) => void post<PreviewSession>('/api/preview', { path: p }).then((s) => { onOpenSession(s); onClose(); }, (e) => toast.error(e.message))} />
      )}
      {tab === 'files' && (
        <div className="row gap-s mt-s">
          <span className="muted small grow">也可以预览整个目录（自动使用 index.html 或列出目录）或视频文件：</span>
          <PathOpener onOpenSession={(s) => { onOpenSession(s); onClose(); }} onOpenVideo={(p, l) => { onOpenVideo(p, l); onClose(); }} />
        </div>
      )}
      {tab === 'dev' && <DevServer onOpen={(s) => { onOpenSession(s); onClose(); }} />}
      {tab === 'url' && <UrlOpen onOpen={(s) => { onOpenSession(s); onClose(); }} />}
    </Modal>
  );
}

function PathOpener({ onOpenSession, onOpenVideo }: { onOpenSession: (s: PreviewSession) => void; onOpenVideo: (p: string, l: string) => void }) {
  const [p, setP] = useState('model/');
  return (
    <form className="row gap-s" onSubmit={(e) => { e.preventDefault(); if (isVideo(p)) onOpenVideo(p, p.split('/').pop()!); else void post<PreviewSession>('/api/preview', { path: p }).then(onOpenSession, (er) => toast.error(er.message)); }}>
      <input className="mono" style={{ width: 360 }} value={p} onChange={(e) => setP(e.target.value)} aria-label="相对仓库根目录的路径" />
      <Btn type="submit">预览</Btn>
    </form>
  );
}

function DevServer({ onOpen }: { onOpen: (s: PreviewSession) => void }) {
  const wb = useWb();
  const nm = useNamer();
  const ws = wb.store?.workspaces || [];
  const [ref, setRef] = useState(ws.at(-1)?.ref || '');
  const [scan, setScan] = useState<Scripts | null>(null);
  const [loading, setLoading] = useState(false);
  const [cmd, setCmd] = useState('');
  const [sub, setSub] = useState('');
  const [proc, setProc] = useState<ProcInfo | null>(null);
  const [target, setTarget] = useState('http://localhost:5173');
  useEffect(() => {
    if (!ref) return;
    setLoading(true); setScan(null);
    get<Scripts>('/api/scripts', { ref }).then((r) => {
      setScan(r);
      const pk = r.packages[0];
      if (pk) {
        const s = pk.scripts;
        const pick = ['dev', 'start', 'serve', 'preview'].find((k) => s[k]);
        setCmd(pick ? `npm run ${pick}` : '');
        setSub(pk.dir.split('/').slice(5).join('/'));
      } else if (r.python.length) { setCmd(`python ${r.python[0]}`); setSub(''); }
      else if (r.bench_json?.start) { setCmd(r.bench_json.start); setSub(''); }
    }, (e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [ref]);
  // 进程拿到地址并建立代理后，自动打开
  const live = proc ? wb.procs.find((p) => p.id === proc.id) : null;
  useEffect(() => {
    if (live?.session_id) { const s = wb.previews.find((x) => x.id === live.session_id); if (s) onOpen(s); }
  }, [live?.session_id, wb.previews]); // eslint-disable-line
  const start = async () => {
    try { setProc(await post<ProcInfo>('/api/procs', { ref, sub, cmd, autoPreview: true, name: `${nm.ref(ref)} · ${cmd}` })); }
    catch (e: any) { toast.error(e.message); }
  };
  const pkg = scan?.packages.find((p) => p.dir.split('/').slice(5).join('/') === sub) || scan?.packages[0];
  return (
    <div className="grid-2">
      <div className="stack">
        <Field label="工作区运行">
          <Select value={ref} onChange={setRef} block searchable options={ws.map((w) => ({ value: w.ref, label: nm.ref(w.ref) }))} />
        </Field>
        {loading && <Spinner />}
        {scan && (
          <>
            {!scan.packages.length && !scan.python.length && <p className="muted small">没有在工作目录里找到 package.json / app.py。</p>}
            {scan.packages.map((p) => (
              <div key={p.dir} className="pkg">
                <div className="row gap-s"><Package size={14} /><span className="mono small grow ellipsis">{p.dir.split('/').slice(5).join('/') || '（根目录）'}</span>{!p.has_modules && <Badge tone="warn">未安装依赖</Badge>}</div>
                <div className="chips">{Object.entries(p.scripts).map(([k, v]) => <button key={k} className="chip btnchip" title={v} onClick={() => { setCmd(`npm run ${k}`); setSub(p.dir.split('/').slice(5).join('/')); }}>{k}</button>)}</div>
                {!p.has_modules && <Btn size="xs" onClick={() => void wb.runJob({ kind: 'npm-install', cwd: p.dir }, 'npm install')}>npm install</Btn>}
              </div>
            ))}
            <Field label="子目录（相对工作目录）"><input className="mono" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="studyspot-api" /></Field>
            <Field label="启动命令" hint="输出里出现 http://localhost:端口 后会自动建立代理（注入探针，支持 HMR / WebSocket）"><input className="mono" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="npm run dev" /></Field>
            {pkg && !pkg.has_modules && <div className="alert warn"><TriangleAlert size={14} />依赖未安装，先运行 npm install（在“任务”页查看进度）。</div>}
            <Btn tone="primary" icon={<Play size={14} />} disabled={!cmd} onClick={() => void start()}>启动并预览</Btn>
          </>
        )}
        <hr />
        <Field label="已在运行的开发服务器" hint="例如模型自己启动的 Vite / Next / Flask，代理后可注入探针、读取报错">
          <div className="row gap-s"><input className="mono grow" value={target} onChange={(e) => setTarget(e.target.value)} /><Btn onClick={() => void post<PreviewSession>('/api/preview', { target }).then(onOpen, (e) => toast.error(e.message))}>接入代理</Btn></div>
        </Field>
      </div>
      <div>
        {proc ? <><div className="row gap-s"><Badge tone={live?.status === 'running' ? 'ok' : 'bad'} dot>{live?.status || proc.status}</Badge><span className="mono small">{live?.url || '等待输出中的地址…'}</span></div><ProcOutput id={proc.id} height={380} /></> : <div className="muted small pad">进程输出会显示在这里。</div>}
      </div>
    </div>
  );
}

function UrlOpen({ onOpen }: { onOpen: (s: PreviewSession) => void }) {
  const [u, setU] = useState('https://');
  const [mode, setMode] = useState<'url' | 'proxy'>('proxy');
  const isLocal = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u);
  return (
    <div className="stack">
      <Field label="地址"><input className="mono" value={u} onChange={(e) => setU(e.target.value)} autoFocus /></Field>
      <label className="check"><input type="radio" checked={mode === 'proxy'} onChange={() => setMode('proxy')} /> 通过工作台代理（注入探针：控制台、报错、网络、执行 JS；适合本地开发服务器）</label>
      <label className="check"><input type="radio" checked={mode === 'url'} onChange={() => setMode('url')} /> 直接加载（不注入；外部网站可能禁止被嵌入，桌面版不受此限制）</label>
      {!isLocal && mode === 'proxy' && <p className="muted small">外部网站走代理时，部分站点的绝对地址资源和登录态可能不可用。</p>}
      <div><Btn tone="primary" onClick={() => void post<PreviewSession>('/api/preview', mode === 'proxy' ? { target: u } : { url: u }).then(onOpen, (e) => toast.error(e.message))}>打开</Btn></div>
    </div>
  );
}
