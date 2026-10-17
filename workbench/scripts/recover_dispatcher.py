"""Drain/recover the existing dispatcher and resume its journal; never duplicate model generations."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import psutil
import subprocess
import sys
import time
from overnight_runner import Dispatcher,ROOT,WB,wb,now,read_events,usage_from

def should_retry_orphaned_run(rec,model_process_live,has_final,grader_run_id):
    """Permit one clean official retry only for an orphaned, undelivered first-pass run."""
    try:retry_count=int(rec.get('interrupted_retry_count',0))
    except (TypeError,ValueError):retry_count=1
    return (rec.get('status')=='running' and not model_process_live and not has_final and
            not grader_run_id and retry_count<1)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--plan',type=Path,required=True);ap.add_argument('--old-pid',type=int,required=True);ap.add_argument('--old-created',type=float,required=True);args=ap.parse_args();q=args.plan.resolve().parent
    status=q/'recovery.json'
    def report(phase,**data):
        status.write_text(json.dumps(dict(phase=phase,at=now(),**data),ensure_ascii=False,indent=2),'utf-8')
        print(json.dumps(dict(phase=phase,**data),ensure_ascii=False),flush=True)
    report('waiting_for_existing_dispatcher',old_pid=args.old_pid)
    # STOP already requests drain. Let any in-flight model finish its original time limit.
    deadline=time.monotonic()+3*3600
    while time.monotonic()<deadline:
        try:
            p=psutil.Process(args.old_pid)
            if abs(p.create_time()-args.old_created)>.01:break
        except psutil.NoSuchProcess:break
        time.sleep(3)
    else:report('needs_attention',reason='Old dispatcher failed to drain in 3 hours');return
    d=Dispatcher(args.plan)
    for key,rec in list(d.state['runs'].items()):
        if not rec.get('workspace') or not rec.get('ref'):
            if rec.get('status') in ['waiting_resource','prepared']:
                report('recovery_skip_unmaterialized_slot',model_id=rec.get('model_id'),task=rec.get('task'),status=rec.get('status'))
                continue
            report('needs_attention',reason='Run record has no workspace/ref; preserved without regeneration',key=key,status=rec.get('status'))
            return
        m=next(m for m in d.plan['models'] if m['id']==rec['model_id'] and m['harness']==rec['harness'])
        ws=Path(rec['workspace']);meta_path=ws.parent/(ws.name+'.run.json');meta=json.loads(meta_path.read_text('utf-8'))
        pid=rec.get('pid')
        if pid:
            try:
                p=psutil.Process(pid)
                started=datetime.fromisoformat(rec['started_at']).timestamp()
                if abs(p.create_time()-started)<10 and p.cwd().lower()==str(ws).lower():
                    report('needs_attention',reason='Verified model process still active; not restarting',pid=pid,ref=rec['ref']);return
            except psutil.NoSuchProcess:pass
        rid=meta.get('grader_run_id')
        if rid:
            score_path=ROOT/'bench-data/runs'/rid/'score.json';metrics_path=score_path.with_name('metrics.json')
            if rec.get('status')=='graded' and score_path.exists() and metrics_path.exists():
                try:durable_score=json.loads(score_path.read_text('utf-8'))
                except (OSError,ValueError):durable_score={}
                if durable_score.get('items') is not None:continue
            d.patch(key,status='registering',error=None);d.finalize(m,key)
            if d.state['runs'][key]['status']=='graded':continue
            report('needs_attention',reason='Registered score/job not complete; retained',ref=rec['ref']);return
        final=ws/'FINAL_MESSAGE.md'
        if final.exists():
            ended=datetime.fromtimestamp(final.stat().st_mtime,timezone.utc).isoformat()
            usage=usage_from(read_events(Path(rec['stdout']))) if rec.get('stdout') and Path(rec['stdout']).exists() else {}
            usage['wall_min']=max(0,(datetime.fromisoformat(ended)-datetime.fromisoformat(rec['started_at'])).total_seconds()/60)
            finish=['run','finish',rec['ref'],'--final-file',str(final),'--at',ended,'--no-wait']
            for name,value in usage.items():finish+=['--'+name.replace('_','-'),str(value)]
            wb(*finish,mutation=True)
            job=wb('run','register',rec['ref'],'--no-wait',mutation=True)
            d.patch(key,status='registering',register_job=job['id'],error=None,usage=usage,
                    recovered_error=rec.get('error'),recovery_note='Existing delivered workspace recovered; no prompt reissued')
            d.finalize(m,key)
        elif rec.get('status')=='finished':
            report('needs_attention',reason='Finished without recoverable final response',ref=rec['ref']);return
        elif rec.get('status')=='running':
            # The dispatcher and its verified model PID are both gone, with no
            # FINAL_MESSAGE or Workbench grader id. Preserve the partial workspace
            # and allow exactly one fresh official Workbench run for this first-pass
            # condition. Never resume/reuse the interrupted workspace as a model
            # generation, and never loop a second interrupted retry.
            if not should_retry_orphaned_run(rec,False,False,None):
                d.patch(key,status='needs_attention',failure_class='infrastructure',
                        error='Orphaned running attempt lacks a final delivery or grader id; retry limit reached.',
                        retryable_environment_failure=False)
                report('needs_attention',reason='Orphaned run retry limit reached; original preserved',ref=rec.get('ref'))
                return
            retry_count=int(rec.get('interrupted_retry_count',0))+1
            history=list(rec.get('attempt_history',[]))
            history.append({k:rec.get(k) for k in ('ref','workspace','run_id','pid','started_at','ended_at',
                          'exit_code','error','failure_class','stdout','stderr','completion_file','stop_reason')})
            old_ref=rec.get('ref');old_workspace=rec.get('workspace')
            d.patch(key,status='needs_attention',failure_class='infrastructure',
                    error='Dispatcher/model process disappeared before FINAL_MESSAGE or grader registration; partial attempt preserved.',
                    attempt_history=history,interrupted_retry_count=retry_count,
                    interrupted_attempt_ref=old_ref,interrupted_attempt_workspace=old_workspace,
                    retryable_environment_failure=False)
            report('orphaned_attempt_preserved',ref=old_ref,workspace=old_workspace,
                   retry_count=retry_count,reason='No live verified model PID, FINAL_MESSAGE, or grader_run_id')
            d.patch(key,status='prepared',ref=None,workspace=None,run_id=None,score=None,pid=None,
                    stdout=None,stderr=None,started_at=None,ended_at=None,exit_code=None,
                    completion_file=None,model_final_captured=False,stop_reason=None,
                    register_job=None,error=None,failure_class=None,auth_status=None,
                    recovered_error='Orphaned attempt preserved; create a clean official retry workspace once',
                    interrupted_retry_count=retry_count,attempt_history=history)
            try:
                retried=d.create(m,rec['task'],int(rec.get('repetition',1)),key)
            except Exception as error:
                d.patch(key,status='needs_attention',error=str(error),failure_class='infrastructure')
                report('needs_attention',reason='Clean retry workspace creation failed; old attempt preserved',
                       old_ref=old_ref,error=str(error))
                return
            if retried.get('status')=='needs_attention':
                report('needs_attention',reason='Clean retry workspace preparation failed; old attempt preserved',
                       old_ref=old_ref,new_ref=retried.get('ref'),error=retried.get('preparation_error'))
                return
            d.patch(key,interrupted_retry_count=retry_count,interrupted_attempt_ref=old_ref,
                    interrupted_attempt_workspace=old_workspace,retry_reason='orphaned_attempt_without_delivery')
            report('clean_retry_created',old_ref=old_ref,new_ref=d.state['runs'][key].get('ref'),
                   retry_count=retry_count,workspace=d.state['runs'][key].get('workspace'))
        elif rec.get('status')=='needs_attention' and not rec.get('pid') and not (ws.parent/(ws.name+'.cli.stdout.jsonl')).exists():
            if rec.get('prelaunch_recovery_count',0)>=1 or any(p.name!='.git' for p in ws.iterdir()):
                report('needs_attention',reason='Pre-launch recovery already used or workspace not clean',ref=rec['ref']);return
            d.patch(key,status='prepared',recovered_error=rec.get('error'),error=None,prelaunch_recovery_count=1,
                    recovery_note='Initial workbench start failed before any CLI spawn; verified empty workspace and no stdout/PID; retry this original workspace once')
    d.state['status']='recovered';d.save()
    stop=q/'STOP'
    if stop.exists():stop.unlink()  # own reversible control marker, no benchmark data deletion
    with (q/'dispatcher.stdout.log').open('ab') as out,(q/'dispatcher.stderr.log').open('ab') as err:
        child=subprocess.Popen(['python','-u',str(ROOT/'workbench/scripts/overnight_runner.py'),'--plan',str(args.plan.resolve())],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=subprocess.CREATE_NO_WINDOW)
    child_created=psutil.Process(child.pid).create_time()
    report('resumed',dispatcher_pid=child.pid,created_at=child_created)
    # Keep the authoritative launch sidecar current so later heartbeats can
    # distinguish this recovered dispatcher from its stale predecessor.
    launch_path=q/'dispatcher-resume-launch.json'
    prior=json.loads(launch_path.read_text('utf-8')) if launch_path.exists() else {}
    history=list(prior.get('launch_history',[]))
    if prior:
        history.append({k:prior.get(k) for k in ('started_at','pid','executable','working_directory','arguments','stdout','stderr','plan','hidden_window','live_ui') if k in prior})
    plan_arg=args.plan.resolve().relative_to(ROOT).as_posix()
    launch={'started_at':datetime.fromtimestamp(child_created,timezone.utc).isoformat(),'pid':child.pid,
            'executable':sys.executable,'working_directory':str(ROOT),
            'arguments':['-u','workbench/scripts/overnight_runner.py','--plan',plan_arg],
            'stdout':str(q/'dispatcher.stdout.log'),'stderr':str(q/'dispatcher.stderr.log'),
            'plan':str(args.plan.resolve()),'hidden_window':True,'live_ui':bool(d.plan.get('live_ui'))}
    if history:launch['launch_history']=history
    temp=launch_path.with_suffix('.json.tmp');temp.write_text(json.dumps(launch,ensure_ascii=False,indent=2),'utf-8');temp.replace(launch_path)
    handoff=q/'handoff.json';h=json.loads(handoff.read_text('utf-8'));h['dispatcher_pid']=child.pid;h['dispatcher_created_at']=psutil.Process(child.pid).create_time();h['recovery']=str(status);handoff.write_text(json.dumps(h,ensure_ascii=False,indent=2),'utf-8')

if __name__=='__main__':main()
