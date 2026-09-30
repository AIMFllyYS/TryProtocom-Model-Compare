"""回归测试：最终汇报核对（claims）不能把代码块、URL、库名和 FINAL_MESSAGE.md 当成“谎报的文件”。

运行：python -m pytest scripts/tests -q（在 bench-grader 目录下）
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib.probes.static import _claimed_paths  # noqa: E402

REPORT = """已生成 [pelican-bike/index.html](D:/runs/r1/pelican-bike/index.html)，基于 Three.js 与 Node.js。
本回复已保存至 [FINAL_MESSAGE.md](D:/runs/r1/FINAL_MESSAGE.md)。依赖 https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js
完整代码如下：

```html
<script type="module">import('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js'); // see util/helpers.js</script>
```
"""


def test_code_blocks_urls_and_library_names_are_not_claims():
    got = _claimed_paths(REPORT)
    assert "Three.js" not in got and "Node.js" not in got
    assert not any("three.module.js" in c or c.endswith("cdn.js") for c in got)
    assert "util/helpers.js" not in got  # 只出现在代码块里
    assert "pelican-bike/index.html" in got


def test_real_claims_are_still_extracted():
    got = _claimed_paths("已导出 out/demo.mp4 与 `src/app.ts`，报告见 D:\\work\\report.md。")
    assert {"out/demo.mp4", "src/app.ts"} <= got
    assert any(c.endswith("report.md") for c in got)
