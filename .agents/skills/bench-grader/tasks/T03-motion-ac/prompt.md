# 动画任务：Tempo 产品介绍短片（A / C 两组）

> 同一份 Brief 跑两组，只有“二、条件”不同。A 组环境中不得安装任何动画/视频相关 skill，并禁止执行 `npx skills add`；C 组预装固定版本的 HyperFrames 及其官方 skills。两组产出都由评测方用同一渲染器重新渲染后评分。

## 一、Brief（两组相同）
- 内容：根据 `assets/copy.md` 中的文案，制作一支 15 秒的产品介绍动画。产品是虚构的专注计时 App「Tempo」，不需要上网调研。
- 规格：1920×1080，30fps，时长 15±0.5 秒。
- 音乐：使用 `assets/bgm.wav`，从第 0 秒开始完整播放、不要剪辑（评测方会按此混入音频）。节拍时间点在 `assets/beats.json`，重要的画面变化尽量落在节拍上。
- 字幕：中英双语，每句只占一行，过长就拆成多条，不要自动换行。
- 素材：只能使用 `assets/` 中提供的素材，以及你用代码生成的图形。
- 风格：干净、有节奏感的科技产品风格，一种主色加一种强调色。

## 二、条件
【A 组】不要使用任何 skill，也不要使用视频框架（包括 HyperFrames、Remotion）。手写 HTML、CSS 和 JS。只允许从 cdnjs 加载 gsap（固定版本）。
【C 组】使用 HyperFrames 及其已安装的 skills，按 skill 推荐的流程完成。

## 三、交付（两组相同）
在工作目录下新建文件夹 `tempo-promo/`：
- `index.html`：可以直接打开预览。页面必须暴露 `window.__hf = { duration, seek(t) }`，`seek(t)` 要同步渲染出第 t 秒的确定画面。
- 时间不能由 requestAnimationFrame 或 Date.now() 驱动，随机数必须用固定种子。
- 如果你导出了 MP4，也一并放进来（不强制）。
- 最后用不超过 100 字说明交付了哪些文件。
