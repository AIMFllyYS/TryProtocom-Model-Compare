# TryProtocom Model-Compare

面向“模型 + harness”的编码与创作能力基准（Coding Bench），以及配套的本地**模型评测工作台 Bench Workbench**。

- **题库与评分**：`skills/bench-grader/` —— 8 道题（3D、动画、前端、后端、工程化、需求理解、Agent 执行）、7 个质量维度 + 2 个效率维度、细粒度检查项；自动探针 + Agent 审查 + 人工盲评。
- **工作台**：`workbench/` —— TypeScript + React 的评测工作台（网页版 + Electron 桌面版），承接原 `benchmark-spec.html` 的全部内容，并加入模型工作区、计时登记、评分、盲评、对比、产物预览舞台与 CLI。
- **Agent 接入**：`skills/bench-workbench/` —— 让通用 Agent 通过 `wb` CLI 完成整套评测的 skill。

## 快速开始（Windows）

需要 Node.js 20+ 与 Python 3（评分用；`pip install pyyaml playwright pillow numpy openpyxl matplotlib pytest`，再 `python -m playwright install chromium`）。

```bat
Start-Workbench.cmd            :: 网页版：http://127.0.0.1:41873（首次自动安装依赖并构建）
Start-Workbench.cmd desktop    :: 桌面版（Electron）：原生 Chromium DevTools、移动端 UA/触摸模拟、截图
wb status                      :: CLI（仓库根目录）
```

macOS / Linux：`cd workbench && npm install && npm run build && npm start`，CLI 用 `./wb`。

## 工作台

| 视图 | 用途 |
| --- | --- |
| 总览 | 待办（未登记、未评分、待评、缺用量、素材缺失）、进行中的运行计时、模型 × 题目完成度矩阵、榜单速览 |
| 排行与对比 | 排行榜（95% bootstrap 置信区间、并列标记、9 维热力）、多参赛者雷达对比、题目热力矩阵、质量 × 成本 / 用时帕累托、T03 A/C Skill 增益、题目分析（区分度）、失败归因 |
| 模型 | 按供应商分组的模型档案；单模型的题目 × 运行进度、榜单表现、生成报告 |
| 运行 | 新建干净工作区 → 复制提示词 → 计时 → 粘贴最后回复与用量 → 登记并自动评分 → 逐项得分与人工/Agent 打分、文件浏览 |
| 评审 | 按检查项横向盲评：同一检查项的所有运行并排、内嵌产物预览、0–3 锚点、键盘打分 |
| 预览舞台 | 最多 4 窗格并排：完整 HTML（静态服务，支持 Range/视频）、模型的开发服务器（反向代理，含 HMR/WebSocket）、外部地址、视频播放器（逐帧、变速、A-B 循环、截帧）；设备预设、横竖屏、缩放/适应、全屏；类 F12 面板（控制台 + 执行 JS、网络、帧率/内存、开发服务器输出）；无头检查截图 |
| 题库规范 | 原规范页全部内容（概览、原则、维度、矩阵、关系、题库细则与筛选、提示词复制、评分体系、运行协议、导出、工具），可直接从题目发起运行 |
| 任务 | 评分、评分包、导出、依赖检查等后台任务（串行执行）与实时输出 |
| 系统 | TTS 命令等评测设置、可移植存储文件导出/导入、评测机依赖、报告目录、CLI 与 Agent 接入 |

快捷键：`Ctrl+K` 命令面板；`G` + 字母跳转视图；右上角眼睛图标切换盲评（隐藏模型名）。

## 目录约定

```
model/<供应商>/<模型>/                 每个模型的全部产物（名称可含点与短横，如 OpenAI/GPT-6.1-Sol）
  model.json                           模型档案
  <题号[变体]>/rN/                     第 N 次运行的干净工作目录（被测 Agent 在这里工作）
  <题号[变体]>/rN.run.json             计时、harness、用量、bench-grader 运行 id
  <题号[变体]>/rN.prompt.md / rN.final.md  提示词留档 / 最后一条回复
  _report/REPORT.md                    单模型报告
data/bench-store.json                  可移植存储文件（全部模型、分数、人工评分、用量、笔记）
bench-data/                            bench-grader 工作数据（不提交）
reports/<时间>-<标签>/                 全局导出（CSV / Markdown / Excel / 图表 / HTML + 存储快照）
```

**换电脑**：复制 `data/bench-store.json`（或在“系统”页导出后到另一台导入合并），排行、对比与报告即可在另一台电脑上完整复现；要预览产物再同时复制 `model/`。

## 端口与安全

- 工作台 `127.0.0.1:41873`（`WB_PORT` 可改）；每个预览会话使用 `41901–41999` 中独立端口 = 独立源，模型产物无法调用工作台接口。
- 只监听本机；写操作需要每次启动随机生成的令牌（CLI 从 `workbench/.runtime/runtime.json` 读取）；拒绝跨源请求。
- 桌面版的预览 webview 禁用 Node 与 preload，只加载 http(s)。

## 公开仓库说明

`skills/bench-grader/tasks/*/hidden/`（隐藏测试、参考实现、意图表）**不在公开仓库中**，以免被测模型检索或训练到。评测方请从私有备份放回对应目录后再评分；缺少时相关检查项会变成 N/A。

## 开发

```bash
cd workbench
npm install
npm run dev          # 前端开发服务器 127.0.0.1:41874（/api 代理到 41873，需另开 npm start）
npm run typecheck
npm run build        # 前端 dist/ + 服务端与 CLI dist-node/ + 桌面壳 desktop/app/
npm run desktop      # 用 Electron 打开
npm run dist:win     # 打包便携版 exe → workbench/release/
```

`workbench/dist` 与 `workbench/dist-node` 已提交，因此只装 Node.js 也能直接运行网页版与 CLI。
