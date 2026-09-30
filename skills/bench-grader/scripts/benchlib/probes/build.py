"""前端工程探针：从零复现构建、类型检查、单文件产物、依赖白名单、类型质量。"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from ..common import RunContext, run_cmd, which


def build_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    root = ctx.project_root()
    pkg = root / "package.json"
    if not pkg.exists():
        m.set("build.package_json", False)
        return
    m.set("build.package_json", True)
    lock = any((root / n).exists() for n in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock"))
    m.set("build.lockfile", lock)
    data = json.loads(pkg.read_text(encoding="utf-8"))
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    allow = set(opts.get("allowed_deps", []))
    prefixes = tuple(opts.get("allowed_prefixes", ["@types/"]))
    bad = [d for d in deps if d not in allow and not d.startswith(prefixes)]
    m.set("build.dep_violations", len(bad))
    m.set("build.dep_violation_list", bad)
    tsconfig = next((p for p in (root / "tsconfig.json", root / "tsconfig.app.json") if p.exists()), None)
    strict = False
    if tsconfig:
        raw = re.sub(r"//.*|/\*.*?\*/", "", tsconfig.read_text(encoding="utf-8"), flags=re.S)
        strict = bool(re.search(r'"strict"\s*:\s*true', raw))
    m.set("build.ts_strict", strict)
    src = [p for p in root.rglob("*") if p.suffix in (".ts", ".tsx") and "node_modules" not in p.parts and "dist" not in p.parts]
    text = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in src)
    m.set("build.ts_files", len(src))
    m.set("build.any_count", len(re.findall(r":\s*any\b|as\s+any\b|<any>", text)))
    m.set("build.ts_ignore", len(re.findall(r"@ts-ignore|@ts-nocheck|@ts-expect-error", text)))

    dist = root / opts.get("dist", "dist")
    idx = dist / "index.html"
    m.set("build.dist_index", idx.exists())
    if dist.exists():
        files = [p for p in dist.rglob("*") if p.is_file()]
        m.set("build.dist_files", len(files))
        m.set("build.dist_single", len(files) == 1 and idx.exists())
    if idx.exists():
        m.set("build.dist_mb", round(idx.stat().st_size / 1024 / 1024, 2))

    if not which("npm"):
        m.mark_na("build.install_ok", "评测机没有 npm")
        m.mark_na("build.rebuild_ok", "评测机没有 npm")
        m.mark_na("build.tsc_errors", "评测机没有 npm")
        return
    wd = ctx.work_dir / "rebuild"
    if wd.exists():
        shutil.rmtree(wd)
    shutil.copytree(root, wd, ignore=shutil.ignore_patterns("node_modules", "dist", ".git"))
    cmd = ["npm", "ci", "--no-audit", "--no-fund"] if (wd / "package-lock.json").exists() else ["npm", "install", "--no-audit", "--no-fund"]
    code, out, secs = run_cmd(cmd, cwd=wd, timeout=900)
    (ctx.work_dir / "npm_install.log").write_text(out, encoding="utf-8")
    if code != 0 and re.search(r"ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|403 Forbidden", out, re.I):
        m.mark_na("build.install_ok", "评测机无法访问 npm registry")
        m.mark_na("build.rebuild_ok", "评测机无法访问 npm registry")
        m.mark_na("build.tsc_errors", "评测机无法访问 npm registry")
        return
    m.set("build.install_ok", code == 0)
    code, out, secs = run_cmd(["npm", "run", "build"], cwd=wd, timeout=900)
    (ctx.work_dir / "npm_build.log").write_text(out, encoding="utf-8")
    m.set("build.rebuild_ok", code == 0 and (wd / opts.get("dist", "dist") / "index.html").exists())
    m.set("build.build_s", round(secs, 1))
    code, out, _ = run_cmd(["npx", "--no-install", "tsc", "--noEmit", "-p", "."], cwd=wd, timeout=600)
    (ctx.work_dir / "tsc.log").write_text(out, encoding="utf-8")
    errs = len(re.findall(r"error TS\d+", out))
    m.set("build.tsc_errors", errs if (errs or code == 0) else 99)
