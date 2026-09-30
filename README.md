# TryProtocom Model-Compare

面向“模型 + harness”的编码与创作能力基准（Coding Bench），以及配套的本地**模型评测工作台 Bench Workbench**。

- **题库与评分**：`skills/bench-grader/` —— 8 道题（3D、动画、前端、后端、工程化、需求理解、Agent 执行）、7 个质量维度 + 2 个效率维度、细粒度检查项；自动探针 + Agent 审查 + 人工盲评。
- **工作台**：`workbench/` —— TypeScript + React 的评测工作台（网页版 + Electron 桌面版），iOS Liquid Glass 风格。
- **Agent 接入**：`skills/bench-workbench/` —— 让通用 Agent 通过 `wb` CLI 完成评测的 skill。两个 skill 同时镜像在 `.agents/skills/`。

## 快速开始（Windows）

需要 Node.js 20+ 与 Python 3（评分用；`pip install pyyaml playwright pillow numpy openpyxl matplotlib pytest`，再 `python -m playwright install chromium`）。

```bat
Start-Workbench.cmd            :: 网页版：http://127.0.0.1:41873
Start-Workbench.cmd desktop    :: 桌面版（Electron）：原生 Chromium DevTools、移动端 UA/触摸模拟、截图
wb status                      :: CLI（仓库根目录）
```

macOS / Linux：`cd workbench && npm install && npm run build && npm start`，CLI 用 `./wb`。

## 一次测评怎么做

1. **模型**：点「新增模型」，只输入名称（如 `GPT-6.1-Sol`）。工作台识别供应商、创建 `model/OpenAI/GPT-6.1-Sol/`、配上真实品牌图标，并从本机已安装的软件里推荐 harness（Codex 桌面版、Claude Code、DeepSeek Harness、Cursor、Kimi Code、ZCode、TRAE…，内置 40 多种，商店版应用也能识别）。
2. **题目**：顶部 Tab 选题，点「复制提示词」（或按 `C`）。一次点击会创建干净工作目录 `rN/`（复制一份预置素材：T02 的 skill 包、T03/T04 的音频与文案、T08 的种子仓库；T03/T04 的音频缺了会自动生成，其他素材缺了会拒绝发车）、开始计时，并把**统一运行约定 + 题目原文**复制到剪贴板。运行约定写明工作目录绝对路径、交付文件夹名、必须存在的文件，以及结束时写出 `FINAL_MESSAGE.md`。「复制并打开 …」会同时启动对应的 harness。
3. **运行**：工作台每 3 秒扫描工作目录，按交付清单逐项点亮；`FINAL_MESSAGE.md` 一出现就自动结束计时并导入最后回复。在运行看板上「登记并评分」，由 bench-grader 跑隐藏测试、浏览器探针等自动评分。
4. **预览与打分**：「预览并打分」打开预览舞台，右侧浮动评分面板逐项打人工分（键盘 `0–3`，`J`/`K` 切换）。Agent 审查项点「AI 评审提示词」，粘贴给评分 Agent（它会读 `.agents/skills`，用 `wb pending / wb score` 打分并附证据）。
5. **结果**：排行榜勾选即可对比；任何图表都能导出 PNG / SVG / 复制；「导出」页可一键打包全部图表、批量生成单模型报告、全量导出 CSV / Excel / HTML。

### 发车台（连续发题）

新增模型后会直接打开「发车台」（模型卡片、模型详情、总览、题目页也有入口）：左侧是 T01–T08，中间是**提示词胶囊**，把它**拖到右侧 harness 坞**（DeepSeek Harness、Claude Code、Cursor…）上就「发车」：复制提示词 + 打开该软件 + 记下时间戳。也可以直接点坞里的按钮，或选「仅复制」。

- **只记时间戳，不在后台计时**：发车时记开始时刻，模型写出 `FINAL_MESSAGE.md` 时记结束时刻，用时 = 两者之差。
- **额度**：发车后弹出小卡片记录「开跑前剩余额度」，登记时记录「结束后剩余额度」。订阅制在模型上设一次「每周期费用 ÷ 每周期额度」（单位可以是次、条消息、点、%、美元），差值自动折算成美元写进本次运行的费用（标注为估算）；按 token 计费的模型不用填。

### 桌面宠物（Bench 小精灵）

工具栏的爪印按钮、`Start-Workbench.cmd pet` 或 `wb pet` 召唤。它是一个透明、置顶的小 Electron 窗口（屏幕右下角，可拖动），只连本机工作台：

- 有运行在跑时转圈，有模型交付时蹦跳并弹气泡「GPT-6.1-Sol 交付了 T05 · r2」，可直接「登记并评分」；
- 点它展开面板：当前模型进度、进行中 / 已交付列表、待评（人工 / Agent，一键复制 AI 评审提示词）、后台任务、榜单前三；
- 「截屏存证」截取当前屏幕，保存到对应运行旁的 `rN.shots/`。
- **后台任务自动召唤**：登记或自动评分一开始，宠物会自己出现在右下角并展开「后台任务」，列出进行中、排队和最近 15 分钟结束的任务（带对应运行、探针进度、分数或失败原因）。点任意一行看**完整评分日志**（实时追加，可复制、可取消任务，评完还有人工项时有「去打分」）。收起后，球外圈的进度弧和一颗呼吸光点表示还在工作，悬停可看当前步骤。在本轮任务进行中手动退出宠物，就不会再自动召唤，直到任务全部结束；「设置 → 提示词与计时 → 后台任务时」可关闭自动召唤。

**边界**：只访问 `127.0.0.1` 上的工作台；只在你点击时才截屏（截屏时先隐藏自己），文件只存本机；不注册全局快捷键、不监听键盘鼠标、不读取其他程序；能做的动作仅限工作台已有的接口（登记评分、打开页面、复制提示词、取消任务）。需要 `workbench/` 下已 `npm install`（含 Electron）。

## 页面

| 分组 | 页面 | 用途 |
| --- | --- | --- |
| 评测 | 总览 | 当前测评模型的进度与“下一步”、待办、榜单前五、最近动态 |
| | 模型 | 按供应商分组的模型卡片；详情页含维度雷达、逐题得分、运行矩阵、单模型报告 |
| | 题目 | T01–T08 Tab、一键复制带运行约定的提示词、交付要求、本模型的运行、评分构成、门槛、评分细则（筛选、锚点、注入缺陷表） |
| 执行 | 运行 | 看板（进行中 → 已交付 → 待评分 → 已完成）与列表；详情含交付检测、登记表单、得分明细、提示词留档、最后回复、文件、用时成本 |
| | 预览舞台 | 最多 4 窗格：完整 HTML、模型的开发服务器（反向代理 + HMR）、外部地址、视频（逐帧、变速、A-B、截帧）；设备预设、横竖屏、缩放、全屏；F12 面板（控制台 + 执行 JS、网络、帧率/内存）；无头检查；同屏评分面板 |
| 结果 | 排行榜 | 领奖台、可排序总榜（95% CI、并列、维度热力）、维度 / 逐题热力、效率帕累托、检查项分析、Skill 增益、失败归因 |
| | 对比 | 2–6 个参赛者的雷达叠加、逐题分组柱、维度差值、逐题明细 |
| | 导出 | 图表打包 ZIP、批量单模型报告、bench-grader 全量导出、存储文件导入导出、历史导出 |
| 文档 | 方法论 | 面向读榜访客：设计原则、雷达维度、题目 × 维度矩阵、题目关系、题库、评分体系、运行协议、导出表格、评分工具 |
| 系统 | 设置 | 提示词与计时、Harness、评测机、存储文件、后台任务、CLI 与 Agent、关于 |

快捷键：`Ctrl+K` 命令面板；`G` + 字母跳转；右上角眼睛切换盲评。侧栏底部有 GitHub 链接与「下载源码」（git archive，不含隐藏测试）。

## 目录约定

```
model/<供应商>/<模型>/                 每个模型的全部产物（名称可含点与短横，如 OpenAI/GPT-6.1-Sol）
  model.json                           模型档案（含默认 harness）
  <题号[变体]>/rN/                     第 N 次运行的干净工作目录（被测 Agent 在这里工作；独立 git 根）
  <题号[变体]>/rN/FINAL_MESSAGE.md     被测模型写出的最后回复（自动导入）
  <题号[变体]>/rN.run.json             计时、harness、用量、bench-grader 运行 id
  <题号[变体]>/rN.prompt.md / rN.final.md  提示词留档 / 最后一条回复
  _report/REPORT.md                    单模型报告
data/bench-store.json                  可移植存储文件（模型、分数、人工评分、用量、设置、笔记）
.agents/skills/                        两个 skill 的镜像（从 skills/ 同步，不含 hidden/）
bench-data/                            bench-grader 工作数据（不提交）
reports/<时间>-<标签>/                 全局导出（CSV / Markdown / Excel / 图表 / HTML + 存储快照）
```

**换电脑**：复制 `data/bench-store.json`（或在「导出」页下载后到另一台导入合并），排行、对比与报告即可完整复现；要预览产物再同时复制 `model/`。

## 端口与安全

- 工作台 `127.0.0.1:41873`（`WB_PORT` 可改）；每个预览会话使用 `41901–41999` 中独立端口 = 独立源，模型产物无法调用工作台接口。
- 只监听本机；拒绝非本机 Host（防 DNS 重绑定）与跨源请求；写操作需要每次启动随机生成的令牌（CLI 从 `workbench/.runtime/runtime.json` 读取）。
- harness 只启动内置清单里且本机检测到的程序，参数不经 shell 拼接。
- 被测模型的工作目录是独立 git 根：按 git 根查找 skills 的 Agent（Codex、Claude Code、Cursor 等）不会发现仓库根目录的评分 skill。

## 公开仓库说明

`skills/bench-grader/tasks/*/hidden/`（隐藏测试、参考实现、意图表）**不在公开仓库中**。评测方请从私有备份放回对应目录后再评分；缺少时相关检查项会变成 N/A。

品牌图标来自 [Lobe Icons](https://github.com/lobehub/lobe-icons)（MIT），已打包在 `workbench/public/brands/`。

## 开发

```bash
cd workbench
npm install
npm run dev          # 前端开发服务器 127.0.0.1:41874（/api 代理到 41873，需另开 npm start）
npm run typecheck
npm test             # 共享逻辑单测（供应商识别、运行约定、交付检测、AI 评审提示词）
npm run build        # 前端 dist/ + 服务端与 CLI dist-node/ + 桌面壳 desktop/app/
npm run desktop      # 用 Electron 打开
npm run dist:win     # 打包便携版 exe → workbench/release/
```

设计与需求见 `docs/PRD.md`，分支与发布流程见 `docs/BRANCHING.md`（日常在 `dev` 开发，稳定后同步到 `main`）。`workbench/dist` 与 `workbench/dist-node` 已提交，只装 Node.js 也能直接运行网页版与 CLI。
