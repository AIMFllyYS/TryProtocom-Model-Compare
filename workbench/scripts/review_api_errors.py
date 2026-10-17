"""Evaluator-only HTTP error reproduction against archived grading copies."""
import json
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'skills/bench-grader/scripts'))
from benchlib.common import free_port, dump_json

DEST=ROOT/'reports/2026-10-03-official-unattended/reviews/T07-3.6-error-reproduction'
NODE=ROOT/'workbench/.runtime/benchmark-api-runtime/node-v22.23.3-win-x64/node.exe'

def fetch(url,data=None,headers=None):
    req=urllib.request.Request(url,data=data,headers=headers or {})
    try:
        with urllib.request.urlopen(req,timeout=5) as r:
            return {'status':r.status,'content_type':r.headers.get('content-type'),'body':r.read().decode('utf-8',errors='replace')[:1800]}
    except urllib.error.HTTPError as r:
        return {'status':r.code,'content_type':r.headers.get('content-type'),'body':r.read().decode('utf-8',errors='replace')[:1800]}

def main():
    global DEST
    ap=argparse.ArgumentParser();ap.add_argument('--campaign',choices=['3.6','3.1'],default='3.6');args=ap.parse_args()
    cases=[('T07-81800cd2','index.js','node'),('T07-293782db','src/index.js','node')]
    if args.campaign=='3.1':
        DEST=DEST.with_name('T07-3.1-error-reproduction')
        cases=[('T07-22cdffce','server.js','node'),('T07-71e2a312','start.py','python'),('T07-97d31ef1','start.py','python')]
    DEST.mkdir(exist_ok=True)
    results=[]
    for rid,entry,runtime in cases:
        port=free_port();base=f'http://127.0.0.1:{port}'
        cwd=ROOT/'bench-data/runs'/rid/'_grading/api_project'
        assert cwd.exists()
        env=dict(os.environ,PORT=str(port),DB_PATH=str(DEST/(rid+'.db')),BENCH_MODE='1',NODE_ENV='production')
        interpreter=NODE if runtime=='node' else ROOT/'bench-data/runs'/rid/'_grading/api-python311/Scripts/python.exe'
        with (DEST/(rid+'.server.log')).open('wb') as log:
            proc=subprocess.Popen([str(interpreter),entry],cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                until=time.monotonic()+15
                while True:
                    try:
                        if fetch(base+'/health')['status']==200:break
                        raise RuntimeError('Health check did not return 200')
                    except Exception:
                        if time.monotonic()>until:raise
                        time.sleep(.1)
                malformed=fetch(base+'/api/users',b'{',{'Content-Type':'application/json'})
                invalid_clock=fetch(base+'/api/availability?date=2026-10-08',headers={'X-Bench-Now':'not-a-time'})
                unknown_route=fetch(base+'/api/does-not-exist')
                results.append({'run_id':rid,'runtime':'Node 22.23.3' if runtime=='node' else 'Python 3.11.15','node_env':'production','malformed_json':malformed,'invalid_clock':invalid_clock,'unknown_route':unknown_route})
            finally:
                proc.terminate();proc.wait(timeout=10)
        dump_json(DEST/'result.json',results)
    print(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
