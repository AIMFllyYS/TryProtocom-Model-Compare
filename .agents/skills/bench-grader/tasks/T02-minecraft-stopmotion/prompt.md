# 任务：按指定 Skill 制作方块风格定格动画短片

## 输入
- Skill 目录：`./skills/minecraft-stop-motion-director/`。开始前先阅读其中的 SKILL.md，并按它的要求使用 references、模板和脚本。
- 主题：史蒂夫风格的方块主角，向观众推销虚构科技公司的「Sol（日）与 Luna（月）」附魔武器装备套餐。
- 目标时长：60 秒

## 对 Skill 的补充约定（与 Skill 冲突时以本节为准）
1. 成片形式：本任务的成片是一个可在浏览器中完整播放的实时渲染 HTML（Three.js）。它视为 Skill 中 “Full render path” 的成片，不需要另外导出 MP4；如果导出了，须在 delivery-manifest.json 中如实登记。
2. 素材：所有几何、像素贴图、音效和音乐都必须用代码生成（Web Audio API 合成）。不得引用外部图片、模型、音频或字体文件；唯一允许的外部依赖是 CDN 上固定版本的 Three.js（可含官方 addons）。
3. 知识产权：角色和方块贴图均为原创的 “Minecraft 风格” 设计，不复制官方皮肤、贴图或音效。
4. 主题中的公司与产品均为虚构，不需要上网调研。

## 交付物
在工作目录下新建文件夹 `mc-sol-luna/`，至少包含：
- `index.html`：单文件成片，JS 和 CSS 全部内联。
- Skill 模板要求的全部项目文件：project.json、shot-list.json、audio-cue-sheet.csv、qc-report.md、delivery-manifest.json。每个文件都要填写完整，并能通过 Skill 自带的 validate_project.py 校验。
- `keyframes/`（每个镜头至少一张关键帧截图）和 `contact-sheet.jpg`。如果环境无法截图，就在 qc-report.md 中写明原因，不要伪造。

## 评测接口（必须实现）
index.html 需要在 `window.FILM` 上暴露：
- `duration`、`fps`（输出帧率）、`poseFps`（角色姿态帧率）
- `shots`：内容与 shot-list.json 一致的数组，直接写在页面里，不要用 fetch 读取
- `seek(t)`：跳到第 t 秒并同步渲染出确定的画面
- `play()`、`pause()`
- `cameraAt(t)`：返回第 t 秒正在使用的相机 ID
- `getPose(t)`：返回主角在第 t 秒各关节的旋转值（对象或数组均可）
另外暴露 `window.__scene` 与 `window.__renderer`。页面支持 URL 参数 `?t=秒数&paused=1`，打开后直接停在该帧。所有随机数都用固定种子。音频在用户首次点击后才启动，并提供静音开关。

## 结束时
用不超过 150 字总结交付了什么，只列出真实存在的文件。
