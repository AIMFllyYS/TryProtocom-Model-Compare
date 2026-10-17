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
