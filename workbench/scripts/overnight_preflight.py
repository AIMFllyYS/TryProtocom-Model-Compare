"""Local CLI preflight. Stores model IDs and isolated smoke results, never credentials."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
CURSOR_DIR = Path(os.environ['LOCALAPPDATA']) / 'cursor-agent' / 'versions'

def cursor_command():
    versions = sorted((p for p in CURSOR_DIR.iterdir() if (p / 'node.exe').exists()), reverse=True)
    p = versions[0]
    return [str(p / 'node.exe'), str(p / 'index.js')]

def commands():
    return {'antigravity': [shutil.which('agy')], 'grok': [shutil.which('grok')],
            'cursor': cursor_command(), 'kimi': [shutil.which('kimi')]}

def capture(cmd, timeout=90):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       timeout=timeout, cwd=ROOT, creationflags=subprocess.CREATE_NO_WINDOW)
    if p.returncode:
        raise RuntimeError(f'{Path(cmd[0]).name} command exited {p.returncode}: {p.stderr[-800:]}')
    return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', p.stdout)

def discover(dest):
    cmds = commands()
    a = capture(cmds['antigravity'] + ['models'])
    g = capture(cmds['grok'] + ['models'])
    c = capture(cmds['cursor'] + ['models'])
    # Raw Kimi provider output includes secrets. Parse in memory and only retain model aliases.
    k = json.loads(capture(cmds['kimi'] + ['provider', 'list', '--json']))
    models = []
    for line in a.splitlines():
        mid = line.split('\t')[0].strip()
        if mid.startswith('gemini-') and mid.endswith('-high'):
            models.append(dict(harness='antigravity', id=mid, vendor='Google', name=mid, effort='high'))
    for mid in re.findall(r'^\s*[-*]\s+(grok-[\w.-]+)', g, re.M):
        models.append(dict(harness='grok', id=mid, vendor='xAI', name=mid))
    for mid in re.findall(r'^((?:composer|cursor-grok|grok)-[\w.-]+)\s+-', c, re.M):
        models.append(dict(harness='cursor', id=mid, vendor='Cursor', name=mid))
    for mid, cfg in k.get('models', {}).items():
        if cfg.get('provider') == 'managed:kimi-code':
            models.append(dict(harness='kimi', id=mid, vendor='Moonshot', name=mid.replace('/', '-')))
    result = dict(created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  commands=cmds, models=models, versions={h:capture(cmd+['--version']).strip() for h,cmd in cmds.items()})
    dest.mkdir(parents=True, exist_ok=True)
    (dest/'inventory.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(dict(inventory=str(dest/'inventory.json'), counts={h:sum(m['harness']==h for m in models) for h in cmds}),ensure_ascii=False),flush=True)
    return result

def invocation(harness, cmd, mid, prompt, prompt_file, workspace, task=None):
    if harness == 'antigravity':
        args = cmd + ['--model', mid, '--effort', 'high', '--dangerously-skip-permissions']
        # A must not discover skills. C and T04 rely on the explicitly provisioned
        # project-local fixed skill set, while their isolated USERPROFILE hides the
        # user's global skill directory.
        if task not in {'T03C', 'T04'}:
            args += ['--disable-slash-commands']
        return args + ['--output-format', 'stream-json', '--print', prompt]
    if harness == 'grok':
        return cmd + ['--cwd', str(workspace), '--model', mid, '--always-approve', '--no-subagents',
                      '--verbatim', '--output-format', 'streaming-json', '--prompt-file', str(prompt_file)]
    if harness == 'cursor':
        return cmd + ['--workspace', str(workspace), '--model', mid, '--trust', '--force',
                      '--print', '--output-format', 'stream-json', prompt]
    if harness == 'kimi':
        # Explicitly replace auto-discovered global skills for smoke tests / A-group runs.
        skills = workspace / 'skills'
        skills.mkdir(exist_ok=True)
        return cmd + ['--model', mid, '--skills-dir', str(skills), '--output-format', 'stream-json', '--prompt', prompt]
    raise ValueError(harness)

def kill_tree(proc):
    if proc.poll() is None:
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        proc.wait(timeout=20)

def smoke(dest, inventory, only=None):
    results=[]
    for h,cmd in inventory['commands'].items():
        if only and h != only: continue
        mid=next(m['id'] for m in inventory['models'] if m['harness']==h)
        ws=dest/'smoke'/h
        ws.mkdir(parents=True,exist_ok=True)
        subprocess.run(['git','init','-q',str(ws)],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        prompt='CLI readiness test. Work only in the current working directory. Use a file tool or shell to create SMOKE_OK.txt containing exactly BENCH_SMOKE_OK. Do not read other directories. Then reply exactly BENCH_SMOKE_OK and finish.'
        pf=ws.parent/(h+'.prompt.txt');pf.write_text(prompt,'utf-8')
        args=invocation(h,cmd,mid,prompt,pf,ws)
        started=time.time()
        print(json.dumps(dict(event='smoke_start',harness=h,model=mid,workspace=str(ws))),flush=True)
        with (ws.parent/(h+'.stdout.jsonl')).open('wb') as out, (ws.parent/(h+'.stderr.log')).open('wb') as err:
            proc=subprocess.Popen(args,cwd=ws,stdin=subprocess.DEVNULL,stdout=out,stderr=err,
                                  creationflags=subprocess.CREATE_NO_WINDOW)
            timed_out=False
            try: proc.wait(timeout=180)
            except subprocess.TimeoutExpired: timed_out=True;kill_tree(proc)
        f=ws/'SMOKE_OK.txt'
        result=dict(harness=h,model=mid,exit_code=proc.returncode,timed_out=timed_out,seconds=round(time.time()-started,2),
                    file_ok=f.exists() and f.read_text('utf-8').strip()=='BENCH_SMOKE_OK',stdout=str(ws.parent/(h+'.stdout.jsonl')),stderr=str(ws.parent/(h+'.stderr.log')))
        results.append(result)
        (dest/f'smoke-{h}.json').write_text(json.dumps(result,indent=2),'utf-8')
        print(json.dumps(result),flush=True)
    return results

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--smoke',action='store_true');ap.add_argument('--only')
    args=ap.parse_args();args.out=args.out.resolve()
    inv=discover(args.out) if not (args.out/'inventory.json').exists() else json.loads((args.out/'inventory.json').read_text('utf-8'))
    if args.smoke: smoke(args.out,inv,args.only)
