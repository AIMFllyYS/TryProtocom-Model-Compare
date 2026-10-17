"""Durable model-serial, task-parallel benchmark dispatcher; uses the existing wb CLI.

Human items are never scored here. Agent items are left for evidence-based review.
STOP file: drain active runs and launch nothing more. State files make every run auditable.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import urllib.request

from overnight_preflight import ROOT, invocation, kill_tree

HARNESS_NAMES = {'antigravity':'Antigravity CLI','grok':'Grok CLI','cursor':'Cursor Agent CLI','kimi':'Kimi Code CLI'}
WB=[ 'node', str(ROOT/'workbench/dist-node/wb.cjs') ]
MUTATION_LOCK=threading.Lock()

def file_hashes(root):
    root=Path(root)
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob('*')) if p.is_file()}

def provision_video_skills(workspace,harness,task):
    """Install only the frozen benchmark skill snapshot for C/T04, never global skills."""
    if task not in {'T03C','T04'}:return None
    source=ROOT/'workbench/.runtime/benchmark-video-skills'
    manifest=json.loads((source/'manifest.json').read_text('utf-8'))
    names=[row['skill'] for row in manifest['skills']]
    if harness=='grok':
        # Grok's isolated profile has an explicit, audited skills.paths entry.
        return {'mode':'isolated-profile-config','manifest':str(source/'manifest.json'),'skills':names}
    dest=Path(workspace)/('skills' if harness=='kimi' else '.agents/skills')
    dest.mkdir(parents=True,exist_ok=True)
    existing={p.name for p in dest.iterdir() if p.is_dir()}
    if existing and existing!=set(names):
        raise RuntimeError(f'Unexpected pre-existing skill set at {dest}: {sorted(existing)}')
    for name in names:
        src=source/name;target=dest/name
        expected=next(row['files'] for row in manifest['skills'] if row['skill']==name)
        if not src.is_dir() or sum(p.is_file() for p in src.rglob('*'))!=expected:
            raise RuntimeError(f'Frozen skill source does not match manifest: {name}')
        if not target.exists():shutil.copytree(src,target)
        if file_hashes(src)!=file_hashes(target):
            raise RuntimeError(f'Copied skill differs from frozen source: {name}')
    if {p.name for p in dest.iterdir() if p.is_dir()}!=set(names):
        raise RuntimeError(f'Installed skill directory is not the exact frozen set: {dest}')
    return {'mode':'workspace-explicit-skill-dir' if harness=='kimi' else 'workspace-local-agents-skills',
            'path':str(dest),'manifest':str(source/'manifest.json'),'skills':names}

def set_current_model(model):
    runtime=json.loads((ROOT/'workbench/.runtime/runtime.json').read_text('utf-8'))
    req=urllib.request.Request(runtime['url']+'/api/settings',data=json.dumps({'current_model':model}).encode(),
                              headers={'Content-Type':'application/json','x-wb-token':runtime['token']},method='POST')
    with urllib.request.urlopen(req,timeout=15) as response:json.load(response)

def now(): return datetime.now(timezone.utc).isoformat()

def active_grader_for(rid):
    import psutil
    target=(ROOT/'bench-data/runs'/rid).resolve()
    for process in psutil.process_iter(['name','cmdline']):
        args=process.info.get('cmdline') or []
        if not any(Path(arg).name=='bench.py' for arg in args):continue
        try:
            if Path(process.cwd()).resolve()==ROOT.resolve() and any(Path(arg).resolve()==target for arg in args):return True
        except (psutil.NoSuchProcess,psutil.AccessDenied,OSError):continue
    return False

def wb(*args, mutation=False):
    def call():
        p=subprocess.run(WB+list(args)+['--json'],cwd=ROOT,capture_output=True,text=True,
                         encoding='utf-8',errors='replace',timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
        if p.returncode:
            try:detail=json.loads(p.stdout).get('error')
            except (ValueError,AttributeError):detail=None
            raise RuntimeError(detail or p.stderr.strip()[-1600:] or f'wb exit {p.returncode}')
        return json.loads(p.stdout)
    if mutation:
        with MUTATION_LOCK: return call()
    return call()

def read_events(path):
    events=[]
    for line in path.read_text('utf-8',errors='replace').splitlines():
        try: events.append(json.loads(line))
        except ValueError: pass
    return events

def final_from(events):
    for e in reversed(events):
        if e.get('event')=='result':
            r=e.get('result',{})
            if isinstance(r,dict) and isinstance(r.get('response'),str): return r['response']
        if e.get('type')=='result' and isinstance(e.get('result'),str): return e['result']
        if e.get('type')=='assistant':
            texts=[c.get('text','') for c in e.get('message',{}).get('content',[]) if c.get('type')=='text']
            if texts: return '\n'.join(texts)
        if e.get('role')=='assistant' and isinstance(e.get('content'),str): return e['content']
    # Grok's native streaming-json emits text deltas, separated by usage/tool
    # events. Return the last visible assistant text segment, never thoughts.
    text=[];last=None
    for e in events:
        if e.get('type')=='text' and isinstance(e.get('data'),str):text.append(e['data'])
        elif e.get('type') in ['tool_call','thought','usage'] and text:
            last=''.join(text);text=[]
    return ''.join(text) if text else last
    return None

def usage_from(events):
    usage={}
    for e in reversed(events):
        terminal=e.get('type') in ['end','result'] or e.get('event')=='result'
        if not terminal: continue
        e=e.get('result',e) if isinstance(e.get('result'),dict) else e
        u=e.get('usage',{})
        for src,dst in [('inputTokens','input_tokens'),('input_tokens','input_tokens'),('outputTokens','output_tokens'),('output_tokens','output_tokens'),('cacheReadTokens','cache_read_tokens'),('cache_read_tokens','cache_read_tokens'),('cache_read_input_tokens','cache_read_tokens')]:
            if isinstance(u.get(src),(int,float)): usage[dst]=u[src]
        if isinstance(e.get('total_cost_usd'),(int,float)):usage['cost_usd']=e['total_cost_usd']
        if usage: break
    return usage

def cli_error_after_complete_delivery(workspace,returncode,terminal_errors):
    """Accept a trailing CLI/API error only when the formal delivery is already complete."""
    if returncode!=0 or not any(status and status!='SUCCESS' for status in terminal_errors):return False
    workspace=Path(workspace)
    final=workspace/'FINAL_MESSAGE.md'
    if not final.is_file() or final.stat().st_size==0:return False
    metadata_path=workspace.parent/(workspace.name+'.run.json')
    try:metadata=json.loads(metadata_path.read_text('utf-8'))
    except (OSError,ValueError):return False
    deliverable=metadata.get('deliverable_dir')
    return isinstance(deliverable,str) and bool(deliverable.strip()) and (workspace/deliverable).is_dir()

def already_registered(error,run_id):
    """Recognize only Workbench's explicit duplicate-register response for this exact run id."""
    message=str(error)
    return bool(run_id and '409' in message and run_id in message and
                ('已登记' in message or 'already registered' in message.lower()))

def wait_for_delivery(proc, workspace, timeout):
    """The benchmark completion file ends the run. Give stdout time to flush, then close CLI."""
    deadline=time.monotonic()+timeout
    final=workspace/'FINAL_MESSAGE.md';stamp=None;stable_since=None
    while proc.poll() is None:
        if final.exists() and final.stat().st_size:
            current=(final.stat().st_mtime_ns,final.stat().st_size)
            if current!=stamp:stamp=current;stable_since=time.monotonic()
            if time.monotonic()-stable_since>=30:
                kill_tree(proc);return 'completion_file'
        if time.monotonic()>=deadline:
            kill_tree(proc);return 'timeout'
        time.sleep(.5)
    return 'process_exit'

class Dispatcher:
    def __init__(self,plan_path):
        self.path=plan_path.resolve();self.plan=json.loads(self.path.read_text('utf-8'))
        self.dest=self.path.parent;self.state_path=self.dest/'state.json';self.lock=threading.Lock()
        self.heavy_lock=threading.Semaphore(1)
        self.inventory=json.loads(Path(self.plan['inventory']).read_text('utf-8'))
        readiness_path=self.dest/'deferred-environment-status.json'
        self.readiness=json.loads(readiness_path.read_text('utf-8')) if readiness_path.exists() else {}
        self.state=json.loads(self.state_path.read_text('utf-8')) if self.state_path.exists() else dict(created_at=now(),runs={},status='prepared')
    def save(self):
        self.state['updated_at']=now()
        tmp=self.state_path.with_suffix('.tmp');tmp.write_text(json.dumps(self.state,ensure_ascii=False,indent=2),'utf-8')
        # Windows readers (live viewer, UI, backup/AV) can briefly deny replacement
        # while holding a handle. Retry the same snapshot rather than fail a model run.
        for attempt in range(40):
            try:tmp.replace(self.state_path);return
            except PermissionError:
                if attempt==39:raise
                # Brief Windows sharing/AV locks can last longer than the
                # previous 3s retry window. Stay bounded, but do not tear down
                # an otherwise healthy model run because its state snapshot is
                # momentarily held by the viewer or filesystem scanner.
                time.sleep(.25)
    def event(self,event,**data):
        row=dict(at=now(),event=event,**data)
        with self.lock:
            with (self.dest/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(json.dumps(row,ensure_ascii=False),flush=True)
    def patch(self,key,**data):
        with self.lock:
            self.state['runs'].setdefault(key,{}).update(data);self.save()
    def task_readiness(self,m,task):
        harness_state=self.readiness.get('harness_readiness',{}).get(m['harness'],{})
        if harness_state.get('model_api_ready') is False:
            failure=harness_state.get('authentication_failure',{})
            return False,failure.get('status') or harness_state.get('auth_hold_reason') or 'Harness model authentication is held'
        if task not in {'T03A','T03C','T04'}:return True,''
        entry=(harness_state.get(task) or {})
        if not entry.get('ready'):
            return False,entry.get('reason') or f'{m["harness"]} has no verified {task} skill isolation profile'
        gate=self.readiness.get('memory_aware_video_admission',{})
        minimum=int(gate.get('minimum_available_memory_bytes',0))
        if minimum:
            try:
                import psutil
                available=int(psutil.virtual_memory().available)
            except Exception as error:
                return False,f'Unable to verify available memory before video task: {error}'
            if available<minimum:
                return False,f'Video admission waits for {minimum} available bytes; current {available}'
        return True,''
    def hold_harness_auth(self,m,key,detail):
        h=m['harness'];failed_at=now();cooldown_until=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()
        harness_state=self.readiness.setdefault('harness_readiness',{}).setdefault(h,{})
        failure={'status':'UNAUTHENTICATED_401','ref':self.state['runs'][key].get('ref'),
                 'failed_at':failed_at,'retry_after':cooldown_until,'retryable_environment_failure':True,
                 'revalidated_after_failure':False,'user_action_required':True,'detail':detail}
        harness_state['model_api_ready']=False;harness_state['authentication_failure']=failure
        for task in ('T03A','T03C','T04'):
            entry=harness_state.setdefault(task,{})
            entry['ready']=False;entry['reason']='Harness authentication returned UNAUTHENTICATED 401; wait for explicit account revalidation.'
        readiness_path=self.dest/'deferred-environment-status.json';tmp=readiness_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.readiness,ensure_ascii=False,indent=2),'utf-8');tmp.replace(readiness_path)
        self.state['model_auth_hold']={'harness':h,'model_id':m['id'],'status':'UNAUTHENTICATED_401','failed_at':failed_at,
                                      'retry_after':cooldown_until,'user_action_required':True}
        self.save();self.event('harness_auth_hold',harness=h,model_id=m['id'],task=self.state['runs'][key].get('task'),
                               ref=self.state['runs'][key].get('ref'),status='UNAUTHENTICATED_401',retry_after=cooldown_until)
    def run_environment(self,m,task):
        env=os.environ.copy()
        entry=self.readiness.get('harness_readiness',{}).get(m['harness'],{}).get(task,{})
        profile=entry.get('user_profile')
        if profile:
            env['USERPROFILE']=str(profile);env['HOME']=str(profile)
            profile=Path(profile)
            if m['harness']=='antigravity':
                global_roots=[profile/'.gemini/antigravity-cli/skills',profile/'.gemini/config/skills',
                              profile/'.gemini/antigravity/skills',profile/'.agents/skills',profile/'.cursor/skills',
                              profile/'.claude/skills',profile/'.codex/skills',profile/'.grok/skills']
                for root in global_roots:
                    if root.exists() and any(root.rglob('SKILL.md')):
                        raise RuntimeError(f'Isolated Antigravity profile unexpectedly exposes global skills: {root}')
                plugin_roots=[profile/'.gemini/antigravity-cli/plugins',profile/'.cursor/plugins']
                for plugins in plugin_roots:
                    if plugins.exists() and any(plugins.rglob('SKILL.md')):
                        raise RuntimeError(f'Isolated Antigravity profile unexpectedly contains plugin skills: {plugins}')
            elif m['harness']=='cursor':
                roots=[profile/'.cursor/skills',profile/'.cursor/skills-cursor',profile/'.claude/skills',
                       profile/'.codex/skills',profile/'.grok/skills',profile/'.agents/skills']
                for root in roots:
                    if root.exists() and any(root.rglob('SKILL.md')):
                        raise RuntimeError(f'Isolated Cursor profile unexpectedly exposes user skills: {root}')
                plugins=profile/'.cursor/plugins'
                if plugins.exists() and any(plugins.rglob('SKILL.md')):
                    raise RuntimeError(f'Isolated Cursor profile unexpectedly contains plugin skills: {plugins}')
        grok_home=entry.get('grok_home')
        if grok_home:env['GROK_HOME']=str(grok_home)
        return env
    def job_wait(self,jid):
        deadline=time.monotonic()+1800
        while time.monotonic()<deadline:
            job=wb('job',jid)
            if job['status'] in ['done','failed','cancelled']:
                if job['status']!='done':raise RuntimeError(f'Job {jid}: {job["status"]}')
                return job
            time.sleep(3)
        raise TimeoutError(f'Job {jid} still pending after 30 min')
    def stop_incomplete_workbench_run(self,ref,workspace,reason):
        """Move only an unfinished, unregistered attempt to recoverable trash.

        A CLI exception must not leave a dead Workbench run showing as running.
        Runs with a final message, an end timestamp, or a grader id remain in the
        workbench so a valid delivery can be recovered instead of discarded.
        """
        if not ref or not workspace:return False
        workspace=Path(workspace)
        metadata=workspace.parent/(workspace.name+'.run.json')
        if not metadata.exists():return False
        try:record=json.loads(metadata.read_text('utf-8'))
        except (OSError,ValueError):return False
        if record.get('ended_at') or record.get('grader_run_id'):
            return False
        if (workspace/'FINAL_MESSAGE.md').is_file():
            return False
        wb('run','stop',ref,'--reason',str(reason)[:800],mutation=True)
        return True
    def valid_formal_sample(self,m,task):
        base=ROOT/'model'/m['vendor']/m['name']/task
        if not base.is_dir():return None
        candidates=[]
        for meta_path in base.glob('r*.run.json'):
            try:meta=json.loads(meta_path.read_text('utf-8'))
            except (OSError,ValueError):continue
            rid=meta.get('grader_run_id')
            if not rid or meta.get('discarded'):continue
            run_dir=meta_path.with_name(meta_path.name[:-len('.run.json')])
            if not run_dir.is_dir():continue
            if not meta.get('deliverable_dir'):continue
            deliverable=run_dir/meta['deliverable_dir']
            if not deliverable.is_dir():continue
            grader_dir=ROOT/'bench-data/runs'/rid
            if not grader_dir.is_dir():continue
            try:index=int(meta.get('index') or run_dir.name[1:])
            except (TypeError,ValueError):continue
            candidates.append((index,meta,run_dir,rid))
        if not candidates:return None
        index,meta,run_dir,rid=min(candidates,key=lambda row:row[0])
        score_path=ROOT/'bench-data/runs'/rid/'score.json'
        score=json.loads(score_path.read_text('utf-8')) if score_path.exists() else {}
        return {'ref':meta.get('ref'),'workspace':str(run_dir),'model_id':m['id'],'harness':m['harness'],
                'task':task,'repetition':1,'run_id':rid,'score':score.get('total'),
                'status':'graded' if score.get('items') is not None else 'registered',
                'reused_existing_formal':True,'existing_index':index}
    def seed_first_pass_samples(self,m):
        for task in self.plan['tasks']:
            key=f'{m["harness"]}:{m["id"]}:{task}:1'
            rec=self.state['runs'].get(key)
            existing=self.valid_formal_sample(m,task)
            if not existing:
                if rec and rec.get('retryable_environment_failure') and int(rec.get('environment_retry_count',0))<1:
                    harness_state=self.readiness.get('harness_readiness',{}).get(m['harness'],{})
                    auth=harness_state.get('authentication_failure',{})
                    cooldown=rec.get('retry_after') or auth.get('retry_after')
                    cooldown_passed=True
                    if cooldown:
                        try:cooldown_passed=datetime.fromisoformat(cooldown.replace('Z','+00:00'))<=datetime.now(timezone.utc)
                        except ValueError:cooldown_passed=False
                    if harness_state.get('model_api_ready') and auth.get('revalidated_after_failure') and cooldown_passed:
                        history=list(rec.get('attempt_history',[]));history.append({k:rec.get(k) for k in ('ref','workspace','run_id','failure_class','auth_status','error','ended_at','stop_reason')})
                        self.patch(key,status='waiting_resource',ref=None,workspace=None,run_id=None,score=None,pid=None,
                                   stdout=None,stderr=None,started_at=None,ended_at=None,completion_file=None,
                                   model_final_captured=False,stop_reason=None,error=None,failure_class=None,auth_status=None,
                                   attempt_history=history,environment_retry_count=int(rec.get('environment_retry_count',0))+1,
                                   auth_revalidated=True)
                        self.event('first_pass_auth_retry_armed',model_id=m['id'],task=task,retry_count=1,
                                   preserved_attempts=len(history))
                continue
            if rec and rec.get('status') in ['running','registering','grading','finished']:
                continue
            if not rec or rec.get('ref')!=existing.get('ref') or rec.get('status') not in ['graded','registered']:
                with self.lock:
                    self.state['runs'][key]=existing;self.save()
                self.event('existing_formal_sample_reused',ref=existing['ref'],run_id=existing['run_id'],model_id=m['id'],task=task,index=existing['existing_index'])
    def reconcile_registered_state(self):
        for key,rec in list(self.state['runs'].items()):
            if rec.get('status') not in ['registering','grading','finished'] or not rec.get('workspace'):continue
            metadata=Path(rec['workspace']).parent/(Path(rec['workspace']).name+'.run.json')
            rid=rec.get('run_id')
            if metadata.exists():
                try:rid=rid or json.loads(metadata.read_text('utf-8')).get('grader_run_id')
                except (OSError,ValueError):pass
            if not rid:continue
            score_path=ROOT/'bench-data/runs'/rid/'score.json';metrics_path=score_path.with_name('metrics.json')
            if not score_path.exists() or not metrics_path.exists():continue
            try:score=json.loads(score_path.read_text('utf-8'))
            except (OSError,ValueError):continue
            if score.get('items') is None:continue
            self.patch(key,status='graded',run_id=rid,score=score.get('total'),
                       agent_review='pending',human_review='user_only',reconciled_existing_grade=True)
            self.event('existing_registered_sample_reconciled',ref=rec.get('ref'),run_id=rid,score=score.get('total'))
    def prepare_t06_wait(self,m,rep,key):
        rec=self.state['runs'].get(key)
        if not rec or not rec.get('ref'):
            rec=self.create(m,'T06',rep,key)
        self.patch(key,status='awaiting_interaction',interaction='deferred_unattended',
                   interaction_note='Prepared with original prompt; no model message answered while unattended')
        self.event('run_awaiting_interaction',ref=rec.get('ref'),model_id=m['id'],task='T06')
    def create(self,m,task,rep,key):
        harness=HARNESS_NAMES[m['harness']]
        created=wb('run','new',m['vendor']+'/'+m['name'],task,'--harness',harness,mutation=True)
        run=created['run'];ws=Path(created['workspace'])
        self.patch(key,status='prepared',ref=run['ref'],workspace=str(ws),model_id=m['id'],harness=m['harness'],task=task,repetition=rep)
        try:
            isolation=provision_video_skills(ws,m['harness'],task)
            if task=='T03A' and m['harness'] in {'antigravity','cursor'}:
                project_skills=ws/'.agents/skills'
                if project_skills.exists() and any(project_skills.iterdir()):
                    raise RuntimeError(f'T03A workspace unexpectedly contains project skills: {project_skills}')
            self.patch(key,isolation=isolation,os_sandbox=False)
        except Exception as error:
            self.patch(key,status='needs_attention',preparation_error=str(error))
            self.event('run_preparation_error',ref=run['ref'],error=str(error))
            return self.state['runs'][key]
        if created.get('warnings'):self.event('workspace_warnings',ref=run['ref'],warnings=created['warnings'])
        return self.state['runs'][key]
    def execute(self,m,key):
        rec=self.state['runs'][key];ref=rec['ref'];ws=Path(rec['workspace']);h=m['harness']
        out_path=ws.parent/(ws.name+'.cli.stdout.jsonl');err_path=ws.parent/(ws.name+'.cli.stderr.log')
        proc=None
        try:
            prompt_file=ws.parent/(ws.name+'.prompt.md');prompt=prompt_file.read_text('utf-8')
            if '{TTS_COMMAND}' in prompt:raise RuntimeError('Unresolved TTS_COMMAND')
            start=wb('run','start',ref,mutation=True)['started_at'];started=time.monotonic()
            args=invocation(h,self.inventory['commands'][h],m['id'],prompt,prompt_file,ws,task=rec['task'])
            with out_path.open('wb') as out,err_path.open('wb') as err:
                env=self.run_environment(m,rec['task'])
                proc=subprocess.Popen(args,cwd=ws,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=subprocess.CREATE_NO_WINDOW)
                self.patch(key,status='running',pid=proc.pid,started_at=start,stdout=str(out_path),stderr=str(err_path),harness_version=self.inventory['versions'][h],isolated_userprofile=env.get('USERPROFILE') if env.get('USERPROFILE')!=os.environ.get('USERPROFILE') else None)
                self.event('run_start',ref=ref,pid=proc.pid,model_id=m['id'],task=rec['task'],
                           isolated_userprofile=env.get('USERPROFILE') if env.get('USERPROFILE')!=os.environ.get('USERPROFILE') else None,
                           os_sandbox=False)
                timeout=self.plan['time_limits'][rec['task']]*60
                stop_reason=wait_for_delivery(proc,ws,timeout)
                timed_out=stop_reason=='timeout'
            events=read_events(out_path);usage=usage_from(events)
            final_file=ws/'FINAL_MESSAGE.md'
            terminal_errors=[e.get('result',{}).get('status') for e in events if e.get('event')=='result' and isinstance(e.get('result'),dict)]
            completion_warning=None
            terminal_failure=proc.returncode or any(s and s!='SUCCESS' for s in terminal_errors)
            if stop_reason=='process_exit' and terminal_failure:
                if not cli_error_after_complete_delivery(ws,proc.returncode,terminal_errors):
                    raise RuntimeError(f'CLI_INFRASTRUCTURE_FAILURE exit={proc.returncode}; inspect {err_path} and {out_path} before any retry or scoring')
                completion_warning=f'CLI exited 0 after terminal status {terminal_errors}, but FINAL_MESSAGE.md and the registered deliverable directory were present; preserving this formal sample.'
                self.event('cli_error_after_complete_delivery',ref=ref,exit_code=proc.returncode,terminal_statuses=terminal_errors,deliverable_verified=True)
            finish=['run','finish',ref,'--no-wait']
            # Preserve the model's real response even when it forgot its completion file.
            final=final_from(events)
            if final_file.exists():
                ended=datetime.fromtimestamp(final_file.stat().st_mtime,timezone.utc).isoformat()
                finish+=['--at',ended,'--final-file',str(final_file)]
            else:
                ended=now()
                if final:
                    captured=ws.parent/(ws.name+'.cli.final.md');captured.write_text(final,'utf-8')
                    finish+=['--final-file',str(captured)]
            usage['wall_min']=max(0,(datetime.fromisoformat(ended)-datetime.fromisoformat(start)).total_seconds()/60)
            for k,v in usage.items():finish+=['--'+k.replace('_','-'),str(v)]
            if timed_out:finish+=['--timed-out']
            finished=wb(*finish,mutation=True)
            self.patch(key,status='finished',ended_at=ended,exit_code=proc.returncode,timed_out=timed_out,
                       usage=usage,completion_file=final_file.exists(),model_final_captured=bool(final),stop_reason=stop_reason,completion_warning=completion_warning,process_seconds=round(time.monotonic()-started,2))
            # A zero CLI exit without output is not completion. Preserve such failures outside the board.
            if not finished['run']['detect']['dir_exists']:
                raise RuntimeError('Model ended without the required deliverable directory; retained for diagnosis, not silently omitted')
            try:
                job=wb('run','register',ref,'--no-wait',mutation=True)
            except Exception as register_error:
                # Workbench may auto-register a run while finishing it. In that case
                # the explicit register call returns 409, but run.json is the durable
                # source of the already-created grader id. Reconcile it; never clear
                # or recreate the existing registration.
                metadata=ws.parent/(ws.name+'.run.json')
                registered_id=json.loads(metadata.read_text('utf-8')).get('grader_run_id') if metadata.exists() else None
                if not already_registered(register_error,registered_id):raise
                self.patch(key,status='registering',register_job=None,run_id=registered_id,
                           registration_reconciled=True,registration_warning=str(register_error))
                self.event('run_registration_reconciled',ref=ref,run_id=registered_id)
            else:
                self.patch(key,status='registering',register_job=job['id'])
                # Release the inference slot immediately. Grading is drained separately after dispatch.
                self.event('run_submitted_for_grading',ref=ref,job_id=job['id'])
        except Exception as e:
            error_text=str(e)
            stderr_text=err_path.read_text('utf-8',errors='replace') if err_path.exists() else ''
            auth_failure='UNAUTHENTICATED' in (error_text+'\n'+stderr_text).upper() or 'HTTP 401' in (error_text+'\n'+stderr_text).upper()
            if proc is not None and proc.poll() is None:
                try:kill_tree(proc)
                except Exception:pass
            workbench_stopped=False;cleanup_error=None
            try:
                workbench_stopped=self.stop_incomplete_workbench_run(ref,ws,error_text)
            except Exception as stop_error:
                cleanup_error=str(stop_error)
            self.patch(key,status='needs_attention',error=error_text,
                       failure_class='authentication' if auth_failure else 'infrastructure',
                       auth_status='UNAUTHENTICATED_401' if auth_failure else None,
                       retryable_environment_failure=auth_failure,environment_retry_count=0 if auth_failure else None,
                       auth_revalidated=False if auth_failure else None,
                       workbench_stopped_recoverable=workbench_stopped,
                       workbench_stop_error=cleanup_error)
            if auth_failure:self.hold_harness_auth(m,key,'UNAUTHENTICATED_401 from model API; require credential revalidation before any clean first-pass retry.')
            self.event('run_error',ref=ref,error=error_text,
                       workbench_stopped_recoverable=workbench_stopped,
                       workbench_stop_error=cleanup_error)
    def finalize(self,m,key):
        rec=self.state['runs'].get(key)
        if not rec or rec.get('status')!='registering':return
        if not rec.get('ref') or not rec.get('workspace'):
            self.patch(key,status='needs_attention',error='Registration state is missing a workspace reference',failure_class='infrastructure')
            self.event('run_finalize_missing_workspace',key=key)
            return
        ref=rec['ref']
        workspace=Path(rec.get('workspace') or '.')
        err_path=Path(rec['stderr']) if rec.get('stderr') else workspace.parent/(workspace.name+'.cli.stderr.log')
        try:
            # The job list is bounded. Completed registration jobs may have been
            # evicted before model generation drains; durable run metadata survives.
            metadata=Path(rec['workspace']).parent/(Path(rec['workspace']).name+'.run.json')
            rid=json.loads(metadata.read_text('utf-8')).get('grader_run_id') if metadata.exists() else None
            if not rid:
                register_job=self.job_wait(rec['register_job'])
                rid=(register_job.get('result') or {}).get('run_id')
            if not rid:raise RuntimeError('Register succeeded without grader_run_id')
            self.patch(key,status='grading',run_id=rid)
            deadline=time.monotonic()+1800
            while time.monotonic()<deadline:
                jobs=wb('jobs')
                related=[j for j in jobs if (j.get('subject') or {}).get('run_ids')==[rid] and j.get('kind')=='grade']
                # A registration snapshot can create a zero-valued placeholder
                # score before probes finish. Prefer the latest grading job.
                latest=related[0] if related else None
                score_path=ROOT/'bench-data/runs'/rid/'score.json'
                metrics_path=score_path.with_name('metrics.json')
                if latest and latest['status'] in ['failed','cancelled']:
                    grade_error=str(latest.get('error') or '')
                    # The grader writes score.json and metrics.json before its
                    # final bridge-snapshot notification. A failure confined to
                    # that post-write notification must not erase a durable score
                    # or cause a model rerun. Keep the warning and incomplete
                    # review state visible while reconciling the registered run.
                    if ('bridge snapshot' in grade_error.lower() and
                        ('no output' in grade_error.lower() or '无输出' in grade_error) and
                        score_path.exists() and metrics_path.exists()):
                        score=json.loads(score_path.read_text('utf-8'))
                        if score.get('items') is not None:
                            self.patch(key,status='graded',run_id=rid,score=score.get('total'),
                                       score_complete=score.get('complete'),grade_warning=grade_error,
                                       grade_job_status=latest.get('status'),agent_review='pending',human_review='user_only')
                            self.event('run_graded_reconciled_after_bridge_snapshot_error',ref=ref,run_id=rid,
                                       total=score.get('total'),complete=score.get('complete'),warning=grade_error)
                            return
                    raise RuntimeError(f'Grading job failed for {rid}')
                active=latest and latest['status'] in ['queued','running']
                registering=any(j['kind']=='register' and j['status'] in ['queued','running'] and
                                ref in (j.get('subject') or {}).get('refs',[]) for j in jobs)
                if not latest and not registering and not metrics_path.exists() and not active_grader_for(rid):
                    if rec.get('grade_recovery_count',0)>=1:raise RuntimeError(f'Lost grading job for {rid} after bounded recovery')
                    recovered=wb('grade',rid,'--no-wait',mutation=True)
                    self.patch(key,grade_recovery_count=1,recovered_grade_job=recovered['id'])
                    self.event('grade_recovered_after_job_loss',ref=ref,run_id=rid,job_id=recovered['id'])
                    time.sleep(3);continue
                if not active and score_path.exists() and metrics_path.exists():
                    score=json.loads(score_path.read_text('utf-8'))
                    if score.get('items') is not None:
                        self.patch(key,status='graded',score=score.get('total'),agent_review='pending',human_review='user_only')
                        self.event('run_graded',ref=ref,run_id=rid,total=score.get('total'));return
                time.sleep(3)
            raise TimeoutError(f'Grading still pending for {rid}')
        except Exception as e:
            error_text=str(e)
            stderr_text=err_path.read_text('utf-8',errors='replace') if err_path.exists() else ''
            failure_text=(error_text+'\n'+stderr_text).upper()
            auth_failure='UNAUTHENTICATED' in failure_text or 'HTTP 401' in failure_text or 'ERROR_CODE":401' in failure_text
            self.patch(key,status='needs_attention',error=error_text,
                       failure_class='authentication' if auth_failure else 'infrastructure',
                       auth_status='UNAUTHENTICATED_401' if auth_failure else None,
                       retryable_environment_failure=auth_failure,environment_retry_count=0 if auth_failure else None,
                       auth_revalidated=False if auth_failure else None)
            if auth_failure:self.hold_harness_auth(m,key,'UNAUTHENTICATED_401 from model API; revalidate the existing account before a clean first-pass retry.')
            self.event('run_error',ref=ref,error=error_text)
    def execute_guarded(self,m,key):
        # Specialized video tasks share one admission slot. Their environment
        # readiness guard below remains separate and must still be satisfied.
        task=self.state['runs'][key]['task']
        model=next(m for m in self.plan['models'] if m['id']==self.state['runs'][key]['model_id'] and m['harness']==self.state['runs'][key]['harness'])
        ready,reason=self.task_readiness(model,task)
        if not ready:
            self.patch(key,status='waiting_resource',wait_reason=reason)
            self.event('run_waiting_resource',ref=self.state['runs'][key].get('ref'),reason=reason)
            return
        if task in {'T02','T03A','T03C','T04'} or task in self.plan.get('serialized_tasks',[]):
            self.patch(key,status='waiting_resource')
            with self.heavy_lock:
                ready,reason=self.task_readiness(model,task)
                if not ready:
                    self.patch(key,status='waiting_resource',wait_reason=reason)
                    self.event('run_waiting_resource',ref=self.state['runs'][key].get('ref'),reason=reason)
                    return
                gate=self.readiness.get('memory_aware_video_admission',{})
                minimum=int(gate.get('minimum_available_memory_bytes',0))
                if minimum:
                    try:
                        import psutil
                        available=int(psutil.virtual_memory().available)
                    except Exception as error:
                        self.patch(key,status='waiting_resource',wait_reason=f'Unable to verify available memory: {error}')
                        self.event('run_waiting_resource',ref=self.state['runs'][key].get('ref'),reason='memory_check_unavailable')
                        return
                    if available<minimum:
                        self.patch(key,status='waiting_resource',wait_reason=f'Available memory {available} is below admission threshold {minimum}')
                        self.event('run_waiting_resource',ref=self.state['runs'][key].get('ref'),available_memory_bytes=available,minimum_available_memory_bytes=minimum)
                        return
                self.execute(m,key)
        else:self.execute(m,key)
    def run(self):
        concurrency=int(self.plan.get('concurrency',3))
        if concurrency<1 or concurrency>3:raise ValueError('Concurrency must be 1..3')
        supported={'T01','T02','T03A','T03C','T04','T05','T06','T07','T08'}
        if set(self.plan['tasks'])-supported:raise ValueError('Plan contains an unknown benchmark task condition')
        if int(self.plan.get('repetitions',1))!=1:
            raise ValueError('This dispatcher only permits first-pass single-sample coverage; do not increase repetitions before the candidate sweep completes')
        self.reconcile_registered_state()
        if self.state.get('status')=='resumption_pending_readiness':
            pending=self.state.get('waiting_resource',[])
            model_map={(m['harness'],m['id']):m for m in self.plan['models']}
            now_ready=False
            for key in pending:
                rec=self.state['runs'].get(key,{})
                m=model_map.get((rec.get('harness'),rec.get('model_id')))
                if m and self.task_readiness(m,rec.get('task'))[0]:now_ready=True;break
            if pending and not now_ready:
                # No harness/task gate changed; do not churn snapshots or reports on each heartbeat.
                return
        for m in self.plan['models']:
            if (self.dest/'STOP').exists():break
            queue=[(task,rep,f'{m["harness"]}:{m["id"]}:{task}:{rep}') for rep in range(1,self.plan['repetitions']+1) for task in self.plan['tasks']]
            self.seed_first_pass_samples(m)
            terminal={'graded','registered','needs_attention','awaiting_interaction'}
            if all(self.state['runs'].get(k,{}).get('status') in terminal for _,_,k in queue):
                if any(self.state['runs'].get(k,{}).get('status')=='needs_attention' for _,_,k in queue):
                    self.state.update(status='execution_needs_attention',active_model=m['id']);self.save()
                    self.event('model_blocked_by_item_attention',model_id=m['id']);break
                continue
            unfinished=[self.state['runs'].get(k,{}) for _,_,k in queue if self.state['runs'].get(k,{}).get('status') not in terminal]
            if any(r.get('status') in ['running','registering','grading','finished'] for r in unfinished):
                raise RuntimeError('Interrupted active run found. Inspect existing PID/job and recover; do not duplicate it by restarting.')
            self.state.update(status='running',active_model=m['id']);self.save();self.event('model_start',model_id=m['id'])
            if self.plan.get('live_ui'):
                set_current_model(m['vendor']+'/'+m['name'])
                wb('ui','open','view=runs',mutation=True)
            pending=set();resource_wait=[];attention=[]
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                for task,rep,key in queue:
                    if (self.dest/'STOP').exists():break
                    rec=self.state['runs'].get(key,{})
                    if rec.get('status') in terminal:continue
                    if task=='T06':
                        try:self.prepare_t06_wait(m,rep,key)
                        except Exception as error:
                            self.patch(key,status='needs_attention',model_id=m['id'],harness=m['harness'],task=task,repetition=rep,error=str(error))
                            self.event('run_preparation_error',model_id=m['id'],task=task,error=str(error));attention.append(key)
                        continue
                    ready,reason=self.task_readiness(m,task)
                    if not ready:
                        self.patch(key,status='waiting_resource',model_id=m['id'],harness=m['harness'],task=task,
                                   repetition=rep,wait_reason=reason)
                        self.event('task_waiting_resource',model_id=m['id'],harness=m['harness'],task=task,reason=reason)
                        resource_wait.append(key)
                        continue
                    while len(pending)>=concurrency:
                        done,pending=wait(pending,return_when=FIRST_COMPLETED)
                        for f in done:f.result()
                    if (self.dest/'STOP').exists():break
                    infra_failed=any((self.state['runs'].get(k,{}).get('error') or '').startswith('CLI_INFRASTRUCTURE_FAILURE') for _,_,k in queue)
                    if infra_failed:
                        self.event('model_infrastructure_hold',model_id=m['id']);resource_wait.append(key);break
                    rec=self.state['runs'].get(key,{})
                    if not rec.get('ref') or not rec.get('workspace'):
                        try:self.create(m,task,rep,key)
                        except Exception as error:
                            self.patch(key,status='needs_attention',model_id=m['id'],harness=m['harness'],task=task,repetition=rep,error=str(error))
                            self.event('run_preparation_error',model_id=m['id'],task=task,error=str(error));attention.append(key)
                            continue
                        if self.state['runs'].get(key,{}).get('status')=='needs_attention':
                            attention.append(key);continue
                    elif rec.get('status')=='waiting_resource':
                        self.patch(key,status='prepared',wait_reason=None)
                    pending.add(pool.submit(self.execute_guarded,m,key))
                for f in pending:f.result()
            for _,_,key in queue:
                if key in self.state['runs']:self.finalize(m,key)
                if self.state['runs'].get(key,{}).get('status')=='needs_attention':attention.append(key)
                if self.state['runs'].get(key,{}).get('status')=='waiting_resource' and key not in resource_wait:resource_wait.append(key)
            wb('report',m['vendor']+'/'+m['name'],mutation=True)
            self.event('model_first_pass_machine_tasks_end',model_id=m['id'],awaiting_interaction=[k for _,_,k in queue if self.state['runs'].get(k,{}).get('status')=='awaiting_interaction'],waiting_resource=resource_wait,needs_attention=attention)
            if resource_wait or attention:
                self.state.update(status='resumption_pending_readiness',active_model=m['id'],waiting_resource=resource_wait,needs_attention=attention)
                self.save();break
            self.event('model_end',model_id=m['id'])
            if (self.dest/'STOP').exists():break
        # Keep every snapshot; never overwrite the one captured before the user's pause.
        snapshot_stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        wb('store','export',str(self.dest/f'bench-store.snapshot-{snapshot_stamp}.json'),mutation=True)
        if (self.dest/'STOP').exists():self.state['status']='drained'
        elif any(r.get('status')=='waiting_resource' for r in self.state['runs'].values()):self.state['status']='resumption_pending_readiness'
        elif any(r.get('status')=='needs_attention' for r in self.state['runs'].values()):self.state['status']='execution_needs_attention'
        elif any(r.get('status')=='awaiting_interaction' for r in self.state['runs'].values()):self.state['status']='awaiting_user_interaction'
        else:self.state['status']='execution_complete'
        self.state['agent_review']='pending_evidence_review';self.save();self.event('queue_end',status=self.state['status'])

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--plan',type=Path,required=True);args=ap.parse_args()
    dispatcher=Dispatcher(args.plan)
    # Windows byte-range lock is released by the OS after a crash; prevents duplicate dispatchers.
    import msvcrt
    with (dispatcher.dest/'dispatcher.lock').open('a+b') as lock:
        lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        try:
            dispatcher.state.update(dispatcher_pid=os.getpid(),dispatcher_started=True,
                                    dispatcher_started_at=now(),dispatcher_cwd=str(ROOT))
            dispatcher.save()
            dispatcher.event('dispatcher_started',pid=os.getpid(),cwd=str(ROOT),plan=str(dispatcher.path))
            dispatcher.run()
        except Exception as error:
            dispatcher.state.update(status='dispatcher_error',dispatcher_error=str(error))
            try:dispatcher.save()
            except OSError:pass
            raise
        finally:
            dispatcher.state.update(last_dispatcher_pid=os.getpid(),dispatcher_pid=None,
                                    dispatcher_finished_at=now(),dispatcher_cwd=str(ROOT))
            try:dispatcher.save()
            except OSError:pass
