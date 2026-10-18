"""Backend harness regressions: unittest accounting and Windows child cleanup."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchlib.probes.api import Server, _own_tests_passed, _api_runtime_env, api_probe
from benchlib.probes.api import _ensure_python3_alias, _interpreter_env_failure, _python3_resolves_to
from benchlib.common import Metrics, RunContext

@pytest.mark.parametrize('output,count', [
    ('Ran 11 tests in 2.195s\n\nOK\n',11),
    ('Ran 1 test in 0.1s\n\nOK\n',1),
    ('Ran 5 tests in 0.1s\n\nOK (skipped=1, expected failures=1)\n',3),
    ('Ran 5 tests in 0.1s\n\nFAILED (failures=1)\n',0),
    ('3 failed, 12 passed in 0.5s',12),
    ('Tests:  8 passed, 8 total',8),
    ('# tests 4\n# pass 3\n# fail 1\n',3),
    ('Test Suites: 2 passed, 2 total\nTests: 8 passed, 8 total\n',8),
])
def test_own_test_count(output,count):
    assert _own_tests_passed(output)==count

def test_relative_run_path_produces_absolute_runtime_search_path(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    rd=Path('data/run');(rd/'_grading/api-python311/Scripts').mkdir(parents=True)
    (rd/'_grading/api-python311/bin').mkdir()
    (rd/'_grading/api-python311/Scripts/python.exe').touch()
    (rd/'_grading/api-python311/bin/python').touch()
    (rd/'_grading/api-python311/evaluator-ready.json').write_text('{}',encoding='utf-8')
    ctx=RunContext(run_dir=rd,meta={},rubric={},cfg={'external':{'api_python':'configured-python'}},metrics=Metrics())
    monkeypatch.setattr('benchlib.probes.api.run_cmd',lambda *args,**kwargs:(0,'Python 3.11.15',0))
    env=_api_runtime_env(ctx)
    assert Path(env['PATH'].split(os.pathsep)[0]).is_absolute()
    assert Path(env['VIRTUAL_ENV']).is_absolute()

def test_missing_service_regrade_does_not_keep_previous_pass_results(tmp_path):
    rd=tmp_path/'run';(rd/'output').mkdir(parents=True)
    metrics=Metrics(values={'api.tests_passed':48,'api.started':True,'files.required_ratio':1},
                    na={'api.started':'old environment failure'})
    ctx=RunContext(run_dir=rd,meta={},rubric={},cfg={},metrics=metrics)
    api_probe(ctx,{})
    assert metrics.values.get('api.bench_json') is False
    assert 'api.tests_passed' not in metrics.values
    assert 'api.started' not in metrics.values
    assert not metrics.na
    assert metrics.values['files.required_ratio']==1


def test_python3_alias_is_created_next_to_isolated_interpreter(tmp_path):
    """Windows `python -m venv` writes only python.exe; the seed's `python3` start
    command needs an alias or it resolves to the Store App Execution Alias."""
    scripts=tmp_path/'Scripts';scripts.mkdir()
    exe=scripts/('python.exe' if os.name=='nt' else 'bin/python')
    if os.name!='nt':(tmp_path/'bin').mkdir();exe=tmp_path/'bin'/'python'
    exe.write_bytes(b'fake')
    _ensure_python3_alias(exe)
    alias=exe.parent/('python3.exe' if os.name=='nt' else 'python3')
    assert alias.exists(),'python3 alias was not created'
    assert alias.read_bytes()==b'fake'


def test_python3_resolution_detects_store_alias_fallthrough(tmp_path):
    """Resolution must be verified against the intended interpreter, not merely
    'some python3 exists on PATH' — the Store alias satisfies the latter."""
    real=tmp_path/'real';real.mkdir();exe=real/('python.exe' if os.name=='nt' else 'python')
    exe.write_bytes(b'fake')
    other=tmp_path/'other';other.mkdir();decoy=other/('python3.exe' if os.name=='nt' else 'python3')
    decoy.write_bytes(b'')
    env={'PATH':str(other)}
    assert not _python3_resolves_to(env,exe),'decoy python3 must not count as resolved'
    env2={'PATH':str(real)+os.pathsep+str(other)}
    _ensure_python3_alias(exe)
    assert _python3_resolves_to(env2,exe),'created alias should resolve'


@pytest.mark.parametrize('cmd,log,expected',[
    ('python3 app.py','Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.',True),
    ('python3 app.py',"'python3' is not recognized as an internal or external command",True),
    ('python3 app.py','python3: command not found',True),
    ('python3 app.py','Traceback (most recent call last):\n  File "app.py", line 3, in <module>\nImportError: boom',False),
    ('python app.py','Python was not found; run without arguments to install from the Microsoft Store',False),
    ('node server.js','StudySpot API listening on port 1234',False),
])
def test_interpreter_env_failure_classification(tmp_path,cmd,log,expected):
    p=tmp_path/'server.log';p.write_text(log,encoding='utf-8')
    assert (_interpreter_env_failure(cmd,p) is not None)==expected


def test_store_alias_failure_marks_api_na_instead_of_zero(tmp_path,monkeypatch):
    """A dead host interpreter must leave the api items unmeasurable (N/A), not
    scored 0 — otherwise G1 zeroes an otherwise complete run and blames the model."""
    import benchlib.probes.api as apimod
    proj=tmp_path/'run'/'output'/'proj';proj.mkdir(parents=True)
    (proj/'bench.json').write_text(
        '{"start": "python3 app.py", "setup": "", "test": "python3 -m pytest -q tests", "health": "/health"}',
        encoding='utf-8')
    (proj/'app.py').write_text('',encoding='utf-8')
    metrics=Metrics(values={'api.tests_passed':48})
    ctx=RunContext(run_dir=tmp_path/'run',meta={},rubric={'deliverable_dir':'proj'},
                   cfg={'external':{}},metrics=metrics)
    def fake_start(self):
        Path(self.log).write_text('Python was not found; run without arguments to install from the Microsoft Store',encoding='utf-8')
    monkeypatch.setattr(apimod.Server,'start',fake_start)
    monkeypatch.setattr(apimod,'_wait_health',lambda *a,**k:None)
    apimod.api_probe(ctx,{})
    assert not any(k.startswith('api.') for k in metrics.values),'every api metric is unmeasurable'
    assert any(k.startswith('api.') for k in metrics.na),'api metrics must be registered as N/A'
    assert metrics.notes,'the environment defect must be recorded in notes'


def test_real_service_failure_is_still_scored_not_na(tmp_path,monkeypatch):
    """Guard against over-correction: a genuine crash in the model's own code must
    stay a scored failure, so G1 still fires and the run is not excused."""
    import benchlib.probes.api as apimod
    proj=tmp_path/'run'/'output'/'proj';proj.mkdir(parents=True)
    (proj/'bench.json').write_text('{"start": "python3 app.py", "setup": "", "test": "", "health": "/health"}',encoding='utf-8')
    (proj/'app.py').write_text('',encoding='utf-8')
    metrics=Metrics()
    ctx=RunContext(run_dir=tmp_path/'run',meta={},rubric={'deliverable_dir':'proj'},
                   cfg={'external':{}},metrics=metrics)
    def fake_start(self):
        Path(self.log).write_text('Traceback (most recent call last):\n  File "app.py", line 3\nImportError: no module named flask',encoding='utf-8')
    monkeypatch.setattr(apimod.Server,'start',fake_start)
    monkeypatch.setattr(apimod,'_wait_health',lambda *a,**k:None)
    apimod.api_probe(ctx,{})
    assert metrics.values.get('api.started') is False
    assert not metrics.na,'a real crash must remain a scored failure'

@pytest.mark.skipif(os.name!='nt',reason='Windows shell child cleanup')
def test_windows_server_stop_closes_shell_and_child(tmp_path):
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    code=f"from http.server import HTTPServer,BaseHTTPRequestHandler; HTTPServer(('127.0.0.1',{port}),BaseHTTPRequestHandler).serve_forever()"
    server=Server(f'"{sys.executable}" -u -c "{code}"',tmp_path,os.environ.copy(),tmp_path/'server.log')
    server.start()
    def listening():
        with socket.socket() as sock:
            sock.settimeout(.2)
            return sock.connect_ex(('127.0.0.1',port))==0
    try:
        deadline=time.monotonic()+10
        while not listening() and time.monotonic()<deadline:time.sleep(.05)
        assert listening(),'test server failed to bind'
        server.stop()
        assert server.proc.poll() is not None,'server shell is still alive'
        assert not listening(),'server child is still listening after stop'
    finally:
        if server.proc.poll() is None:
            subprocess.run(['taskkill','/PID',str(server.proc.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
            server.proc.wait(timeout=10)
        if not server.fh.closed:server.fh.close()
