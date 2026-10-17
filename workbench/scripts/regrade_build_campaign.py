"""Bounded Windows npm-launch repair for already delivered campaign artifacts."""
import hashlib
import os
import shutil
import sys
from pathlib import Path
import psutil
from overnight_runner import ROOT, wb, now, active_grader_for
sys.path.insert(0, str(ROOT / 'skills/bench-grader/scripts'))
from benchlib.common import load_json, dump_json
from benchlib.runs import grade_run

QUEUE = ROOT / 'reports/2026-10-03-official-unattended'
DEST = QUEUE / 'reviews/build-runtime-regrade'


def manual_sha(rd):
    p = rd / 'manual_scores.json'
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def output_sha(rd):
    digest = hashlib.sha256()
    for p in sorted((rd / 'output').rglob('*')):
        if p.is_file():
            digest.update(str(p.relative_to(rd / 'output')).replace('\\', '/').encode())
            digest.update(hashlib.sha256(p.read_bytes()).digest())
    return digest.hexdigest()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    path = DEST / 'state.json'
    old = load_json(path, {})
    if old.get('status') == 'complete':
        print('Completed repair retained'); return
    if old.get('status') == 'running':
        try:
            process = psutil.Process(old['pid'])
            if abs(process.create_time() - old['created_at']) < .01 and Path(process.cwd()).resolve() == ROOT.resolve() and any(Path(a).name == Path(__file__).name for a in process.cmdline()):
                print('Existing worker retained'); return
        except (psutil.NoSuchProcess, KeyError):
            pass
    lock = DEST / 'worker.lock'
    # Exclusive marker prevents simultaneous heartbeat launches. Never replace a live worker's marker.
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        print('Existing worker lock retained'); return
    os.write(fd, str(os.getpid()).encode()); os.close(fd)
    report = old or {'started_at': now(), 'runs': []}
    report.update(status='running', pid=os.getpid(), created_at=psutil.Process().create_time(), cwd=str(ROOT), node_version='v22.23.3', purpose='Only repair evaluator WinError2 npm/npx launch failures; no model tasks reissued')
    dump_json(path, report)
    try:
        campaign = load_json(QUEUE / 'state.json')
        candidates = []
        for row in campaign['runs'].values():
            rid = row.get('run_id')
            if not rid or row['task'] != 'T05' or row['status'] != 'graded': continue
            log = ROOT / 'bench-data/runs' / rid / '_grading/npm_install.log'
            if log.exists() and '[WinError 2]' in log.read_text('utf-8', errors='replace'):
                candidates.append(row)
        candidates.sort(key=lambda row: (row['model_id'] != 'grok-4.7', row['ref']))
        report['candidates'] = [r['run_id'] for r in candidates]; dump_json(path, report)
        changed = []
        for row in candidates:
            rid = row['run_id']; rd = ROOT / 'bench-data/runs' / rid
            entry = next((e for e in report['runs'] if e['run_id'] == rid), None)
            if entry and (entry.get('status') == 'done' or entry.get('attempts', 0) >= 2): continue
            jobs = wb('jobs')
            busy = any(j['kind'] == 'grade' and j['status'] in ['queued', 'running'] and rid in (j.get('subject') or {}).get('run_ids', []) for j in jobs)
            if busy or active_grader_for(rid):
                print('Existing grader retained', rid, flush=True); continue
            backup = DEST / rid; backup.mkdir(exist_ok=True)
            for name in ['metrics.json', 'score.json', '_grading/npm_install.log', '_grading/npm_build.log', '_grading/tsc.log']:
                source = rd / name; target = backup / Path(name).name
                if source.exists() and not target.exists(): shutil.copyfile(source, target)
            if not entry:
                entry = {'run_id': rid, 'ref': row['ref'], 'attempts': 0}; report['runs'].append(entry)
            entry.update(status='grading', attempts=entry['attempts'] + 1, started_at=now(), manual_sha_before=manual_sha(rd), output_sha_before=output_sha(rd), total_before=load_json(rd / 'score.json', {}).get('total'))
            dump_json(path, report); print('Regrading build only', rid, flush=True)
            try:
                score = grade_run(rd, only=['build'])
                entry.update(manual_sha_after=manual_sha(rd), output_sha_after=output_sha(rd))
                if entry['manual_sha_after'] != entry['manual_sha_before'] or entry['output_sha_after'] != entry['output_sha_before']:
                    raise RuntimeError('Artifact or manual score changed concurrently; inspect before further action')
                values = load_json(rd / 'metrics.json')['values']
                if values.get('build.runtime_node') != 'v22.23.3': raise RuntimeError('Target Node not used')
                for filename in ['npm_install.log', 'npm_build.log', 'tsc.log']:
                    if '[WinError 2]' in (rd / '_grading' / filename).read_text('utf-8', errors='replace'): raise RuntimeError('CLI launch still failed')
                entry.update(status='done', finished_at=now(), total_after=score['total'], build_metrics={k:v for k,v in values.items() if k.startswith('build.')})
                changed.append(rid)
                entry['store_sync_job'] = wb('grade', rid, '--skip-graded', '--no-wait', mutation=True)['id']
            except Exception as error:
                entry.update(status='needs_attention', error=str(error), finished_at=now())
            dump_json(path, report)
        report.update(status='complete' if len(report['runs']) == len(candidates) and all(e['status'] == 'done' for e in report['runs']) else 'needs_attention', finished_at=now())
        dump_json(path, report); print(report['status'], 'changed', len(changed), flush=True)
    finally:
        if lock.read_text() == str(os.getpid()): lock.unlink()


if __name__ == '__main__': main()
