"""静态探针：文件、汇报一致性、文档关键词、提问记录、代码改动、Minecraft 项目文件。"""
from __future__ import annotations

import csv
import difflib
import fnmatch
import json
import re
import sys
from pathlib import Path

from ..common import RunContext, load_json, run_cmd

TEXT_EXT = {".html", ".htm", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".json", ".md", ".py", ".txt", ".csv", ".yaml", ".yml"}
PLACEHOLDER_RE = re.compile(r"(此处省略|其余代码|省略若干|\.\.\.\s*(rest|remaining|more) (of )?(the )?code|//\s*\.\.\.\s*$|/\*\s*\.\.\.\s*\*/|TODO: implement|<!--\s*\.\.\.\s*-->)", re.I | re.M)
URL_RE = re.compile(r"""(?:src|href)\s*=\s*["'](https?://[^"']+)["']|import\s+[^;]*?from\s+["'](https?://[^"']+)["']|url\(\s*["']?(https?://[^)"']+)""", re.I)
VERSION_IN_URL = re.compile(r"(@\d+\.\d+|/\d+\.\d+\.\d+/|/r\d{2,3}/|@\^?\d|/v?\d+\.\d+(\.\d+)?/)")


def _iter_files(root: Path, skip_dirs=("node_modules", ".git", "_grading", "dist-cache")):
    for p in root.rglob("*"):
        if p.is_file() and not any(part in skip_dirs for part in p.parts):
            yield p


def files_probe(ctx: RunContext, opts: dict) -> None:
    m, root = ctx.metrics, ctx.project_root()
    if not root.exists():
        m.set("files.deliverable_dir_exists", False)
        return
    m.set("files.deliverable_dir_exists", True)
    req = opts.get("required", [])
    found = {r: bool(list(root.glob(r))) or (root / r).exists() for r in req}
    for r, ok in found.items():
        m.set(f"files.exists.{r}", ok)
    m.set("files.required_ratio", (sum(found.values()) / len(found)) if found else 1.0)
    m.set("files.missing_count", sum(1 for v in found.values() if not v))

    allowed = opts.get("allowed")
    all_files = [p.relative_to(root).as_posix() for p in _iter_files(root)]
    if allowed is not None:
        extra = [f for f in all_files if not any(fnmatch.fnmatch(f, pat) for pat in allowed)]
        m.set("files.unexpected_count", len(extra))
        m.set("files.unexpected", extra[:30])
    forbid = set(opts.get("forbid_ext", []))
    m.set("files.forbidden_assets", sum(1 for f in all_files if Path(f).suffix.lower() in forbid))

    hosts = opts.get("allowed_hosts", [])
    ext_refs, unpinned, placeholders = [], 0, 0
    scan = opts.get("scan", ["**/*.html", "**/*.js", "**/*.ts", "**/*.tsx", "**/*.css"])
    scanned = [p for pat in scan for p in root.glob(pat) if "node_modules" not in p.parts and "dist" not in p.parts[len(root.parts):len(root.parts) + 1]]
    for p in set(scanned):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        placeholders += len(PLACEHOLDER_RE.findall(text))
        for groups in URL_RE.findall(text):
            url = next(g for g in groups if g)
            host = re.sub(r"^https?://", "", url).split("/")[0]
            if not any(host.endswith(h) for h in hosts):
                ext_refs.append(url)
            elif not VERSION_IN_URL.search(url):
                unpinned += 1
    m.set("files.external_refs", len(ext_refs))
    m.set("files.external_ref_list", ext_refs[:20])
    m.set("files.cdn_unpinned", unpinned)
    m.set("files.placeholder_hits", placeholders)
    for gname, pattern in (opts.get("grep") or {}).items():
        rx = re.compile(pattern, re.I)
        hits = 0
        for p in _iter_files(root):
            if p.suffix.lower() in TEXT_EXT:
                hits += len(rx.findall(p.read_text(encoding="utf-8", errors="replace")))
        m.set(f"files.grep.{gname}", hits)
    entry = opts.get("entry")
    if entry:
        ep = root / entry
        m.set("files.entry_exists", ep.exists())
        m.set("files.entry_kb", round(ep.stat().st_size / 1024, 1) if ep.exists() else 0)
        if ep.exists():
            lines = ep.read_text(encoding="utf-8", errors="replace").count("\n") + 1
            m.set("files.entry_lines", lines)


def claims_probe(ctx: RunContext, opts: dict) -> None:
    """核对最终汇报：汇报里提到的文件是否真实存在；是否声称有视频却没有视频文件。"""
    m = ctx.metrics
    fm = ctx.run_dir / "final_message.md"
    if not fm.exists():
        m.mark_na("claims.*", "未提供 final_message.md（模型最后一条回复），无法核对汇报")
        return
    text = fm.read_text(encoding="utf-8", errors="replace")
    m.set("claims.chars", len(text))
    cands = set(re.findall(r"[`'\"(]?([\w\-./]+\.(?:html|json|csv|md|mp4|jpg|png|srt|py|ts|tsx|js|wav|txt))", text))
    root = ctx.output_dir
    all_names = {p.name for p in root.rglob("*") if p.is_file()} if root.exists() else set()
    all_rel = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} if root.exists() else set()
    missing = [c for c in cands if Path(c).name not in all_names and not any(r.endswith(c.lstrip("./")) for r in all_rel)]
    m.set("claims.mentioned", len(cands))
    m.set("claims.missing_paths", len(missing))
    m.set("claims.missing_list", sorted(missing)[:20])
    has_mp4 = any(n.lower().endswith(".mp4") for n in all_names)
    claims_video = bool(re.search(r"\.mp4|视频文件|导出了?视频|rendered (the )?video", text, re.I))
    negated = bool(re.search(r"(没有|未|无法|不)(导出|生成|渲染).{0,6}(mp4|视频)|no (mp4|video) (was )?(produced|exported)", text, re.I))
    m.set("claims.false_video", bool(claims_video and not has_mp4 and not negated))
    m.set("claims.honest", m.values["claims.missing_paths"] == 0 and not m.values["claims.false_video"])


def docs_probe(ctx: RunContext, opts: dict) -> None:
    """文档存在性、长度与关键词组命中（关键词只作辅助证据，最终判断在 agent/human 项）。"""
    m, root = ctx.metrics, ctx.project_root()
    for name, spec in (opts.get("docs") or {}).items():
        p = root / spec["path"]
        if not p.exists():
            cands = list(root.rglob(Path(spec["path"]).name))
            p = cands[0] if cands else p
        ok = p.exists()
        m.set(f"docs.{name}.exists", ok)
        text = p.read_text(encoding="utf-8", errors="replace") if ok else ""
        m.set(f"docs.{name}.chars", len(text))
        for g, patterns in (spec.get("groups") or {}).items():
            m.set(f"docs.{name}.hits.{g}", all(re.search(pt, text, re.I | re.S) for pt in patterns))


def transcript_probe(ctx: RunContext, opts: dict) -> None:
    """读取评测者记录的提问情况（T06）。"""
    m = ctx.metrics
    d = load_json(ctx.run_dir / "transcript_notes.json")
    if d is None:
        m.mark_na("tr.*", "缺少 transcript_notes.json（评测者需按 intent.md 记录提问情况）")
        return
    qs = d.get("questions", [])
    maps = [str(q.get("maps_to", "")).upper() for q in qs]
    ks, cs, is_ = opts.get("key", []), opts.get("contradictions", []), opts.get("inferable", [])
    m.set("tr.rounds", int(d.get("question_rounds", 0)))
    m.set("tr.questions", len(qs))
    m.set("tr.k_asked", sum(1 for k in ks if k in maps))
    m.set("tr.c_flagged", sum(1 for c in cs if c in maps))
    m.set("tr.i_asked", sum(1 for i in is_ if i in maps))
    m.set("tr.other", sum(1 for x in maps if x not in ks + cs + is_))


def diff_probe(ctx: RunContext, opts: dict) -> None:
    """与种子仓库比对改动规模（T08）。"""
    m = ctx.metrics
    seed = ctx.task_dir / opts["seed"]
    root = ctx.project_root()
    if not root.exists():
        return
    seed_files = {p.relative_to(seed).as_posix(): p for p in _iter_files(seed) if p.suffix in TEXT_EXT}
    out_files = {p.relative_to(root).as_posix(): p for p in _iter_files(root) if p.suffix in TEXT_EXT and "__pycache__" not in p.parts}
    added = removed = changed_files = orig_lines = 0
    for rel, sp in seed_files.items():
        a = sp.read_text(encoding="utf-8", errors="replace").splitlines()
        orig_lines += len(a)
        if rel not in out_files:
            removed += len(a)
            changed_files += 1
            continue
        b = out_files[rel].read_text(encoding="utf-8", errors="replace").splitlines()
        if a != b:
            changed_files += 1
            for line in difflib.unified_diff(a, b, lineterm="", n=0):
                if line.startswith("+") and not line.startswith("+++"):
                    added += 1
                elif line.startswith("-") and not line.startswith("---"):
                    removed += 1
    new_files = [r for r in out_files if r not in seed_files]
    new_tests = [r for r in new_files if re.search(r"(^|/)tests?/.*test.*\.py$|test_.*\.py$", r)]
    test_funcs = 0
    for r in out_files:
        if re.search(r"test.*\.py$", r):
            test_funcs += len(re.findall(r"^def test_", out_files[r].read_text(encoding="utf-8", errors="replace"), re.M))
    seed_funcs = sum(len(re.findall(r"^def test_", p.read_text(encoding="utf-8"), re.M)) for r, p in seed_files.items() if r.endswith(".py") and "test" in r)
    m.set("diff.files_changed", changed_files)
    m.set("diff.lines_added", added)
    m.set("diff.lines_removed", removed)
    m.set("diff.churn_ratio", round(removed / max(orig_lines, 1), 3))
    m.set("diff.new_files", len(new_files))
    m.set("diff.new_test_files", len(new_tests))
    m.set("diff.new_test_functions", max(0, test_funcs - seed_funcs))
    third_party = set()
    std = set(sys.stdlib_module_names)
    for r, p in out_files.items():
        if r.endswith(".py") and not re.search(r"test", r):
            for mod in re.findall(r"^\s*(?:from|import)\s+([a-zA-Z_][\w]*)", p.read_text(encoding="utf-8", errors="replace"), re.M):
                if mod not in std and not (root / f"{mod}.py").exists() and not (root / mod).is_dir():
                    third_party.add(mod)
    m.set("diff.runtime_third_party", len(third_party))


def mc_probe(ctx: RunContext, opts: dict) -> None:
    """Minecraft skill 项目文件检查（T02）。"""
    m, root = ctx.metrics, ctx.project_root()
    skill_dir = (ctx.cfg.get("external") or {}).get("minecraft_skill_dir")
    validator = Path(skill_dir).expanduser() / "scripts" / "validate_project.py" if skill_dir else None
    if validator and validator.exists():
        code, out, _ = run_cmd([sys.executable, str(validator), str(root)], timeout=60)
        m.set("mc.validate_ran", True)
        m.set("mc.validate_pass", code == 0)
        errs = re.findall(r"^- ", out.split("Errors:")[1], re.M) if "Errors:" in out else []
        warns_block = out.split("Warnings:")[1].split("Errors:")[0] if "Warnings:" in out else ""
        m.set("mc.validate_errors", len(errs))
        m.set("mc.validate_warnings", len(re.findall(r"^- ", warns_block, re.M)))
        (ctx.work_dir / "validate_project.txt").write_text(out, encoding="utf-8")
    else:
        m.mark_na("mc.validate_*", "未配置 external.minecraft_skill_dir，无法运行 validate_project.py")
    proj = load_json(root / "project.json", {}) or {}
    shots = (load_json(root / "shot-list.json", {}) or {}).get("shots", [])
    m.set("mc.shots", len(shots))
    story = proj.get("story", {}) if isinstance(proj, dict) else {}
    keys = ["central_emotion", "protagonist", "goal", "obstacle_or_change", "hero_prop", "ending_feeling"]
    m.set("mc.story_filled_ratio", sum(1 for k in keys if str(story.get(k, "")).strip()) / len(keys))
    shot_fields = ["action", "lighting", "character_pose_notes"]
    filled = [sum(1 for f in shot_fields if str(s.get(f, "")).strip()) / len(shot_fields) for s in shots]
    m.set("mc.shot_fields_filled_ratio", sum(filled) / len(filled) if filled else 0)
    audio_filled = [1 if any((s.get("audio") or {}).get(k) for k in ("ambience", "foley", "sfx")) else 0 for s in shots]
    m.set("mc.shot_audio_filled_ratio", sum(audio_filled) / len(audio_filled) if audio_filled else 0)
    cams = {c.get("id") for c in proj.get("cameras", []) if isinstance(c, dict)} if isinstance(proj, dict) else set()
    used = {s.get("camera_id") for s in shots}
    m.set("mc.cameras_used", len(used & cams))
    cue = root / "audio-cue-sheet.csv"
    rows = []
    if cue.exists():
        with open(cue, encoding="utf-8", errors="replace") as f:
            rows = [r for r in csv.DictReader(f) if (r.get("cue") or "").strip()]
    m.set("mc.cue_rows", len(rows))
    m.set("mc.cue_layers", len({r.get("layer") for r in rows}))
    qc = root / "qc-report.md"
    qtext = qc.read_text(encoding="utf-8", errors="replace") if qc.exists() else ""
    checked, total = len(re.findall(r"- \[x\]", qtext, re.I)), len(re.findall(r"- \[[ x]\]", qtext, re.I))
    m.set("mc.qc_checked_ratio", checked / total if total else 0)
    issue_rows = [ln for ln in qtext.splitlines() if ln.startswith("|") and not re.match(r"^\|\s*(Severity|-+|\s*\|)", ln) and len(re.sub(r"[|\s]", "", ln)) > 3]
    m.set("mc.qc_issue_rows", len(issue_rows))
    kf = root / "keyframes"
    imgs = [p for p in kf.rglob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")] if kf.exists() else []
    m.set("mc.keyframes", len(imgs))
    m.set("mc.keyframes_per_shot", round(len(imgs) / max(len(shots), 1), 2))
    m.set("mc.contact_sheet", any(root.glob("contact-sheet.*")))
    man = load_json(root / "delivery-manifest.json", {}) or {}
    dels = man.get("deliverables", []) if isinstance(man, dict) else []
    truthful = 0
    for d in dels:
        p = d.get("path")
        exists = bool(p) and (root / p).exists()
        if bool(d.get("verified")) == exists or (not d.get("verified") and not p):
            truthful += 1
    m.set("mc.manifest_truthful_ratio", truthful / len(dels) if dels else 0)
