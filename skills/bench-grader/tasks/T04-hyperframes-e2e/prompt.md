# 任务：Aether-9 发布宣传片（HyperFrames 端到端制作）

## 输入
- 事实表：`assets/aether9-facts.md`（虚构火箭，全部内容以事实表为准，不需要上网调研，不得编造其他参数）。
- 素材包：`assets/bgm-a.wav`、`assets/bgm-b.wav`（二选一）、`assets/sfx/` 下的音效。只能使用这些素材和你用代码生成的图形。
- 配音：使用评测环境预装的 TTS 命令 `{TTS_COMMAND}`（例如 `tts --voice zh-female --text "…" --out out.wav`）。
- 工具：已安装 HyperFrames 及其官方 skills，请使用它完成制作与渲染。

## 要求
- 成片：20±1 秒，1920×1080，30fps，H.264 视频 + AAC 音频，文件名 `final.mp4`。
- 内容：一支面向 B 站观众的发布宣传片，节奏紧凑、转场丰富、动效密集，信息全部来自事实表。
- 配音：中文旁白，由你撰写脚本并用 TTS 生成。
- 字幕：烧录进画面，中英双语，每句只占一行，过长拆成多条，不要自动换行；同时导出 `subtitles.srt`。
- 混音：整体响度 −16 到 −14 LUFS，真峰值不超过 −1 dBTP；旁白出现时 BGM 自动压低。

## 交付
新建文件夹 `aether9-promo/`，包含：`final.mp4`、`subtitles.srt`、`script.md`（旁白脚本）、HyperFrames 项目源码。最后用不超过 150 字说明交付了什么，只列出真实存在的文件。
