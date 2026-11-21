#!/usr/bin/env python3
"""离线入口；不启动工作台、harness、同步、评分或模型 API。"""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from benchlib.context_audit import Repository


def main(argv=None):
    p = argparse.ArgumentParser(description='独立上下文审计（默认只读，不证明上下文干净）')
    p.add_argument('--root', default=os.environ.get('WB_ROOT', str(Path(__file__).resolve().parents[3])))
    p.add_argument('--data', default=os.environ.get('WB_BENCH_DATA'))
    p.add_argument('--model-dir', default=os.environ.get('WB_MODEL_DIR'))
    sub = p.add_subparsers(dest='command', required=True)
    for name in ('preflight', 'audit', 'review', 'export'):
        cmd = sub.add_parser(name)
        cmd.add_argument('target', nargs='?')
        cmd.add_argument('--json', action='store_true')
        if name in {'audit', 'export'}:
            cmd.add_argument('--all', action='store_true')
        if name == 'audit':
            cmd.add_argument('--log', action='append')
        if name in {'audit', 'review'}:
            cmd.add_argument('--save', action='store_true')
        if name == 'review':
            cmd.add_argument('--finding', required=True)
            cmd.add_argument('--decision', choices=['confirmed', 'dismissed'], required=True)
            cmd.add_argument('--note', required=True)
        if name == 'export':
            cmd.add_argument('--format', choices=['json', 'csv'], default='json')
    a = p.parse_args(argv)
    root = Path(a.root).absolute()
    resolve = lambda value: root / value if value else None
    repo = Repository(root, resolve(a.data), resolve(a.model_dir))
    if not a.target and not getattr(a, 'all', False):
        p.error('需要 ref / run_id 或 --all')
    if a.target and getattr(a, 'all', False):
        p.error('target 与 --all 不能同时使用')
    if getattr(a, 'log', None) and getattr(a, 'all', False):
        p.error('--log 必须明确指定单个运行')
    targets = repo.all_targets() if getattr(a, 'all', False) else [a.target]
    outputs = []
    for target in targets:
        try:
            if a.command == 'preflight':
                value = repo.preflight(target)
            elif a.command == 'audit':
                value = repo.audit(target, a.log, a.save)
            elif a.command == 'review':
                value = repo.review(target, a.finding, a.decision, a.note, a.save)
            else:
                value = repo.latest(target) or dict(target=target, coverage=dict(tools='missing'), note='独立报告未保存或证据不可用')
            outputs.append(value)
        except (OSError, ValueError) as exc:
            outputs.append(dict(target=target, error=str(exc)))
    if a.command == 'export' and a.format == 'csv':
        stream = io.StringIO(newline='')
        writer = csv.writer(stream)
        writer.writerow(['ref', 'run_id', 'policy_version', 'coverage', 'sent_prompt', 'pending_count', 'stale', 'finding_id', 'finding_kind', 'observation', 'review_state'])
        def safe(value):
            s = str(value if value is not None else '')
            return "'" + s if s.startswith(('=', '+', '-', '@', '\t', '\r')) else s
        for r in outputs:
            for f in r.get('findings') or [{}]:
                writer.writerow(map(safe, [r.get('ref', r.get('target')), r.get('run_id'), r.get('policy_version'), r.get('coverage', {}).get('tools'),
                    r.get('prompt_provenance', {}).get('sent'), r.get('pending_count'), r.get('stale'), f.get('id'), f.get('finding_kind'), f.get('observation'), f.get('review_state')]))
        print(stream.getvalue(), end='')
    else:
        print(json.dumps(outputs if getattr(a, 'all', False) else outputs[0], ensure_ascii=False, indent=2))
    return 1 if any('error' in x or a.command == 'preflight' and x.get('blocking') for x in outputs) else 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
