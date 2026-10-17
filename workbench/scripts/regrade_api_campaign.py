"""Repair API evaluator conditions for this campaign only, retaining manual scores."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time

from overnight_runner import ROOT, wb, now, active_grader_for
sys.path.insert(0,str(ROOT/'skills/bench-grader/scripts'))
from benchlib.runs import grade_run
from benchlib.common import load_json, dump_json

QUEUE=ROOT/'reports/2026-10-03-official-unattended'

def manual_hash(rd):
    p=rd/'manual_scores.json'
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None

def main():
    state=load_json(QUEUE/'state.json');ids=[r['run_id'] for r in state['runs'].values()
                                         if r['task'] in ['T07','T08'] and r.get('run_id')]
    report={'started_at':now(),'status':'running','runtime_manifest':'workbench/.runtime/benchmark-api-runtime/manifest.json','runs':[]}
    dest=QUEUE/'reviews/api-runtime-regrade';dest.mkdir(exist_ok=True)
    path=dest/'state.json';dump_json(path,report)
    changed=[]
    for rid in ids:
        rd=ROOT/'bench-data/runs'/rid
        metrics=load_json(rd/'metrics.json',{}) or {};values=metrics.get('values',{})
        if values.get('api.runtime_python')=='Python 3.11.15' and values.get('api.runtime_node')=='v22.23.3':
            report['runs'].append({'run_id':rid,'status':'already_target_runtime'});dump_json(path,report);continue
        deadline=time.monotonic()+1800
        while True:
            jobs=wb('jobs')
            busy=any(j['kind']=='grade' and j['status'] in ['queued','running'] and rid in (j.get('subject') or {}).get('run_ids',[]) for j in jobs)
            if not busy and not active_grader_for(rid):break
            if time.monotonic()>deadline:raise TimeoutError(f'Existing grade still active: {rid}')
            time.sleep(3)
        backup=dest/rid;backup.mkdir(exist_ok=True)
        for name in ['metrics.json','score.json','_grading/setup.log']:
            original=rd/name
            if original.exists():shutil.copyfile(original,backup/Path(name).name)
        before=manual_hash(rd);before_total=(load_json(rd/'score.json',{}) or {}).get('total')
        entry={'run_id':rid,'status':'grading','manual_sha_before':before,'total_before':before_total}
        report['runs'].append(entry);dump_json(path,report)
        try:
            score=grade_run(rd,only=['api'])
            after=manual_hash(rd)
            if before!=after:raise RuntimeError('Manual score changed while API probes were running; inspect concurrent reviewer')
            entry.update(status='done',total_after=score['total'],manual_sha_after=after)
            changed.append(rid)
        except Exception as error:
            entry.update(status='needs_attention',error=str(error))
        dump_json(path,report)
    if changed:
        job=wb('grade',*changed,'--skip-graded','--no-wait',mutation=True);report['store_sync_job']=job['id']
    report.update(status='complete' if all(r['status']!='needs_attention' for r in report['runs']) else 'needs_attention',finished_at=now())
    dump_json(path,report)
    print(json.dumps({'report':str(path),'status':report['status'],'changed_runs':len(changed)}))

if __name__=='__main__':main()
