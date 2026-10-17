"""One bounded, unenrolled live question/resume diagnostic; no hidden intent is supplied."""
import json
from pathlib import Path
import subprocess
import time
import uuid
from overnight_runner import ROOT,read_events,final_from,usage_from,now
from overnight_preflight import invocation,kill_tree
from t06_protocol import new_transcript,append_question_round,reply_for_last_round,save_transcript,add_resume_flag

QUEUE=ROOT/'reports/2026-10-03-official-unattended'
DEST=QUEUE/'diagnostics/T06-antigravity-pro'
MODEL='gemini-3.1-pro-high'

def turn(inv,prompt,ws,number,sid=None):
    prompt_file=DEST/f'turn{number}.prompt.txt';prompt_file.write_text(prompt,'utf-8')
    args=invocation('antigravity',inv['commands']['antigravity'],MODEL,prompt,prompt_file,ws)
    if sid:args=add_resume_flag(args,'antigravity',sid)
    with (DEST/f'turn{number}.stdout.jsonl').open('wb') as out,(DEST/f'turn{number}.stderr.log').open('wb') as err:
        proc=subprocess.Popen(args,cwd=ws,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=subprocess.CREATE_NO_WINDOW)
        try:proc.wait(timeout=120)
        except subprocess.TimeoutExpired:kill_tree(proc);raise
    events=read_events(DEST/f'turn{number}.stdout.jsonl')
    result=next((e['result'] for e in reversed(events) if e.get('event')=='result'),{})
    if proc.returncode or result.get('status')!='SUCCESS':raise RuntimeError('CLI diagnostic failed; preserved original stream and stderr')
    return final_from(events),result.get('conversation_id'),usage_from(events)

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    record_path=DEST/'result.json'
    if record_path.exists():print('Existing diagnostic result retained; no repeated model call');return
    state=json.loads((QUEUE/'state.json').read_text('utf-8'))
    plan=json.loads((QUEUE/'plan.json').read_text('utf-8'))
    runs=[r for r in state['runs'].values() if r['model_id']==MODEL and r['task'] in plan['tasks']]
    expected=len(plan['tasks'])*plan['repetitions']
    if state.get('active_model')!=MODEL or len(runs)!=expected or any(r['status'] in ['prepared','waiting_resource'] for r in runs) or sum(r['status']=='running' for r in state['runs'].values())>2:
        print('Deferred: current model or inference-slot conditions do not permit this diagnostic');return
    stop=QUEUE/'STOP';marker='Owned Antigravity T06 diagnostic '+uuid.uuid4().hex
    try:
        with stop.open('x',encoding='utf-8') as f:f.write(marker)
    except FileExistsError:
        print('Existing dispatch STOP retained; diagnostic deferred');return
    record={'started_at':now(),'model':MODEL,'formal_enrollment':False}
    try:
        ws=DEST/'workspace';ws.mkdir(exist_ok=True)
        assert not any(ws.iterdir()),'Diagnostic workspace is not clean'
        subprocess.run(['git','init','--quiet',str(ws)],check=True,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
        inv=json.loads((ROOT/'reports/2026-10-03-overnight-preflight/inventory.json').read_text('utf-8'))
        record['harness_version']=inv['versions']['antigravity']
        question='诊断颜色选什么？'
        prompt='这是不计入模型测评的通信诊断。本回合只向我问“诊断颜色选什么？”然后等待。收到我下一条答复后，将我的答复原文写入当前工作目录的 ACK.txt。不要创建其他交付文件。'
        text,sid,u1=turn(inv,prompt,ws,1)
        transcript=append_question_round(new_transcript(),[{'question':question,'maps_to':'OTHER','answer':'你来决定'}],source_session=sid,model_message=text)
        save_transcript(DEST/'transcript_notes.json',transcript,workspace=ws)
        text2,sid2,u2=turn(inv,reply_for_last_round(transcript),ws,2,sid)
        assert sid2==sid,'Resume did not preserve the original conversation'
        assert (ws/'ACK.txt').read_text('utf-8').strip()=='你来决定','Actual answer was not recorded verbatim'
        record.update(passed=True,conversation_id=sid,question_rounds=1,questions=1,reply_retained=True,usage_by_turn=[u1,u2])
    except Exception as error:record.update(passed=False,error=str(error))
    finally:
        if stop.exists() and stop.read_text('utf-8')==marker:stop.unlink()
        record['dispatch_hold_released']=not stop.exists()
        record['dispatcher_resume_required']=json.loads((QUEUE/'state.json').read_text('utf-8')).get('status')=='drained'
        record['ended_at']=now();record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(record,ensure_ascii=True))

if __name__=='__main__':main()
