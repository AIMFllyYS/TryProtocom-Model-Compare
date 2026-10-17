"""Bounded campaign-only timezone environment repair; never reissues model tasks."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time
import psutil

from overnight_runner import ROOT, wb, now, active_grader_for
sys.path.insert(0,str(ROOT/'skills/bench-grader/scripts'))
from benchlib.runs import grade_run
from benchlib.common import load_json, dump_json

QUEUE=ROOT/'reports/2026-10-03-official-unattended'
DEST=QUEUE/'reviews/api-timezone-regrade'

def manual_hash(rd):
    p=rd/'manual_scores.json'
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    path=DEST/'state.json'
    old=load_json(path,{})
    if old:
        print(json.dumps({'status':'existing_repair_retained','state':str(path)}));return
    campaign=load_json(QUEUE/'state.json')
    candidates=[]
    for row in campaign['runs'].values():
        rid=row.get('run_id')
        if not rid or row['task'] not in ['T07','T08']:continue
        rd=ROOT/'bench-data/runs'/rid
        log=rd/'_grading/server.log'
        values=(load_json(rd/'metrics.json',{}) or {}).get('values',{})
        if log.exists() and not values.get('api.started') and 'ZoneInfoNotFoundError' in log.read_text('utf-8',errors='replace'):
            candidates.append(rid)
    report={'started_at':now(),'status':'running','pid':os.getpid(),
            'created_at':psutil.Process().create_time(),'cwd':str(ROOT),
            'purpose':'Windows IANA timezone baseline repair; artifacts and manual scores unchanged',
            'tzdata_version':'2025.2','candidates':candidates,'runs':[]}
    dump_json(path,report)
    changed=[]
    for rid in candidates:
        rd=ROOT/'bench-data/runs'/rid
        jobs=wb('jobs')
        busy=any(j['kind']=='grade' and j['status'] in ['queued','running'] and rid in (j.get('subject') or {}).get('run_ids',[]) for j in jobs)
        if busy or active_grader_for(rid):
            report['runs'].append({'run_id':rid,'status':'existing_grader_active'});dump_json(path,report);continue
        backup=DEST/rid;backup.mkdir(exist_ok=True)
        for name in ['metrics.json','score.json','_grading/server.log','_grading/setup.log']:
            src=rd/name
            if src.exists():shutil.copyfile(src,backup/Path(name).name)
        before=manual_hash(rd)
        entry={'run_id':rid,'status':'grading','manual_sha_before':before,
               'total_before':load_json(rd/'score.json',{}).get('total')}
        report['runs'].append(entry);dump_json(path,report)
        try:
            score=grade_run(rd,only=['api'])
            after=manual_hash(rd)
            if before!=after:raise RuntimeError('Manual score changed during environment repair')
            values=load_json(rd/'metrics.json')['values']
            if not values.get('api.started'):raise RuntimeError('Service still failed to start; inspect preserved logs')
            entry.update(status='done',manual_sha_after=after,total_after=score['total'],
                         tests_passed=values.get('api.tests_passed'),
                         evaluator_packages=load_json(rd/'_grading/api-python311/evaluator-ready.json'))
            changed.append(rid)
        except Exception as error:entry.update(status='needs_attention',error=str(error))
        dump_json(path,report)
    if changed:
        report['store_sync_job']=wb('grade',*changed,'--skip-graded','--no-wait',mutation=True)['id']
    report.update(status='complete' if all(e['status']=='done' for e in report['runs']) else 'needs_attention',finished_at=now())
    dump_json(path,report)
    print(json.dumps({'status':report['status'],'state':str(path),'changed_runs':len(changed)}))

if __name__=='__main__':main()
