"""Synthetic protocol checks only; these are not enrolled benchmark runs."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from t06_protocol import new_transcript, append_question_round, reply_for_last_round, save_transcript, add_resume_flag
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'skills/bench-grader/scripts'))
from benchlib.common import Metrics, RunContext
from benchlib.probes.static import transcript_probe

class T06Protocol(unittest.TestCase):
    def test_exact_question_grouping_answer_and_probe_roundtrip(self):
        message='确认：测试问题甲及乙？\n测试问题丙？'
        result=append_question_round(new_transcript(),[
            {'question':'测试问题甲及乙？','maps_to':['K1','C1'],'answer':'测试意图表对应答案'},
            {'question':'测试问题丙？','maps_to':'OTHER','answer':'你来决定'}],source_session='synthetic-session',model_message=message)
        self.assertEqual(result['question_rounds'],1)
        self.assertEqual(len(result['questions']),2)
        self.assertEqual(reply_for_last_round(result),'测试意图表对应答案\n你来决定')
        self.assertNotIn('K1',reply_for_last_round(result))
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);ws=root/'workspace';ws.mkdir();rd=root/'grader';rd.mkdir()
            save_transcript(rd/'transcript_notes.json',result,workspace=ws)
            m=Metrics(na={'tr.*':'previously missing transcript'})
            ctx=RunContext(run_dir=rd,meta={},rubric={},cfg={},metrics=m)
            transcript_probe(ctx,{'key':['K1','K2','K3'],'contradictions':['C1','C2'],'inferable':['I1']})
            self.assertIsNone(m.is_na('tr.questions'))
            self.assertEqual(m.values['tr.questions'],2)
            self.assertEqual(m.values['tr.k_asked'],1)
            self.assertEqual(m.values['tr.c_flagged'],1)
            self.assertEqual(m.values['tr.other'],1)
    def test_no_unasked_or_invented_questions_and_fallback(self):
        for question,mapping,answer in [('不存在的问题？','K1','答案'),('问题？','OTHER','任意发挥')]:
            with self.assertRaises(ValueError):
                append_question_round(new_transcript(),[{'question':question,'maps_to':mapping,'answer':answer}],source_session='synthetic',model_message='问题？')
    def test_transcript_cannot_be_saved_inside_model_workspace(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):save_transcript(Path(temp)/'transcript.json',new_transcript(),workspace=temp)
    def test_resume_uses_explicit_session_and_preserves_prompt(self):
        sid='00000000-0000-4000-8000-000000000001'
        for harness,flag in [('antigravity','--conversation'),('grok','--resume'),('kimi','--session'),('cursor','--resume')]:
            self.assertEqual(add_resume_flag(['cli','--prompt','specific answer'],harness,sid),['cli',flag,sid,'--prompt','specific answer'])

if __name__=='__main__':unittest.main()
