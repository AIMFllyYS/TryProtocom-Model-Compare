# 运行协议

## 通用
- 参赛者 = 模型 @ harness。默认首轮每个参赛者每题/条件跑 `runs_per_task`（默认 1）次，每次从干净工作目录开始。
- 先完成 A 模型 T01–T08 的首轮，再切换 B 模型，按候选模型清单依次覆盖。T03 的 A、C 两个对照条件各跑一次，因此每模型首轮共 9 次启动。
- 只有全部候选模型首轮完成，或者用户明确指定某个模型做完整三次测评时，才补第二、第三次采样。低分也计作有效样本，不因效果不好自动重跑。
- 已有有效正式样本可复用为首轮覆盖；既有第二、第三次样本保留。人工/Agent 待评分不阻止下一模型启动，但不能将待评分报告称为完整验收。
- 首轮报告注明单样本；三次采样的统计要求仍作为后续阶段，不宣称已经完成。
- 固定：harness 版本、工具集、依赖版本、Chromium 版本、评测机。记录在运行的 `--extra` 里（如 `{"harness_version": "…"}`）。
- 时间上限见各题 `time_limit_min`；超时的运行登记时加 `--extra '{"timed_out": true}'`，仍然评分，失败归因记“超时”。
- 无人值守题目：不回答模型提问，模型停下等待即视为结束。
- 把模型最后一条回复保存为文本文件，登记时通过 `--final-message` 传入。

## 各题准备
| 题 | 工作目录预置 | 特殊说明 |
|---|---|---|
| T01 | 无 | 单文件 HTML |
| T02 | `skills/minecraft-stop-motion-director/`（用户提供的 skill 包） | 评测机配置 `external.minecraft_skill_dir` 以运行 validate_project.py |
| T03 | `assets/`（copy.md、bgm.wav、beats.json，来自 `materials/assets`） | A 组：环境中不得有动画/视频 skill，禁止 `npx skills add`；C 组：预装固定版本 HyperFrames + 官方 skills。两组同一 brief |
| T04 | `assets/`（事实表、bgm-a/b、sfx） | 预装 HyperFrames + skills 与统一 TTS 命令，替换提示词中的 `{TTS_COMMAND}` |
| T05 | 无 | 需要能访问 npm 源 |
| T06 | 无 | 有人值守（见下） |
| T07 | 无 | 评测机需有 Node 22 与 Python 3.11 |
| T08 | `studyspot-legacy/`（复制自 `materials/studyspot-legacy`） | 不要附带任何提示缺陷位置的信息 |

素材生成：`python scripts/build_materials.py`（确定性输出，所有模型相同）。

## T06 有人值守流程
1. 把 `prompt.md` 中分隔线以下的原文发给模型。
2. 模型提问时，评测者只按 `hidden/intent.md` 作答；表外问题一律回答“你来决定”；不主动透露。
3. 同时记录 `transcript_notes.json`：提问轮数、每个问题的原文与对应编号（K1–K3 / C1–C2 / I1–I5 / 其他）。
4. 登记运行时用 `--transcript` 传入。

## 提示词使用
- 发给模型的内容 = `prompt.md` 原文（T03 按组删去另一组的条件段；T06 只发分隔线以下部分）。
- 不要额外补充提示，不要在对话中给出评分标准。
- 被测模型不得接触 `hidden/` 与本 skill。
