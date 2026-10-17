"""Independent bridge writers must retain all existing and newly scored items."""
import json
import multiprocessing
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]

def write_score(data, barrier, number):
    sys.path.insert(0, str(ROOT/'workbench/py'))
    import wbbridge
    from benchlib.common import load_json
    wbbridge.out = lambda *args, **kwargs: None
    wbbridge._run_record = lambda rd, root: {'manual':load_json(rd/'manual_scores.json')}
    barrier.wait(timeout=15)
    wbbridge.cmd_set_manual(SimpleNamespace(data=data,run='T-test',item=f'H{number}',score=str(number%4),
                                          note='用户授权AI视觉代评 '+str(number),by='human',root=str(ROOT)))

class ManualConcurrency(unittest.TestCase):
    def test_simultaneous_processes_preserve_scores_and_utf8(self):
        with tempfile.TemporaryDirectory() as temp:
            rd=Path(temp)/'runs/T-test';rd.mkdir(parents=True)
            (rd/'meta.json').write_text('{}','utf-8')
            original={'user-existing':{'score':3,'note':'用户原始评分','by':'human'}}
            (rd/'manual_scores.json').write_text(json.dumps(original,ensure_ascii=False),'utf-8')
            ctx=multiprocessing.get_context('spawn');barrier=ctx.Barrier(6)
            children=[ctx.Process(target=write_score,args=(temp,barrier,i)) for i in range(6)]
            for p in children:p.start()
            try:
                for p in children:
                    p.join(25)
                    self.assertEqual(p.exitcode,0)
            finally:
                for p in children:
                    if p.is_alive():p.terminate();p.join()
                    p.close()
            result=json.loads((rd/'manual_scores.json').read_text('utf-8'))
            self.assertEqual(result['user-existing'],original['user-existing'])
            self.assertEqual(len(result),7)
            for i in range(6):
                self.assertEqual(result[f'H{i}']['note'],'用户授权AI视觉代评 '+str(i))
            self.assertFalse(list(rd.glob('*.tmp')))

if __name__=='__main__':unittest.main()
