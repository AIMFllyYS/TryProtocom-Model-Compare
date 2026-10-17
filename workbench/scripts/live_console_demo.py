"""Actual isolated CLI task with readable, stream-safe terminal output. No benchmark enrollment."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import time
from overnight_preflight import commands, invocation, kill_tree

DISPLAY_LOG=None

def say(message):
    line=f'[{datetime.now().strftime("%H:%M:%S")}] {message}'
    print(line,flush=True)
    if DISPLAY_LOG:
        with DISPLAY_LOG.open('a',encoding='utf-8') as f:f.write(line+'\n')

def main():
    global DISPLAY_LOG
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--prepare-only',action='store_true');args=p.parse_args()
    dest=args.out.resolve();dest.mkdir(parents=True,exist_ok=True)
    display=dest/'display';display.mkdir(exist_ok=True);DISPLAY_LOG=display/'console.log';DISPLAY_LOG.write_text('','utf-8')
    (display/'status.json').write_text(json.dumps({'phase':'waiting' if args.prepare_only else 'running','model':'composer-2.5','formal_registered':False}),'utf-8')
    (display/'index.html').write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实时终端 · 准备试跑</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b1018;color:#d9e4f1;font:15px/1.7 ui-monospace,Consolas,monospace}header{padding:20px 28px;border-bottom:1px solid #283646;background:#101a27;display:flex;gap:22px;align-items:center;justify-content:space-between}b{font-size:20px;color:#86e4c9}.badge{color:#ffd286;background:#392e15;padding:5px 12px;border-radius:7px}section{padding:12px 28px;color:#8eabc6;border-bottom:1px solid #1f2c3c}pre{margin:0;padding:24px 28px;white-space:pre-wrap;overflow-wrap:anywhere;min-height:65vh}footer{padding:12px 28px;color:#8a9aaf;border-top:1px solid #283646}</style>
<header><b>MODEL COMPARE / 实时终端</b><span class="badge">准备试跑 · 正式队列关闭</span></header><section>Composer 2.5 · Cursor Agent CLI <span id="status">正在连接</span></section><pre id="console">等待实际 CLI 输出…</pre><footer>仅展示实际工具事件、公开回复与完成状态。每 750ms 刷新；无评分登记。</footer>
<script>let finished=false;async function update(){try{const [a,b]=await Promise.all([fetch('console.log',{cache:'no-store'}),fetch('status.json',{cache:'no-store'})]);const text=await a.text(),s=await b.json();document.getElementById('console').textContent=text;document.getElementById('status').textContent=s.phase==='completed'?' / 已完成':s.phase==='waiting'?' / 等待启动':' / 运行中';finished=s.phase==='completed';}catch(e){document.getElementById('status').textContent=' / 等待日志连接';}if(!finished)setTimeout(update,750)}update();</script></html>''','utf-8')
    if args.prepare_only:
        print(display,flush=True);return
    ws=dest/'workspace';ws.mkdir(exist_ok=True)
    subprocess.run(['git','init','-q',str(ws)],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    cmd=commands()['cursor'];mid='composer-2.5'
    prompt=('This is an isolated livestream display test, not a formal benchmark. Work only in the current directory. '
            'Create demo.py implementing average(values), returning the arithmetic mean and raising ValueError for an empty list. '
            'Create test_demo.py using unittest with normal, negative, single-item, and empty-list tests. '
            'Actually run python -m unittest -v. Write a short truthful Chinese completion summary to FINAL_MESSAGE.md, then reply with that same summary and finish. No dependencies or network research are needed.')
    pf=dest/'prompt.txt';pf.write_text(prompt,'utf-8')
    stdout=dest/'stdout.jsonl';stderr=dest/'stderr.log'
    say('LIVE DISPLAY REHEARSAL / PREPARATION ONLY')
    say(f'Model: {mid} | Harness: Cursor Agent CLI | Formal benchmark: OFF')
    say(f'Workspace: {ws}')
    say('Real task: create Python code, write four tests, execute tests, save completion file.')
    started=time.monotonic();types={};assistant_parts=[];tool_events=0
    with stdout.open('w',encoding='utf-8') as log,stderr.open('wb') as err:
        proc=subprocess.Popen(invocation('cursor',cmd,mid,prompt,pf,ws),cwd=ws,stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE,stderr=err,text=True,encoding='utf-8',errors='replace',
                              creationflags=subprocess.CREATE_NO_WINDOW)
        for line in proc.stdout:
            log.write(line);log.flush()
            try:e=json.loads(line)
            except ValueError:continue
            kind=e.get('type','unknown');types[kind]=types.get(kind,0)+1
            if kind=='system':say('CLI connected; session initialized.')
            elif kind=='assistant':
                for c in e.get('message',{}).get('content',[]):
                    if c.get('type')=='text' and c.get('text'):
                        assistant_parts.append(c['text']);say('Assistant: '+c['text'])
            elif kind=='tool_call':
                tool_events+=1
                # Tool labels/status are public; never dump startup config, headers or credentials.
                call=e.get('tool_call',{})
                label=next(iter(call),'tool') if isinstance(call,dict) else 'tool'
                say(f'Tool: {label} | status: {e.get("subtype","update")}')
            elif kind=='result':say('CLI result: '+str(e.get('result','')))
        proc.wait(timeout=30)
    final=ws/'FINAL_MESSAGE.md'
    result=dict(phase='preparation_only',model=mid,exit_code=proc.returncode,seconds=round(time.monotonic()-started,2),
                final_exists=final.exists(),code_exists=(ws/'demo.py').exists(),tests_exists=(ws/'test_demo.py').exists(),
                stream_event_counts=types,tool_events=tool_events,stdout=str(stdout),stderr=str(stderr),formal_registered=False)
    (dest/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
    say(f'Completion: code={result["code_exists"]}, tests={result["tests_exists"]}, FINAL_MESSAGE={result["final_exists"]}, CLI exit={proc.returncode}')
    say('DISPLAY REHEARSAL FINISHED. No formal benchmark run was created.')
    (display/'status.json').write_text(json.dumps({'phase':'completed','model':mid,'formal_registered':False,'exit_code':proc.returncode}),'utf-8')
    if proc.returncode:raise SystemExit(proc.returncode)

if __name__=='__main__':main()
