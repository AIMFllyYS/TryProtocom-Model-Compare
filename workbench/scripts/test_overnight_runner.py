"""Scheduling tests use event gates, never model calls or fabricated benchmark data."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from overnight_runner import Dispatcher, already_registered, cli_error_after_complete_delivery, final_from, usage_from, wait_for_delivery, wb
from recover_dispatcher import should_retry_orphaned_run

class TestDispatcher(unittest.TestCase):
    def test_specialized_video_tasks_share_one_slot_while_light_task_runs(self):
        from concurrent.futures import ThreadPoolExecutor
        first_started=threading.Event();second_attempted=threading.Event();release=threading.Event();light_started=threading.Event()
        trace=[];mutex=threading.Lock()
        class Simulation(Dispatcher):
            def patch(s,key,**fields):
                result=super().patch(key,**fields)
                if key=='video2' and fields.get('status')=='waiting_resource':second_attempted.set()
                return result
            def task_readiness(s,m,task):return True,''
            def execute(s,m,key):
                with mutex:trace.append(('start',key))
                if key=='video1':
                    first_started.set()
                    if not release.wait(4):raise RuntimeError('Test release missing')
                if key=='light':light_started.set()
                with mutex:trace.append(('end',key))
        with tempfile.TemporaryDirectory() as temp,patch('overnight_runner.wb',return_value={}):
            d=Simulation(self.make(temp,1));d.patch('video1',task='T04',model_id='m0',harness='grok');d.patch('video2',task='T03C',model_id='m0',harness='grok');d.patch('light',task='T07',model_id='m0',harness='grok')
            with ThreadPoolExecutor(max_workers=3) as pool:
                first=pool.submit(d.execute_guarded,{},'video1')
                self.assertTrue(first_started.wait(4))
                second=pool.submit(d.execute_guarded,{},'video2')
                self.assertTrue(second_attempted.wait(4))
                light=pool.submit(d.execute_guarded,{},'light')
                self.assertTrue(light_started.wait(4));light.result()
                release.set();first.result();second.result()
            self.assertLess(trace.index(('start','light')),trace.index(('end','video1')))
            self.assertLess(trace.index(('end','video1')),trace.index(('start','video2')))
    def test_workbench_json_failure_preserves_server_error(self):
        from types import SimpleNamespace
        result=SimpleNamespace(returncode=1,stdout='{"ok":false,"error":"start metadata locked"}',stderr='')
        with patch('overnight_runner.subprocess.run',return_value=result):
            with self.assertRaisesRegex(RuntimeError,'start metadata locked'):wb('run','start','Test/m0/T07/r1')
    def make(self,temp,models=2):
        dest=Path(temp)
        inventory=dest/'inventory.json';inventory.write_text('{}','utf-8')
        plan=dict(inventory=str(inventory),models=[dict(harness='grok',id=f'm{i}',vendor='Test',name=f'm{i}') for i in range(models)],
                  tasks=['T01','T07','T08','T05'],repetitions=1,concurrency=3,time_limits={})
        path=dest/'plan.json';path.write_text(json.dumps(plan),'utf-8')
        return path
    def test_three_slots_refill_and_model_serialization(self):
        trace=[];counts={};active=set();gate=threading.Lock();max_active=0
        thirds={};fourths={}
        class Simulation(Dispatcher):
            def create(s,m,task,rep,key):s.patch(key,status='prepared',ref=key,task=task,model_id=m['id'],harness=m['harness'])
            def event(s,*args,**kwargs):pass
            def finalize(s,*args):pass
            def execute(s,m,key):
                nonlocal max_active
                mid=m['id'];task=s.state['runs'][key]['task']
                with gate:
                    active.add(key);counts[mid]=counts.get(mid,0)+1
                    thirds.setdefault(mid,threading.Event());fourths.setdefault(mid,threading.Event())
                    trace.append(('start',mid,task));max_active=max(max_active,len(active))
                    if counts[mid]==3:thirds[mid].set()
                    if task=='T05':fourths[mid].set()
                if task=='T01':
                    if not thirds[mid].wait(4):raise RuntimeError('Three initial slots did not launch')
                elif task in ['T07','T08']:
                    if not fourths[mid].wait(4):raise RuntimeError('Freed slot was not replenished')
                with gate:trace.append(('end',mid,task));active.remove(key)
                s.patch(key,status='graded')
        with tempfile.TemporaryDirectory() as temp,patch('overnight_runner.wb',return_value={}):
            d=Simulation(self.make(temp));d.run()
            self.assertEqual(max_active,3)
            self.assertEqual(counts,{'m0':4,'m1':4})
            self.assertLess(trace.index(('end','m0','T01')),trace.index(('start','m0','T05')))
            self.assertLess(max(i for i,x in enumerate(trace) if x[0]=='end' and x[1]=='m0'),min(i for i,x in enumerate(trace) if x[0]=='start' and x[1]=='m1'))
            trace.clear();d.run();self.assertEqual(trace,[], 'Resume duplicated completed tasks')
    def test_stop_prevents_dispatch(self):
        with tempfile.TemporaryDirectory() as temp,patch('overnight_runner.wb',return_value={}):
            d=Dispatcher(self.make(temp));(Path(temp)/'STOP').touch()
            with patch.object(d,'create',side_effect=AssertionError('Run launched after STOP')):d.run()
            self.assertEqual(d.state['status'],'drained')
    def test_cli_failure_stops_only_incomplete_workbench_run(self):
        with tempfile.TemporaryDirectory() as temp:
            d=Dispatcher(self.make(temp,1));ws=Path(temp)/'r3';ws.mkdir()
            meta=ws.parent/'r3.run.json';meta.write_text(json.dumps({'ended_at':None,'grader_run_id':None}),'utf-8')
            with patch('overnight_runner.wb',return_value={'ok':True}) as stop:
                self.assertTrue(d.stop_incomplete_workbench_run('Test/m0/T03A/r3',ws,'headless CLI failed'))
            self.assertEqual(stop.call_args.args[:4],('run','stop','Test/m0/T03A/r3','--reason'))
            self.assertEqual(stop.call_args.kwargs,{'mutation':True})
    def test_cli_cleanup_preserves_finished_registered_or_finalized_run(self):
        with tempfile.TemporaryDirectory() as temp:
            d=Dispatcher(self.make(temp,1));ws=Path(temp)/'r1';ws.mkdir()
            meta=ws.parent/'r1.run.json'
            for record in ({'ended_at':'2026-10-05T00:00:00Z','grader_run_id':None},
                           {'ended_at':None,'grader_run_id':'T03A-existing'}):
                meta.write_text(json.dumps(record),'utf-8')
                with patch('overnight_runner.wb') as stop:
                    self.assertFalse(d.stop_incomplete_workbench_run('Test/m0/T03A/r1',ws,'failure'))
                    stop.assert_not_called()
            meta.write_text(json.dumps({'ended_at':None,'grader_run_id':None}),'utf-8')
            (ws/'FINAL_MESSAGE.md').write_text('completed delivery','utf-8')
            with patch('overnight_runner.wb') as stop:
                self.assertFalse(d.stop_incomplete_workbench_run('Test/m0/T03A/r1',ws,'failure'))
                stop.assert_not_called()
    def test_interrupted_active_task_never_duplicates(self):
        with tempfile.TemporaryDirectory() as temp,patch('overnight_runner.wb',return_value={}):
            d=Dispatcher(self.make(temp,1));d.patch('grok:m0:T01:1',status='running',pid=123)
            with self.assertRaisesRegex(RuntimeError,'Interrupted active run'):d.run()
    def test_kimi_final_and_usage(self):
        self.assertEqual(final_from([{'role':'assistant','content':'real final'}, {'role':'meta','type':'session.resume_hint'}]),'real final')
        self.assertEqual(usage_from([{'event':'result','result':{'usage':{'input_tokens':10,'output_tokens':20}}}]),{'input_tokens':10,'output_tokens':20})
    def test_grok_native_text_deltas_capture_only_last_visible_message(self):
        events=[{'type':'text','data':'Planning text'},{'type':'usage','usage':{}},
                {'type':'tool_call','toolName':'write'}, {'type':'thought','data':'private reasoning'},
                {'type':'text','data':'Actual '},{'type':'text','data':'final'},
                {'type':'usage','usage':{}},{'type':'end','stopReason':'end_turn'}]
        self.assertEqual(final_from(events),'Actual final')
    def test_completion_file_closes_lingering_cli(self):
        class Lingering:
            def poll(self):return None
        with tempfile.TemporaryDirectory() as temp:
            ws=Path(temp);(ws/'FINAL_MESSAGE.md').write_text('real model final','utf-8')
            with patch('overnight_runner.time.monotonic',side_effect=[0,1,2,3,35]),patch('overnight_runner.time.sleep'),patch('overnight_runner.kill_tree') as kill:
                self.assertEqual(wait_for_delivery(Lingering(),ws,3600),'completion_file');kill.assert_called_once()
    def test_exit_zero_api_error_salvages_only_complete_delivery(self):
        with tempfile.TemporaryDirectory() as temp:
            ws=Path(temp)/'r1';ws.mkdir();(ws/'aether9-promo').mkdir()
            (ws/'FINAL_MESSAGE.md').write_text('Delivered aether9-promo.',encoding='utf-8')
            (ws.parent/'r1.run.json').write_text(json.dumps({'deliverable_dir':'aether9-promo'}),encoding='utf-8')
            self.assertTrue(cli_error_after_complete_delivery(ws,0,['ERROR']))
            self.assertFalse(cli_error_after_complete_delivery(ws,1,['ERROR']))
            (ws/'FINAL_MESSAGE.md').unlink()
            self.assertFalse(cli_error_after_complete_delivery(ws,0,['ERROR']))
    def test_duplicate_register_is_reconciled_only_for_matching_run_id(self):
        duplicate='POST /api/ws/register -> 409 已登记为 T03A-32e49679'
        self.assertTrue(already_registered(duplicate,'T03A-32e49679'))
        self.assertFalse(already_registered(duplicate,'T03C-ff185888'))
        self.assertFalse(already_registered('POST /api/ws/register -> 409 conflict','T03A-32e49679'))
        self.assertFalse(already_registered('already registered as T03A-32e49679','T03A-32e49679'))
    def test_orphaned_run_gets_only_one_clean_retry(self):
        rec={'status':'running'}
        self.assertTrue(should_retry_orphaned_run(rec,False,False,None))
        self.assertFalse(should_retry_orphaned_run(rec,True,False,None))
        self.assertFalse(should_retry_orphaned_run(rec,False,True,None))
        self.assertFalse(should_retry_orphaned_run(rec,False,False,'T03A-existing'))
        self.assertFalse(should_retry_orphaned_run({**rec,'interrupted_retry_count':1},False,False,None))
    def test_timeout_is_distinct_from_delivery(self):
        class Lingering:
            def poll(self):return None
        with tempfile.TemporaryDirectory() as temp:
            with patch('overnight_runner.time.monotonic',side_effect=[0,2]),patch('overnight_runner.kill_tree') as kill:
                self.assertEqual(wait_for_delivery(Lingering(),Path(temp),1),'timeout');kill.assert_called_once()
    def test_state_replace_retries_windows_reader_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            d=Dispatcher(self.make(temp,1));original=Path.replace;attempts=[]
            def briefly_locked(path,target):
                attempts.append(1)
                if len(attempts)<3:raise PermissionError('Windows reader still holds file')
                return original(path,target)
            with patch('overnight_runner.Path.replace',briefly_locked),patch('overnight_runner.time.sleep'):
                d.patch('grok:m0:T01:1',status='running')
            self.assertEqual(len(attempts),3)
            self.assertEqual(json.loads(d.state_path.read_text('utf-8'))['runs']['grok:m0:T01:1']['status'],'running')
    def test_recovered_null_error_does_not_crash_dispatch(self):
        class Quick(Dispatcher):
            def create(s,m,task,rep,key):s.patch(key,status='prepared',ref=key,task=task,model_id=m['id'],harness=m['harness'])
            def execute(s,m,key):s.patch(key,status='graded')
            def event(s,*args,**kwargs):pass
            def finalize(s,*args):pass
        with tempfile.TemporaryDirectory() as temp,patch('overnight_runner.wb',return_value={}):
            d=Quick(self.make(temp,1));d.patch('grok:m0:T01:1',status='graded',error=None,task='T01')
            d.run();self.assertEqual(len(d.state['runs']),4);self.assertEqual(d.state['status'],'execution_complete')
    def test_finalize_uses_durable_score_after_job_eviction(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp);d=Dispatcher(self.make(temp,1));ws=dest/'r1';ws.mkdir()
            ws.with_suffix('.run.json').write_text(json.dumps({'grader_run_id':'T07-test'}),'utf-8')
            score_dir=dest/'bench-data/runs/T07-test';score_dir.mkdir(parents=True)
            (score_dir/'score.json').write_text(json.dumps({'items':[],'total':72.5}),'utf-8')
            (score_dir/'metrics.json').write_text('{"values":{}}','utf-8')
            d.patch('key',status='registering',ref='Test/m0/T07/r1',workspace=str(ws),register_job='evicted')
            with patch('overnight_runner.ROOT',dest),patch('overnight_runner.wb',return_value=[]),patch.object(d,'job_wait',side_effect=AssertionError('Evicted registration job must not be queried')):
                d.finalize({},'key')
            self.assertEqual(d.state['runs']['key']['status'],'graded')
            self.assertEqual(d.state['runs']['key']['run_id'],'T07-test')
            self.assertEqual(d.state['runs']['key']['score'],72.5)
    def test_finalize_reconciles_persisted_score_after_bridge_snapshot_error(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp);d=Dispatcher(self.make(temp,1));ws=dest/'r1';ws.mkdir()
            ws.with_suffix('.run.json').write_text(json.dumps({'grader_run_id':'T04-test'}),'utf-8')
            score_dir=dest/'bench-data/runs/T04-test';score_dir.mkdir(parents=True)
            (score_dir/'score.json').write_text(json.dumps({'items':[{'method':'auto','score':66.67}],'total':66.67,'complete':False}),'utf-8')
            (score_dir/'metrics.json').write_text('{"values":{"video.exists":true}}','utf-8')
            failed={'kind':'grade','subject':{'run_ids':['T04-test']},'status':'failed','error':'bridge snapshot 无输出：'}
            d.patch('key',status='registering',ref='Google/m0/T04/r1',workspace=str(ws),register_job='done')
            with patch('overnight_runner.ROOT',dest),patch('overnight_runner.wb',return_value=[failed]):
                d.finalize({},'key')
            result=d.state['runs']['key']
            self.assertEqual(result['status'],'graded')
            self.assertEqual(result['run_id'],'T04-test')
            self.assertEqual(result['score'],66.67)
            self.assertFalse(result['score_complete'])
            self.assertIn('bridge snapshot',result['grade_warning'])
    def test_finalize_ignores_unmaterialized_waiting_resource_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            d=Dispatcher(self.make(temp,1));d.patch('slot',status='waiting_resource',task='T04',wait_reason='memory')
            d.finalize({},'slot')
            self.assertEqual(d.state['runs']['slot']['status'],'waiting_resource')
            self.assertIsNone(d.state['runs']['slot'].get('ref'))
    def test_placeholder_score_waits_for_actual_probe_completion(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp);d=Dispatcher(self.make(temp,1));ws=dest/'r1';ws.mkdir()
            ws.with_suffix('.run.json').write_text(json.dumps({'grader_run_id':'T07-test'}),'utf-8')
            rd=dest/'bench-data/runs/T07-test';rd.mkdir(parents=True)
            (rd/'score.json').write_text(json.dumps({'items':[],'total':0}),'utf-8')
            d.patch('key',status='registering',ref='Test/m0/T07/r1',workspace=str(ws))
            def finish_probes(_seconds):
                self.assertEqual(d.state['runs']['key']['status'],'grading')
                (rd/'metrics.json').write_text('{"values":{"probe.complete":true}}','utf-8')
                (rd/'score.json').write_text(json.dumps({'items':[],'total':88}),'utf-8')
            running={'kind':'grade','subject':{'run_ids':['T07-test']},'status':'running'}
            with patch('overnight_runner.ROOT',dest),patch('overnight_runner.wb',side_effect=[[running],[]]),patch('overnight_runner.time.sleep',side_effect=finish_probes):
                d.finalize({},'key')
            self.assertEqual(d.state['runs']['key']['score'],88)
    def test_failed_regrade_cannot_accept_an_old_score(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp);d=Dispatcher(self.make(temp,1));ws=dest/'r1';ws.mkdir()
            ws.with_suffix('.run.json').write_text(json.dumps({'grader_run_id':'T07-test'}),'utf-8')
            rd=dest/'bench-data/runs/T07-test';rd.mkdir(parents=True)
            (rd/'score.json').write_text(json.dumps({'items':[],'total':100}),'utf-8')
            (rd/'metrics.json').write_text('{"values":{}}','utf-8')
            d.patch('key',status='registering',ref='Test/m0/T07/r1',workspace=str(ws))
            failed={'kind':'grade','subject':{'run_ids':['T07-test']},'status':'failed'}
            with patch('overnight_runner.ROOT',dest),patch('overnight_runner.wb',return_value=[failed]):
                d.finalize({},'key')
            self.assertEqual(d.state['runs']['key']['status'],'needs_attention')
    def test_lost_grading_job_is_requeued_once_without_model_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp);d=Dispatcher(self.make(temp,1));ws=dest/'r1';ws.mkdir()
            ws.with_suffix('.run.json').write_text(json.dumps({'grader_run_id':'T07-test'}),'utf-8')
            rd=dest/'bench-data/runs/T07-test';rd.mkdir(parents=True)
            d.patch('key',status='registering',ref='Test/m0/T07/r1',workspace=str(ws))
            def completed(_seconds):
                (rd/'metrics.json').write_text('{"values":{}}','utf-8')
                (rd/'score.json').write_text(json.dumps({'items':[],'total':77}),'utf-8')
            with patch('overnight_runner.ROOT',dest),patch('overnight_runner.active_grader_for',return_value=False),patch('overnight_runner.wb',side_effect=[[],{'id':'recovered'},[]]) as calls,patch('overnight_runner.time.sleep',side_effect=completed):
                d.finalize({},'key')
            self.assertEqual(d.state['runs']['key']['status'],'graded')
            self.assertEqual(d.state['runs']['key']['grade_recovery_count'],1)
            self.assertEqual(calls.call_args_list[1].args,('grade','T07-test','--no-wait'))

if __name__=='__main__':unittest.main()
