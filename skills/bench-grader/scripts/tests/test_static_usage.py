"""v1.1 勘误：T03A 的 G3 只能统计真实依赖，不能被注释或 window.__hf 的说明文字误伤。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib.probes.static import strip_comments, usage_hits  # noqa: E402

PAT = "hyperframes|remotion"


def test_comment_mentions_do_not_count():
    html = """<html><script>
    // Global API Setup for HyperFrames
    /* HyperFrames Interface Window Object */
    window.__hf = { duration: 15, seek(t) {} };
    </script><!-- built without Remotion --></html>"""
    assert usage_hits(html, PAT, ".html") == 0


def test_url_in_string_is_not_stripped_as_comment():
    html = '<script src="https://cdn.example.com/hyperframes@1.0.0/dist.js"></script>'
    assert usage_hits(html, PAT, ".html") == 1


def test_import_and_require_count():
    js = 'import { Composition } from "remotion";\nconst hf = require("@hyperframes/core");'
    assert usage_hits(js, PAT, ".js") == 2


def test_cli_commands_count():
    assert usage_hits("run `npx hyperframes render` first", PAT, ".md") == 1
    assert usage_hits("# npx remotion render\nprint(1)", PAT, ".py") == 0  # commented out


def test_package_json_dependencies_count():
    pkg = json.dumps({"dependencies": {"remotion": "^4.0.0", "gsap": "3.12.5"}})
    assert usage_hits(pkg, PAT, ".json") == 1


def test_strip_comments_keeps_code():
    code = "const a = 1; // trailing\nconst url = 'https://x.y/z';"
    out = strip_comments(code, ".js")
    assert "const a = 1;" in out and "https://x.y/z" in out and "trailing" not in out
