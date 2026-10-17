"""One bounded, unenrolled real question/resume diagnostic in a free model slot."""
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import psutil

from overnight_runner import ROOT,read_events,final_from,usage_from,now
from overnight_preflight import invocation,kill_tree
from t06_protocol import new_transcript,append_question_round,reply_for_last_round,save_transcript,add_resume_flag

QUEUE=ROOT/'reports/2026-10-03-official-unattended'
DEST=QUEUE/'diagnostics/T06-grok-4.7'
MODEL='grok-4.7'

def turn(inv,prompt,ws,number,sid=None):
    pf=DEST/f'turn{number}.prompt.txt';pf.write_text(prompt,'utf-8')
    args=invocation('grok',inv['commands']['grok'],MODEL,prompt,pf,ws)
    if sid:args=add_resume_flag(args,'grok',sid)
    with (DEST/f'turn{number}.stdout.jsonl').open('wb') as out,(DEST/f'turn{number}.stderr.log').open('wb') as err:
        proc=subprocess.Popen(args,cwd=ws,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=subprocess.CREATE_NO_WINDOW)
        control={'diagnostic_pid':os.getpid(),'model_pid':proc.pid,'model_created_at':psutil.Process(proc.pid).create_time(),
                 'workspace':str(ws),'turn':number,'formal_enrollment':False}
        (DEST/'control.json').write_text(json.dumps(control,indent=2),'utf-8')
        try:proc.wait(timeout=120)
        except subprocess.TimeoutExpired:kill_tree(proc);raise
    events=read_events(DEST/f'turn{number}.stdout.jsonl')
    errors=[e for e in events if e.get('type')=='error']
    end=next((e for e in reversed(events) if e.get('type')=='end'),{})
    if proc.returncode or errors or end.get('stopReason')!='end_turn':
        raise RuntimeError('CLI communication diagnostic failed; original stream and stderr retained')
    return final_from(events),end.get('sessionId'),usage_from(events)

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    result=DEST/'result.json'
    if result.exists():print('Existing diagnostic retained; no repeated model call');return
    state=json.loads((QUEUE/'state.json').read_text('utf-8'))
    model_runs=[r for r in state['runs'].values() if r['model_id']==MODEL]
    if state.get('active_model')!=MODEL or len(model_runs)!=15 or any(r['status'] in ['prepared','waiting_resource'] for r in model_runs) or sum(r['status']=='running' for r in state['runs'].values())>2:
        print('Deferred: model/slot/issued-task conditions do not permit diagnostic');return
    stop=QUEUE/'STOP';marker='Owned T06 diagnostic '+uuid.uuid4().hex
    try:
        with stop.open('x',encoding='utf-8') as f:f.write(marker)
    except FileExistsError:
        print('Existing dispatch STOP retained; no diagnostic started');return
    record={'started_at':now(),'model':MODEL,'formal_enrollment':False,'question_protocol':'original OTHER fallback only; no hidden table supplied',
            'diagnostic_pid':os.getpid(),'created_at':psutil.Process().create_time(),'cwd':str(ROOT),'dispatch_hold_owner':marker}
    result.write_text(json.dumps(dict(record,status='running'),indent=2),'utf-8')
    try:
        fresh=json.loads((QUEUE/'state.json').read_text('utf-8'))
        if fresh.get('active_model')!=MODEL or sum(r['status']=='running' for r in fresh['runs'].values())>2:
            raise RuntimeError('Model/slot changed before diagnostic start; no additional model launched')
        ws=DEST/'workspace';ws.mkdir(exist_ok=True);assert not any(ws.iterdir()),'Diagnostic workspace must be clean'
        subprocess.run(['git','init','--quiet',str(ws)],check=True,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
        inv=json.loads((ROOT/'reports/2026-10-03-overnight-preflight/inventory.json').read_text('utf-8'))
        record['harness_version']=inv['versions']['grok']
        question='诊断颜色选什么？'
        prompt='这是不计入模型测评的通信诊断。本回合只向我问“诊断颜色选什么？”然后等待。收到我下一条答复后，将我的答复原文写入当前工作目录的 ACK.txt。不要创建其他交付文件。'
        message,sid,u1=turn(inv,prompt,ws,1)
        transcript=append_question_round(new_transcript(),[{'question':question,'maps_to':'OTHER','answer':'你来决定'}],source_session=sid,model_message=message)
        save_transcript(DEST/'transcript_notes.json',transcript,workspace=ws)
        message2,sid2,u2=turn(inv,reply_for_last_round(transcript),ws,2,sid)
        assert sid2==sid,'Resume did not retain conversation ID'
        assert (ws/'ACK.txt').read_text('utf-8').strip()=='你来决定','Reply was not recorded verbatim'
        record.update(passed=True,conversation_id=sid,question_rounds=1,questions=1,reply_retained=True,usage_by_turn=[u1,u2],status='complete')
    except Exception as error:record.update(passed=False,error=str(error),status='needs_attention')
    finally:
        if stop.exists() and stop.read_text('utf-8')==marker:stop.unlink()
        latest=json.loads((QUEUE/'state.json').read_text('utf-8'))
        record.update(ended_at=now(),dispatch_hold_released=not stop.exists(),dispatcher_resume_required=latest.get('status')=='drained')
        result.write_text(json.dumps(record,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'status':record['status'],'passed':record.get('passed'),'result':str(result),'dispatcher_resume_required':record['dispatcher_resume_required']}))

if __name__=='__main__':main()
