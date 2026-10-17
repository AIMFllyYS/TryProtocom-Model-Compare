"""Evaluator-side T06 transcript handling. Never place this module in a model workspace."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path

VALID_MAPS = {'K1','K2','K3','C1','C2','I1','I2','I3','I4','I5','OTHER'}

def new_transcript():
    return {'protocol':'original T06', 'question_rounds':0, 'questions':[], 'rounds':[]}

def append_question_round(transcript, questions, *, source_session, model_message):
    """The evaluator supplies semantic classification and exact authorized answers.

    One original question may cover several intent points. Keep it one question
    rather than inflate the question count to store multiple mapping labels.
    """
    if not questions or not source_session or not model_message.strip():
        raise ValueError('Actual session, model message and questions are required')
    result=deepcopy(transcript);number=result['question_rounds']+1;records=[]
    for q in questions:
        text=q['question'].strip();answer=q['answer'].strip();mapping=q.get('maps_to','OTHER')
        mapping=[mapping] if isinstance(mapping,str) else list(mapping)
        if not text or text not in model_message or not answer:
            raise ValueError('Question must be an exact excerpt of the model message')
        if not mapping or set(mapping)-VALID_MAPS:
            raise ValueError('Unsupported intent mapping')
        if mapping==['OTHER'] and answer!='你来决定':
            raise ValueError('Questions outside the intent table require the original fallback')
        records.append({'question':text,'answer':answer,'maps_to':list(dict.fromkeys(mapping)),
                        'round':number,'source_session':source_session})
    result['question_rounds']=number;result['questions'].extend(records)
    result['rounds'].append({'number':number,'model_message':model_message,'source_session':source_session,
                            'questions':records,'at':datetime.now(timezone.utc).isoformat()})
    return result

def reply_for_last_round(transcript):
    """Only answers go to the model; IDs, evaluator notes and rubric never do."""
    records=transcript['rounds'][-1]['questions']
    return '\n'.join(q['answer'] for q in records)

def save_transcript(path, transcript, *, workspace):
    target=Path(path).resolve();ws=Path(workspace).resolve()
    if target==ws or ws in target.parents:
        raise ValueError('Evaluator transcript must stay outside the model workspace')
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(transcript,ensure_ascii=False,indent=2),'utf-8')

def add_resume_flag(invocation, harness, session):
    import uuid
    uuid.UUID(session)
    flag={'antigravity':'--conversation','grok':'--resume','kimi':'--session','cursor':'--resume'}[harness]
    args=list(invocation)
    position=next((i for i,a in enumerate(args) if i and a.startswith('--')),len(args))
    return args[:position]+[flag,session]+args[position:]
