"""Evaluate model-supplied T08 regressions against seed and repaired snapshots, without changing either."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]

def assertion_digest(source):
    tree=ast.parse(source)
    assertions=[ast.dump(n,include_attributes=False) for n in ast.walk(tree) if isinstance(n,ast.Assert)]
    return hashlib.sha256('\n'.join(assertions).encode()).hexdigest()

FIXED_PORT=re.compile(r'^PORT\s*=\s*\d+\s*$',re.M)
FIXED_URL=re.compile(r'^BASE(?:_URL)?\s*=\s*["\']http://(?:127\.0\.0\.1|localhost):\d+["\']\s*$',re.M)

def fixed_transport_files(tests):
    return [f.name for f in tests.glob('*.py')
            if FIXED_PORT.search(f.read_text('utf-8')) or FIXED_URL.search(f.read_text('utf-8'))]

def normalize_transport(tests):
    """Adapt only copied test transport; retain all original assertions."""
    changes=[]
    for f in tests.glob('*.py'):
        original=f.read_text('utf-8');source=original;adaptations=[]
        source,n=FIXED_PORT.subn("PORT = int(__import__('os').environ['PORT'])",source)
        if n:adaptations.append('fixed port replaced by evaluator-assigned free port')
        def url_assignment(match):
            name=match.group(0).split('=',1)[0].strip()
            return name+" = __import__('os').environ['BASE_URL']"
        source,n=FIXED_URL.subn(url_assignment,source)
        if n:adaptations.append('fixed URL replaced by evaluator-assigned service URL')
        if f.name=='conftest.py' and 'def app_server():' in source and 'BENCH_AUDIT_EXTERNAL_SERVER' not in source:
            source=source.replace('def app_server():','def app_server():\n    if os.environ.get("BENCH_AUDIT_EXTERNAL_SERVER") == "1":\n        yield None\n        return',1)
            adaptations.append('provided duplicate server fixture bypassed; evaluator already owns the same app service')
        if source!=original:
            before=assertion_digest(original);after=assertion_digest(source)
            if before!=after:raise RuntimeError('Transport normalization changed test assertions')
            f.write_text(source,'utf-8')
            changes.append({'file':f.name,'adaptations':adaptations,'original_sha256':hashlib.sha256(original.encode()).hexdigest(),
                            'adapted_sha256':hashlib.sha256(source.encode()).hexdigest(),'assertion_digest_before':before,'assertion_digest_after':after})
    return changes

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--run-id',required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--normalize-transport',action='store_true');a=ap.parse_args()
    if not re.fullmatch(r'T08-[a-f0-9]{8}',a.run_id):raise ValueError('Expected T08 grader run ID')
    output=ROOT/'bench-data/runs'/a.run_id/'output/studyspot-legacy'
    interpreter=ROOT/'bench-data/runs'/a.run_id/'_grading/api-python311/Scripts/python.exe'
    if not interpreter.exists():raise RuntimeError('Prepare the target Python 3.11 environment before this audit')
    runtime_version=subprocess.run([str(interpreter),'--version'],capture_output=True,text=True,check=True,creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()
    seed=ROOT/'skills/bench-grader/tasks/T08-studyspot-fix/materials/studyspot-legacy'
    dest=a.out.resolve();dest.mkdir(parents=True,exist_ok=True);results=[]
    if (dest/'summary.json').exists():
        print('Existing audit retained; use a separate directory for a justified replay');return
    for label,source in [('before',seed),('after',output)]:
        ws=dest/label
        if not ws.exists():shutil.copytree(source,ws,ignore=shutil.ignore_patterns('__pycache__','.pytest_cache'))
        if label=='before':shutil.copytree(output/'tests',ws/'tests',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','.pytest_cache'))
        unsafe=fixed_transport_files(ws/'tests')
        if unsafe and not a.normalize_transport:
            raise RuntimeError('Fixed test transport would bypass audit isolation; inspect and use --normalize-transport: '+', '.join(unsafe))
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        adaptations=normalize_transport(ws/'tests') if a.normalize_transport else []
        env=os.environ.copy();env.update(PORT=str(port),DB_PATH=str(ws/'audit.sqlite'),BENCH_MODE='1',BASE_URL=f'http://127.0.0.1:{port}',PYTHONIOENCODING='utf-8',PYTHONDONTWRITEBYTECODE='1')
        env['PATH']=str(interpreter.parent)+os.pathsep+env.get('PATH','')
        if a.normalize_transport:env['BENCH_AUDIT_EXTERNAL_SERVER']='1'
        with (dest/(label+'.server.log')).open('wb') as log:
            proc=subprocess.Popen([str(interpreter),'app.py'],cwd=ws,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                deadline=time.monotonic()+15
                while True:
                    try:
                        with urllib.request.urlopen(env['BASE_URL']+'/health',timeout=.5) as response:response.read()
                        break
                    except Exception:
                        if time.monotonic()>deadline:raise TimeoutError('audit server did not become ready')
                        time.sleep(.1)
                p=subprocess.run([str(interpreter),'-m','pytest','-q','tests','--junitxml='+str(dest/(label+'.xml'))],cwd=ws,env=env,capture_output=True,text=True,encoding='utf-8',timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
                (dest/(label+'.log')).write_text(p.stdout+p.stderr,'utf-8')
                results.append(dict(label=label,exit_code=p.returncode,runtime_python=runtime_version,summary=p.stdout.splitlines()[-1] if p.stdout else '',log=str(dest/(label+'.log')),
                                    transport_normalized=a.normalize_transport,normalizations=adaptations,child_python_path_pinned=True))
            finally:
                proc.terminate()
                try:proc.wait(timeout=8)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
    (dest/'summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(results,ensure_ascii=False))

if __name__=='__main__':main()
