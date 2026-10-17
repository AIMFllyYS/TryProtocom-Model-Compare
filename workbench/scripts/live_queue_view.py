"""Sanitized live console for a dispatcher. Displays public tool labels; never raw prompts/config/thinking."""
import argparse
from datetime import datetime
import json
import os
import re
from pathlib import Path
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无人值守 · 实时终端</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1018;color:#deebf5;font:15px/1.65 ui-monospace,Consolas,monospace}header{background:#122132;border-bottom:1px solid #35485a;padding:20px 28px;display:flex;justify-content:space-between;gap:20px}b{font-size:21px;color:#84e5c5}#phase{color:#ffda8d}#model{padding:12px 28px;color:#9fc0dc}pre{margin:0;padding:20px 28px;white-space:pre-wrap;overflow-wrap:anywhere}footer{padding:15px 28px;color:#8ba6be;border-top:1px solid #283e50}</style><header><b>MODEL COMPARE / 实时终端</b><span id="phase">正在连接</span></header><div id="model"></div><pre id="output">等待实际运行日志…</pre><footer>每 1 秒刷新 · 每次一个模型 · 同模型最多 3 题并发 · 可可靠判断的视觉项由用户授权AI代评 · 听感等项留给用户</footer><script>async function refresh(){try{let r=await fetch('console.json',{cache:'no-store'}),d=await r.json();document.getElementById('phase').textContent=d.phase;document.getElementById('model').textContent='当前模型：'+(d.model||'待发车')+' ｜ '+d.updated;document.getElementById('output').textContent=d.text}catch(e){document.getElementById('phase').textContent='等待连接'}setTimeout(refresh,1000)}refresh()</script></html>'''

PAGE = PAGE.replace("document.getElementById('phase').textContent=d.phase;",
                    "document.getElementById('phase').textContent=d.updated_epoch_ms && Date.now()-d.updated_epoch_ms>10000 ? '数据更新延迟 · 最新时间 '+d.updated : d.phase;")

def recent_event(log):
    try:
        with Path(log).open('rb') as f:
            f.seek(0,2);size=f.tell();f.seek(max(0,size-524288));lines=f.read().decode('utf-8',errors='replace').splitlines()
        events=[]
        for line in lines:
            try:e=json.loads(line)
            except ValueError:continue
            if isinstance(e,dict):events.append(e)
        names={e.get('toolCallId'):re.sub(r'[^A-Za-z0-9_.-]','',e.get('toolName',''))[:80]
               for e in events if e.get('type')=='tool_call' and isinstance(e.get('toolName'),str)}
        for e in reversed(events):
            s=e.get('step_update',{})
            if s.get('step_type')=='tool':return s.get('tool_name','tool')+' / '+s.get('state','')
            if e.get('type')=='tool_call_update':
                # Native Grok updates carry output/thought-adjacent payloads;
                # publish only the tool label and its status, never that payload.
                return (names.get(e.get('toolCallId')) or '工具输出')+' / '+(e.get('status') or '更新中')
            if e.get('type')=='tool_call':
                if e.get('toolName'):
                    return (names.get(e.get('toolCallId')) or 'tool')+' / '+(e.get('status') or '')
                call=e.get('tool_call',{});name=next(iter(call),'tool') if isinstance(call,dict) else 'tool'
                return name+' / '+e.get('subtype','')
            if e.get('event')=='result' or e.get('type') in ['result','end']:return 'CLI 返回结果'
        return '模型正在运行'
    except (OSError,ValueError):return '等待 CLI 日志'

def replace_snapshot(tmp, target):
    # Browser fetches can momentarily hold the target open without delete sharing
    # on Windows. Retry across fetch intervals instead of keeping stale data.
    for attempt in range(100):
        try:tmp.replace(target);return
        except PermissionError:
            if attempt==99:raise
            time.sleep(.03)

def main():
    p=argparse.ArgumentParser();p.add_argument('--queue',type=Path,required=True);p.add_argument('--serve',action='store_true');p.add_argument('--port',type=int,default=0);args=p.parse_args();q=args.queue.resolve()
    display=q/'display';display.mkdir(parents=True,exist_ok=True);(display/'index.html').write_text(PAGE,'utf-8')
    latest=b'{}';snapshot_lock=threading.Lock();server=None
    if args.serve:
        # Serve an immutable in-memory snapshot. A preview/file reader cannot
        # block publication of the next update by holding a Windows file handle.
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*unused):pass
            def do_GET(self):
                route=self.path.split('?',1)[0]
                if route in ['/','/index.html']:
                    content=PAGE.encode('utf-8');kind='text/html; charset=utf-8'
                elif route=='/console.json':
                    with snapshot_lock:content=latest
                    kind='application/json; charset=utf-8'
                else:self.send_error(404);return
                self.send_response(200);self.send_header('Content-Type',kind)
                self.send_header('Content-Length',str(len(content)));self.send_header('Cache-Control','no-store')
                self.end_headers();self.wfile.write(content)
        server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        runtime=dict(pid=os.getpid(),url=f'http://127.0.0.1:{server.server_port}/index.html',started_at=time.time())
        (display/'viewer-runtime.json').write_text(json.dumps(runtime,indent=2),'utf-8')
    while True:
        try:
            s=json.loads((q/'state.json').read_text('utf-8'));runs=s.get('runs',{})
            counts={}
            for r in runs.values():counts[r.get('status','unknown')]=counts.get(r.get('status','unknown'),0)+1
            text=['真实队列状态：'+s.get('status','waiting'),'阶段计数：'+json.dumps(counts,ensure_ascii=False),'']
            active=[r for r in runs.values() if r.get('status') in ['running','registering','grading']]
            for r in active:
                text.extend([r.get('ref',''), '  状态：'+r['status']+' ｜ PID：'+str(r.get('pid','—')),
                             '  最近公开事件：'+recent_event(r['stdout']) if r.get('stdout') else '  等待日志',''])
            events=[]
            if (q/'events.jsonl').exists():
                with (q/'events.jsonl').open('r',encoding='utf-8') as f:events=f.readlines()[-12:]
            text.append('最近队列事件')
            for line in events:
                e=json.loads(line);text.append(e.get('at','')+' '+e.get('event','')+' '+e.get('ref',e.get('model_id','')))
            payload=dict(phase='正式无人值守' if s.get('status')=='running' else s.get('status','等待发车'),model=s.get('active_model'),updated=datetime.now().strftime('%H:%M:%S'),updated_epoch_ms=int(time.time()*1000),text='\n'.join(text))
            encoded=json.dumps(payload,ensure_ascii=False).encode('utf-8')
            with snapshot_lock:latest=encoded
            tmp=display/'console.tmp';tmp.write_bytes(encoded)
            replace_snapshot(tmp,display/('console.latest.json' if args.serve else 'console.json'))
        except (OSError,ValueError):pass
        if (q/'STOP-VIEW').exists():break
        time.sleep(1)
    if server:server.shutdown();server.server_close()

if __name__=='__main__':main()
