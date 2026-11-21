"""独立审计回归：只使用虚构日志和临时目录，不调用模型或旧评分器。"""
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


@pytest.fixture
def audit_module():
    assert (SCRIPTS / 'benchlib/context_audit.py').is_file(), '独立审计尚未实现'
    return importlib.import_module('benchlib.context_audit')


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def case(tmp_path, audit_module):
    a = audit_module
    ref = 'Fixture/中文 Model/B1/r1'
    ws = tmp_path / 'model' / ref
    ws.mkdir(parents=True)
    subprocess.run(['git', 'init', '-q', str(ws)], check=True)
    raw = b'legacy task\r\n  unchanged\r\n'
    prompt = a.POLICY_BLOCK + raw
    meta = dict(ref=ref, task='B1', variant=None, model='中文 Model', vendor='Fixture',
                created_at='2026-01-01T00:00:00Z', started_at='2026-01-01T00:00:01Z',
                ended_at='2026-01-01T00:10:00Z', grader_run_id='B1-fixture',
                context_policy=dict(version=a.POLICY_VERSION, policy_sha256=sha(a.POLICY_BLOCK),
                    base_prompt_sha256=sha(raw), prompt_sha256=sha(prompt), task_prompt_sha256=sha(raw),
                    insertion=dict(offset=0, byte_length=len(a.POLICY_BLOCK)), header_enabled=False,
                    skills=dict(mode='none', names=[], roots=[], status='not_applicable', files={})))
    put(ws.with_suffix('.run.json'), meta)
    ws.with_suffix('.prompt.md').write_bytes(prompt)
    put(tmp_path / 'bench-data/runs/B1-fixture/meta.json', dict(workspace=str(ws), extra=dict(ws_ref=ref)))
    return a.Repository(tmp_path), ref, ws, meta


def log(ws, events, suffix='.codex.jsonl'):
    p = ws.with_suffix(suffix)
    p.write_text('\n'.join(json.dumps(e, ensure_ascii=False) for e in events) + '\n', encoding='utf-8-sig')
    return p


def call(path, result='another run solution', **kw):
    return dict(type='tool', name='read_file', arguments=dict(path=path), result=result, status='success', **kw)


def directory_link(link, target):
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        if os.name != 'nt':
            pytest.skip('当前环境不允许创建符号链接')
        proc = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(target)], capture_output=True)
        assert proc.returncode == 0, '无法创建隔离目录联接测试夹具'


def record_scandir(monkeypatch):
    original, seen = os.scandir, []
    def recording(path='.'):
        seen.append(Path(path).absolute())
        return original(path)
    monkeypatch.setattr(os, 'scandir', recording)
    return seen


def test_policy_frozen_matches_typescript(audit_module):
    source = (SCRIPTS.parents[2] / 'workbench/shared/context-policy.ts').read_text('utf-8')
    body = source.split('export const CONTEXT_POLICY_BLOCK = `', 1)[1].split('`;', 1)[0]
    body = body.replace('${CONTEXT_POLICY_START}', audit_module.POLICY_START).replace('${CONTEXT_POLICY_END}', audit_module.POLICY_END)
    assert body.encode() == audit_module.POLICY_BLOCK


def test_preflight_readonly_and_git_root(case):
    repo, ref, ws, meta = case
    before = {p: p.read_bytes() for p in ws.parent.glob('r1.*')}
    r = repo.preflight(ref)
    assert r['prompt']['status'] == 'pass'
    assert r['workspace']['status'] == 'pass'
    assert r['skills']['status'] == 'pass'
    assert not (repo.data / 'context-audits').exists()
    assert before == {p: p.read_bytes() for p in before}
    ws.with_suffix('.prompt.md').write_bytes(b'damaged')
    assert repo.preflight(ref)['prompt']['status'] == 'error'
    # 一个普通目录不是已验证的 Git 根。
    other = ws.parent / 'r2'
    other.mkdir()
    put(other.with_suffix('.run.json'), {**meta, 'ref': ref[:-1] + '2'})
    other.with_suffix('.prompt.md').write_bytes(b'legacy')
    assert repo.preflight(ref[:-1] + '2')['workspace']['status'] == 'error'


def test_paths_and_no_url_overdecode(case, audit_module):
    repo, ref, ws, _ = case
    own = 'D:/bench/model/Fixture/中文 Model/B1/r1'
    norm = audit_module.normalize_path
    assert norm('file:///D:/bench/model/Fixture/%E4%B8%AD%E6%96%87%20Model/B1/r1/a') == norm(own + '/a')
    assert norm('D:/literal%20name') != norm('D:/literal name')
    assert audit_module.within(own + '/a', own)
    assert not audit_module.within(own + '0/a', own)
    log(ws, [call(str(ws / 'index.html')), call(str(ws.parent / 'r2/index.html')),
             call((ws / 'with space.html').as_uri())])
    r = repo.audit(ref)
    assert len(r['findings']) == 1
    assert r['findings'][0]['finding_kind'] == 'other_run'
    assert r['findings'][0]['observation'] == 'obtained'


def test_memory_read_failed_mention_compound_and_self_report(case):
    repo, ref, ws, _ = case
    log(ws, [call('C:/Users/fiction/.codex/memories/MEMORY.md'),
             call('C:/Users/fiction/.codex/memories/denied.md', result='Permission denied', status_code=403),
             dict(type='tool', name='shell', arguments={'command': "cat '/memory/MEMORY.md'; echo ok"}, result='ok', exit_code=0),
             dict(type='assistant', text='只看到 skills 目录名称'),
             dict(type='assistant', text='意外读取了历史任务信息，未声称已经清除污染')])
    r = repo.audit(ref)
    assert any(f['finding_kind'] == 'memory' and f['observation'] == 'obtained' for f in r['findings'])
    assert any(f['observation'] == 'failed' for f in r['findings'])
    assert any(f['observation'] == 'attempt' for f in r['findings'])
    assert any(f['finding_kind'] == 'self_report' for f in r['findings'])
    assert all(f['review_state'] == 'pending' for f in r['findings'])
    assert 'another run solution' not in json.dumps(r)


def test_codex_native_pairing_and_sent_prompt(case):
    repo, ref, ws, _ = case
    prompt = ws.with_suffix('.prompt.md').read_bytes().decode()
    events = [dict(type='session_meta', payload=dict(id='s1', cwd=str(ws))),
              dict(type='response_item', payload=dict(type='message', role='user', content=[dict(type='input_text', text=prompt)])),
              dict(type='response_item', payload=dict(type='function_call', name='read_file', call_id='c1', arguments=json.dumps({'path': '/memory/MEMORY.md'}))),
              dict(type='response_item', payload=dict(type='function_call_output', call_id='c1', output='history task result')),
              dict(type='event_msg', payload=dict(type='task_complete'))]
    p = log(ws, events)
    log(ws, events, '.session.jsonl')
    r = repo.audit(ref, logs=[p, ws.with_suffix('.session.jsonl')])
    assert len(r['findings']) == 1
    assert r['prompt_provenance']['sent'] == 'verified'
    assert r['coverage']['tools'] == 'parseable'
    assert r['coverage']['initial_context'] == 'unknown'


def test_agy_pairing_and_missing_result(case):
    repo, ref, ws, _ = case
    log(ws, [dict(type='init', cwd=str(ws), conversation_id='s1'),
             dict(step_update=dict(step_index=2, step_type='tool', state='ACTIVE', tool_name='read_file', tool_input=dict(path='/memory/MEMORY.md'))),
             dict(step_update=dict(step_index=2, step_type='tool', state='DONE', tool_name='read_file', tool_output='task history')),
             dict(step_update=dict(step_index=3, step_type='tool', state='ACTIVE', tool_name='read_file', tool_input=dict(path='/memory/second.md')))], '.agy.jsonl')
    r = repo.audit(ref)
    assert len(r['findings']) == 2
    assert {f['observation'] for f in r['findings']} == {'attempt', 'obtained'}
    assert r['coverage']['tools'] == 'partial'


def test_unsupported_truncated_long_and_mismatch(case):
    repo, ref, ws, _ = case
    p = log(ws, [dict(type='init', cwd=str(ws.parent / 'r9')), call('/memory/MEMORY.md')])
    r = repo.audit(ref)
    assert r['coverage']['tools'] == 'partial'
    assert not r['findings']
    assert any(s['association'] == 'mismatch' for s in r['sources'])
    p.write_bytes(b'{"unknown":true}\n{"partial"')
    r = repo.audit(ref)
    assert r['coverage']['tools'] == 'partial'
    p.write_bytes(b'x' * (2 * 1024 * 1024) + b'\n')
    assert repo.audit(ref)['coverage']['tools'] == 'partial'


def test_skills_services_and_legacy_no_retroactive_penalty(case):
    repo, ref, ws, meta = case
    log(ws, [call('C:/Users/fiction/skills/unapproved/SKILL.md'),
             dict(type='tool', name='browser', arguments=dict(url='http://localhost:3000'), result='own app', status='success'),
             dict(type='tool', name='browser', arguments=dict(url='http://localhost:41873/api/store'), result='data', status='success'),
             dict(type='tool', name='list_tabs', arguments={}, result='other task title', status='success')])
    r = repo.audit(ref)
    assert {f['finding_kind'] for f in r['findings']} == {'unauthorized_skill', 'evaluation_data'}
    meta.pop('context_policy')
    put(ws.with_suffix('.run.json'), meta)
    ws.with_suffix('.prompt.md').write_bytes(b'legacy')
    r = repo.audit(ref)
    assert any(f['finding_kind'] == 'auxiliary_skill' and f['policy_applicability'] == 'historical_observation' for f in r['findings'])


def test_save_review_staleness_and_zero_score_writes(case):
    repo, ref, ws, _ = case
    p = log(ws, [call('/memory/MEMORY.md')])
    score = repo.data / 'runs/B1-fixture/score.json'
    put(score, {'total': 88})
    before = score.read_bytes()
    r = repo.audit(ref, save=True)
    fid = r['findings'][0]['id']
    repo.review(ref, fid, 'dismissed', '虚构误报', save=True)
    loaded = repo.latest(ref)
    assert loaded['findings'][0]['review_state'] == 'dismissed'
    p.write_text(p.read_text('utf-8-sig') + '{}\n', encoding='utf-8')
    assert repo.latest(ref)['stale'] is True
    assert score.read_bytes() == before
    assert not list(ws.parent.glob('r1.context*'))
    assert repo.latest('B1-fixture')['ref'] == ref


def test_link_snapshot_is_unknown(case):
    repo, ref, ws, meta = case
    outside = ws.parent / 'outside'
    outside.mkdir()
    (outside / 'SKILL.md').write_text('private', encoding='utf-8')
    try:
        (ws / 'linked').symlink_to(outside, target_is_directory=True)
    except OSError:
        if os.name != 'nt':
            pytest.skip('当前环境不允许创建符号链接')
        proc = subprocess.run(['cmd', '/c', 'mklink', '/J', str(ws / 'linked'), str(outside)], capture_output=True)
        assert proc.returncode == 0, '无法创建隔离目录联接测试夹具'
    meta['context_policy']['skills'] = dict(mode='provided', names=['fixture'], roots=['linked'], status='recorded', files={'linked/SKILL.md': sha(b'private')})
    put(ws.with_suffix('.run.json'), meta)
    assert repo.preflight(ref)['skills']['status'] != 'pass'


def test_concatenated_sessions_not_attributed_to_last_cwd(case):
    repo, ref, ws, _ = case
    log(ws, [dict(type='session_meta', payload={'id': 'other', 'cwd': str(ws.parent / 'r9')}),
             call('/memory/MEMORY.md'), dict(type='session_meta', payload={'id': 'this', 'cwd': str(ws)})])
    r = repo.audit(ref)
    assert r['findings'] == []
    assert r['coverage']['tools'] == 'partial'
    assert r['sources'][0]['association'] == 'mismatch'


def test_late_skill_snapshot_and_redaction(case, audit_module):
    repo, ref, ws, meta = case
    skill = ws / 'skills/fixture/SKILL.md'
    skill.parent.mkdir(parents=True)
    skill.write_bytes(b'fixed')
    meta['context_policy']['skills'] = dict(mode='provided', names=['fixture'], roots=['skills/fixture'], status='recorded',
        files={'skills/fixture/SKILL.md': sha(b'fixed')}, captured_at='2026-01-02T00:00:00Z')
    put(ws.with_suffix('.run.json'), meta)
    assert repo.preflight(ref)['skills']['status'] == 'unknown'
    value = audit_module.redact('Authorization: Bearer secret123; {"token": "private456"}')
    assert 'secret123' not in value and 'private456' not in value


def test_shell_echo_cd_and_pipeline_not_successful_reads(case):
    repo, ref, ws, _ = case
    log(ws, [dict(type='tool', name='shell', arguments={'command': 'cd ../'}, result='ok', exit_code=0),
             dict(type='tool', name='shell', arguments={'command': "echo 'cat /memory/MEMORY.md'"}, result='cat /memory/MEMORY.md', exit_code=0),
             dict(type='tool', name='shell', arguments={'command': 'cat /memory/MEMORY.md | echo ok'}, result='ok', exit_code=0)])
    r = repo.audit(ref)
    assert [f['observation'] for f in r['findings']] == ['mention', 'attempt']


def test_unknown_port_not_assumed_workbench(case):
    repo, ref, ws, _ = case
    log(ws, [dict(type='tool', name='browser', arguments={'url': 'http://127.0.0.1:39991/api/store'}, result='own app', status='success')])
    assert repo.audit(ref)['findings'] == []


def test_named_skill_invocation_and_injected_catalogue(case):
    repo, ref, ws, meta = case
    log(ws, [dict(type='tool', name='Skill', arguments={'skill': 'personal-skill'}, result='full skill body'),
             dict(type='system', text='可用技能列表：C:/global/skills/personal-skill/SKILL.md，仅显示名称')])
    r = repo.audit(ref)
    assert len(r['findings']) == 1
    assert r['findings'][0]['finding_kind'] == 'unauthorized_skill'
    assert r['findings'][0]['target'] == 'personal-skill'


def test_operator_role_and_delegated_request(case):
    repo, ref, ws, _ = case
    log(ws, [call('/memory/MEMORY.md', role='operator'),
             dict(type='tool', name='Agent', arguments={'prompt': 'read /memory/MEMORY.md'}, result='done')])
    r = repo.audit(ref)
    assert len(r['findings']) == 1
    assert r['findings'][0]['observation'] == 'attempt'


def test_agy_commandline_compound_is_attempt(case):
    repo, ref, ws, _ = case
    log(ws, [dict(step_update=dict(step_index=1, step_type='tool', state='ACTIVE', tool_name='run_command', tool_input={'CommandLine': 'cat /memory/MEMORY.md; echo ok'})),
             dict(step_update=dict(step_index=1, step_type='tool', state='DONE', tool_output='ok'))], '.agy.jsonl')
    assert repo.audit(ref)['findings'][0]['observation'] == 'attempt'


def test_declared_local_skill_pending_snapshot_not_unauthorized(case):
    repo, ref, ws, meta = case
    meta['context_policy']['skills'] = dict(mode='provided', names=['fixture'], roots=[], status='pending')
    put(ws.with_suffix('.run.json'), meta)
    log(ws, [call(str(ws / '.agents/skills/fixture/SKILL.md')), call('C:/global/skills/fixture/SKILL.md')])
    r = repo.audit(ref)
    assert [f['finding_kind'] for f in r['findings']] == ['unauthorized_skill']
    assert r['preflight']['skills']['status'] == 'unknown'


def test_recorded_session_requires_positive_association(case, tmp_path):
    repo, ref, ws, meta = case
    external = tmp_path / 'explicit-session.jsonl'
    external.write_text(json.dumps(call('/memory/MEMORY.md')), encoding='utf-8')
    meta['usage'] = {'log_files': [str(external)]}
    put(ws.with_suffix('.run.json'), meta)
    r = repo.audit(ref)
    assert not r['findings']
    assert r['sources'][0]['association'] == 'unknown'
    prompt = ws.with_suffix('.prompt.md').read_bytes().decode()
    external.write_text('\n'.join(json.dumps(x) for x in [dict(type='init', cwd=str(ws)), dict(type='user', text=prompt), call('/memory/MEMORY.md')]), encoding='utf-8')
    assert repo.audit(ref)['findings']


def test_distinct_idless_reads_not_deduplicated_within_log(case):
    repo, ref, ws, _ = case
    log(ws, [call('/memory/MEMORY.md'), call('/memory/MEMORY.md')])
    assert len(repo.audit(ref)['findings']) == 2


def test_unrelated_preference_is_not_confirmed_and_shared_write_visible(case):
    repo, ref, ws, _ = case
    log(ws, [dict(type='system', text='用户偏好简洁回答；可用技能目录 skills'),
             dict(type='tool', name='UpdateMemory', arguments={'content': 'fictional'}, result='saved')])
    r = repo.audit(ref)
    assert [f['finding_kind'] for f in r['findings']] == ['shared_memory_write']
    assert r['findings'][0]['review_state'] == 'pending'
    assert r['coverage']['initial_context'] == 'visible_partial'


def test_prompt_and_metadata_changes_expire_saved_report(case):
    repo, ref, ws, meta = case
    log(ws, [call('/memory/MEMORY.md')])
    repo.audit(ref, save=True)
    ws.with_suffix('.prompt.md').write_bytes(b'changed')
    assert repo.latest(ref)['stale']


def test_native_wrong_initial_prompt_cannot_be_verified_by_later_match(case):
    repo, ref, ws, _ = case
    prompt = ws.with_suffix('.prompt.md').read_bytes().decode()
    log(ws, [dict(type='init', cwd=str(ws)), dict(type='user', text='different task'), dict(type='user', text=prompt)])
    assert repo.audit(ref)['prompt_provenance']['sent'] == 'different'


def test_unknown_format_retains_only_candidate_not_execution(case):
    repo, ref, ws, _ = case
    p = ws.with_suffix('.log')
    p.write_text('unrecognized read /memory/MEMORY.md\n', encoding='utf-8')
    r = repo.audit(ref)
    assert r['coverage']['tools'] == 'partial'
    assert r['findings'][0]['observation'] == 'mention'


def test_mcp_error_and_dynamic_shell_are_not_obtained(case):
    repo, ref, ws, _ = case
    log(ws, [call('/memory/MEMORY.md', result={'isError': True, 'content': [{'text': 'no'}]}),
             dict(type='tool', name='shell', arguments={'command': 'cat $HOME/.codex/memories/MEMORY.md'}, result='some data', exit_code=0)])
    r = repo.audit(ref)
    assert {f['observation'] for f in r['findings']} == {'failed', 'attempt'}
    assert r['coverage']['tools'] == 'partial'


def test_listing_skill_names_and_returned_commands_not_executed(case):
    repo, ref, ws, _ = case
    log(ws, [dict(type='tool', name='Glob', arguments={'path': 'C:/global/skills'}, result='one/SKILL.md'),
             call(str(ws / 'README.md'), result='cat /memory/MEMORY.md')])
    assert repo.audit(ref)['findings'] == []


def test_metadata_identity_and_unknown_policy(case):
    repo, ref, ws, meta = case
    meta['task'] = 'B2'
    put(ws.with_suffix('.run.json'), meta)
    assert repo.preflight(ref)['workspace']['status'] == 'error'
    meta.pop('context_policy')
    put(ws.with_suffix('.run.json'), meta)
    assert repo.preflight(ref)['policy_version'] == 'unknown'


def test_wb_cli_offline_without_service(case):
    repo, ref, ws, _ = case
    import shutil
    grader = repo.root / 'skills/bench-grader'
    grader.mkdir(parents=True)
    (grader / 'SKILL.md').write_text('fixture')
    for file in ('audit_context.py', 'benchlib/context_audit.py', 'benchlib/context_logs.py'):
        dst = grader / 'scripts' / file
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SCRIPTS / file, dst)
    wb = SCRIPTS.parents[2] / 'workbench/dist-node/wb.cjs'
    proc = subprocess.run(['node', str(wb), 'context', 'audit', ref, '--json'], env={**os.environ, 'WB_ROOT': str(repo.root), 'WB_PYTHON': sys.executable}, capture_output=True, text=True, encoding='utf-8', timeout=30)
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)['ref'] == ref
    assert not (repo.root / 'workbench').exists()
    assert not (repo.root / '.agents').exists()
    assert not (repo.data / 'context-audits').exists()


def test_all_targets_never_enumerates_linked_model_directory(case, monkeypatch):
    repo, ref, _, _ = case
    outside = repo.root / 'outside-model'
    put(outside / 'Hidden Model/B1/r9.run.json', dict(grader_run_id='hidden-run'))
    link = repo.model / 'LinkedVendor'
    directory_link(link, outside)
    scanned = record_scandir(monkeypatch)

    assert repo.all_targets() == [ref]
    assert not any(p == link or link in p.parents or p == outside or outside in p.parents for p in scanned), scanned


def test_all_targets_never_enumerates_linked_run_directory(case, monkeypatch):
    repo, ref, _, _ = case
    outside = repo.root / 'outside-runs'
    put(outside / 'meta.json', dict(run_id='hidden-run'))
    link = repo.data / 'runs' / 'linked-run'
    directory_link(link, outside)
    scanned = record_scandir(monkeypatch)

    assert repo.all_targets() == [ref]
    assert not any(p == link or link in p.parents or p == outside or outside in p.parents for p in scanned), scanned


def test_cli_readonly_and_all_excludes_discarded(case):
    repo, ref, ws, meta = case
    script = SCRIPTS / 'audit_context.py'
    assert script.is_file()
    result = subprocess.run([sys.executable, '-B', str(script), '--root', str(repo.root), 'audit', '--all', '--json'], capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stderr
    assert len(json.loads(result.stdout)) == 1
    assert not (repo.data / 'context-audits').exists()
    meta['discarded'] = {'at': 'now'}
    put(ws.with_suffix('.run.json'), meta)
    assert repo.all_targets() == []


if __name__ == '__main__':
    # 验证前后只计算既有题目/评分/存档的哈希，基线仅写测试 runtime。
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['snapshot', 'verify'])
    args = p.parse_args()
    root = SCRIPTS.parents[2]
    manifest = root / 'workbench/.runtime/context-protected-baseline.json'
    patterns = ['skills/bench-grader/tasks/*/prompt.md', 'skills/bench-grader/tasks/*/rubric.yaml',
                'model/*/*/*/r*.prompt.md', 'model/*/*/*/r*.run.json',
                'bench-data/runs/*/score.json', 'bench-data/runs/*/metrics.json',
                'workbench/.runtime/**/STOP', 'scratch/**/STOP', 'reports/**/STOP']
    current = {str(f.relative_to(root)): sha(f.read_bytes()) for pattern in patterns for f in root.glob(pattern) if f.is_file() and not f.is_symlink()}
    if args.mode == 'snapshot':
        put(manifest, current)
    else:
        baseline = json.loads(manifest.read_text('utf-8'))
        changes = [f for f in set(baseline) | set(current) if baseline.get(f) != current.get(f)]
        assert not changes, changes
    print(json.dumps(dict(mode=args.mode, protected_files=len(current), unchanged=args.mode == 'verify')))
