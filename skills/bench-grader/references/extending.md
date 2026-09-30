# 扩展题库

## 新增一道题
1. 新建 `tasks/T09-名字/`，放入 `prompt.md`、`rubric.yaml`，需要时加 `materials/` 与 `hidden/`。
2. `rubric.yaml` 字段：

```yaml
id: T09
name: 题目名
short: 一句话说明考什么
deliverable_dir: 模型交付的文件夹名
dims: {ui: 1.0, eng: 0.5}          # 本题对各维度的贡献权重（主要 1.0，次要 0.5）
variants:                            # 可选：A/C 等对照组，各自的 dims
  A: {dims: {...}, desc: ...}
condition: 运行条件说明
materials: [预置素材说明]
time_limit_min: 60
probes:                              # 见 references/probes.md
  - type: browser
    opts: {...}
gates:
  - {id: G1, desc: ..., metric: browser.loaded, rule: {type: bool}, variants: [A]}   # variants 可选
items:
  - {id: T09-U01, dim: ui, tier: basic, method: auto, desc: ..., metric: js.x.y, rule: {type: bool}}
  - id: T09-H01
    dim: ui
    tier: advanced
    method: human                    # 或 agent
    desc: ...
    evidence: 评审依据
    anchors: ["0 档", "1 档", "2 档", "3 档"]
```
3. 运行 `python scripts/bench.py validate-rubrics`，再 `build-spec` 重新生成规范页。
4. 用一份参考作品和一份有缺陷的作品各跑一次 `grade`，确认检查项能区分二者。

## 写检查项的原则
- 一个检查项只测一件事；描述写“做到了什么”，不写“没做到什么”。
- 能用连续值就用 `linear`/`max`/`min` 加 `zero`，不要一刀切。
- 每道题至少安排 2–3 个 excellent 项作为拉开差距的来源。
- 人工项的 4 个锚点要能区分，避免“好/很好/非常好”这类只有程度差别的描述。
- 自定义 JS 指标（browser.js_metrics）写成函数体即可，可用 `await sleep(ms)`；返回对象会展开为 `js.<名>.<键>`。

## 新增探针
在 `scripts/benchlib/probes/` 新增函数 `xxx_probe(ctx, opts)`，写入 `ctx.metrics.set(...)`；评测环境原因无法运行时用 `ctx.metrics.mark_na(前缀, 原因)`。然后在 `probes/__init__.py` 的 REGISTRY 中登记。
