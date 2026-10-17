"""Public live labels must work for native streams without exposing payloads."""
import json
from live_queue_view import recent_event

def test_grok_update_shows_tool_and_never_private_payload(tmp_path):
    p=tmp_path/'stream.jsonl'
    events=[{'type':'tool_call','toolCallId':'one','toolName':'shell','status':'pending','rawInput':{'secret':'PRIVATE_INPUT'}},
            {'type':'thought','data':'PRIVATE_THOUGHT'},
            {'type':'tool_call_update','toolCallId':'one','status':'completed','rawOutput':'PRIVATE_OUTPUT'},
            {'type':'usage','tokens':10}]
    p.write_text('\n'.join(json.dumps(e) for e in events),encoding='utf-8')
    assert recent_event(p)=='shell / completed'

def test_update_without_start_still_reports_real_status(tmp_path):
    p=tmp_path/'stream.jsonl';p.write_text(json.dumps({'type':'tool_call_update','toolCallId':'one','status':'in_progress','rawOutput':'PRIVATE'}),encoding='utf-8')
    assert recent_event(p)=='工具输出 / in_progress'

def test_antigravity_label_and_grok_end(tmp_path):
    p=tmp_path/'stream.jsonl'
    p.write_text(json.dumps({'event':'step_update','step_update':{'step_type':'tool','tool_name':'run_command','state':'DONE'}}),encoding='utf-8')
    assert recent_event(p)=='run_command / DONE'
    with p.open('a',encoding='utf-8') as f:f.write('\n'+json.dumps({'type':'end','data':'PRIVATE'}))
    assert recent_event(p)=='CLI 返回结果'
