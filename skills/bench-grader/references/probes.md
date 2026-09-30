# 自动探针

每道题在 `rubric.yaml` 的 `probes` 中声明要运行的探针及参数。探针只写指标（`metrics.json`），不直接打分。

| 探针 | 主要指标前缀 | 依赖 | 用于 |
|---|---|---|---|
| files | `files.*` | — | 交付物是否齐全、多余文件、禁用素材、白名单外外链、CDN 未固定版本、占位代码、关键词 grep |
| claims | `claims.*` | final_message.md | 汇报中提到的文件是否存在；是否声称有视频却没有 |
| docs | `docs.<名>.*` | — | 文档存在、长度、关键词组命中（只作辅助证据） |
| transcript | `tr.*` | transcript_notes.json | T06 提问轮数、问题数、命中 K/C/I 编号 |
| diff | `diff.*` | 种子仓库 | T08 改动行数、改写比例、新增测试、运行时第三方依赖 |
| mcproject | `mc.*` | minecraft skill 目录（可选） | 运行其 validate_project.py；项目文件填写率、音频提示表、QC、关键帧、manifest 是否如实 |
| browser | `browser.* scene.* js.* seq.* shots.* audio.* mobile.* a11y.*` | playwright + Chromium | 加载、报错、网络请求、帧率、首帧时间、文字碰撞/出界、3D 场景统计、自定义 JS 指标、刷新序列、多状态截图差异、音频自动播放合规、手机视口、axe 无障碍 |
| timeline | `tl.*` | playwright；ffmpeg（评审视频） | 基于 seek(t) 的逐帧采样：确定性、空白帧、静止时长、切换次数、视觉重音与节拍对齐、文字碰撞/出界/中文换行、定格节奏、相机与镜头表一致性；可渲染统一评审视频 |
| video | `video.* srt.* asr.*` | ffmpeg/ffprobe；faster-whisper（可选） | 时长、分辨率、帧率、编码、响度与真峰值、切换密度、冻帧、黑帧、字幕换行/双语/重叠/越界/覆盖率、配音与脚本字错率 |
| build | `build.*` | node/npm、npm 源可达 | lock 文件、依赖白名单、strict、any/ts-ignore 数量、从零安装+构建、tsc 错误数、单文件产物与体积 |
| api | `api.*` | python + pytest | 按 bench.json 启动服务、隐藏测试（按 test_<类别>_ 前缀统计）、命名测试、回归率、并发压测 p95、重启持久化、PIN 明文扫描、模型自带测试 |

## 评测接口约定（写在各题提示词里）
- T01：`window.__bench`（setMode/getMode/setSpeed/getState/species），3D 模式下 `__scene` / `__renderer`。
- T02：`window.FILM`（duration/fps/poseFps/shots/seek/play/pause/cameraAt/getPose）+ `__scene` / `__renderer`，URL `?t=&paused=1`。
- T03：`window.__hf = {duration, seek}`（与 HyperFrames 渲染约定一致）。
- T05：`__scene` / `__renderer` / `__bench`（launch/setTimeScale/getTelemetry/setExploded/listHotspots/openHotspot/scrollToSection），网格命名前缀。
- T06：`__bench`（reset/setNow/actAs/book/cancel/myBookings）。
- T07/T08：`bench.json`、`X-Bench-Now` 请求头、`BENCH_MODE=1` 时的 reset 接口、`PORT`、`DB_PATH`。

接口缺失时相关检查项记“缺失”（0 分），这是有意为之：接口是题目要求的一部分。

## 已知局限
- **帧率**：评测机没有 GPU 时 Chromium 使用 SwiftShader 软件渲染，帧率只在同一台评测机上相对可比。正式跑分请固定一台机器；有 GPU 时可设 `BENCH_HEADFUL=1` 用有头模式。
- **文字检测**基于 DOM：文字画在 canvas 里的作品无法检查碰撞/换行（指标为 0 视为通过）。人工项 H06 等会补上。
- **节拍对齐**用帧差峰值近似“视觉重音”，随机水平约 0.3；只作卓越层参考。
- **关键词类 docs 检查**只是辅助证据，对应 agent 项才是主判断。
- **npm 不通**时 build 探针相关项为 N/A，会使 T05 低可信，需修环境后重跑 `grade --only build`。
