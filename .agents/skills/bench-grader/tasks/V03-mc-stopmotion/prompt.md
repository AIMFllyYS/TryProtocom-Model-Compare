# Minecraft 风格定格短片

## 契约

- 工作目录里有一套工作室标准流程：`./skills/minecraft-stop-motion-director/`。开始前先读它的 `SKILL.md`，用它的模板、参考与脚本，这是这条片子的制作规范。与下面契约冲突时，以本契约为准。
- 在工作目录下新建文件夹 `mc-sol-luna/`，入口是 `mc-sol-luna/index.html`：一个能在 Chrome 里直接打开、完整播放的实时渲染成片（视为 Skill 里的 “Full render path”，不需要导出 MP4）。
- 可以从 CDN 加载开源库（固定版本号）。但画面和声音都要由代码当场生成（几何、像素贴图、Web Audio 合成），不要引用或携带外部图片、模型、音频、字体文件。角色与方块贴图是原创的“Minecraft 风格”设计，不复制官方皮肤、贴图、音效。
- 按 Skill 的要求交付它规定的项目文件（都放在 `mc-sol-luna/` 内：`project.json`、`shot-list.json`、`audio-cue-sheet.csv`、`qc-report.md`、`delivery-manifest.json`、关键帧与 contact sheet），并能通过它自带的 `validate_project.py`。无法截图就在 `qc-report.md` 里如实说明，不要伪造。
- 页面加载后把下面的接口挂在 `window` 上（评测用它逐帧取景、核对时间线与镜头表）：

```js
window.FILM = {
  duration, fps, poseFps,   // 秒、输出帧率、角色姿态帧率（定格感来自姿态帧率低于输出帧率）
  shots,                    // 与 shot-list.json 内容一致的数组，直接写在页面里，不要 fetch
  seek(t) {},               // 跳到第 t 秒并同步渲染出确定的画面
  play() {}, pause() {},
  cameraAt(t) {},           // 第 t 秒使用的相机 id
  getPose(t) {},            // 第 t 秒主角各关节的旋转值
};
window.__bench = {
  views: ['hero_front', 'hero_side', 'hero_back', 'closeup_face', 'wide_scene'],
  setView(id) {},           // 暂停成片并把一个自由镜头切到这个命名视角（用来检查角色与场景，不影响 FILM 的镜头表）
  listParts() {},           // 可选，但鼓励：返回部件树 [{ id, name, parent }]
};
```

  另外暴露 `window.__scene` 与 `window.__renderer`。页面支持 URL 参数 `?t=秒数&paused=1`，打开后直接停在那一帧；所有随机数用固定种子；音频在用户第一次点击后才启动，并提供静音开关。
- 完成时在工作目录写 `FINAL_MESSAGE.md`，说明交付了什么，只写真实存在的文件。

## 愿望

一支 60 秒左右的方块风格定格动画：一个史蒂夫气质的方块主角，向观众推销虚构科技公司的「Sol（日）与 Luna（月）」附魔武器装备套餐。公司与产品都是虚构的，不需要上网调研。

我想看到的是一支真正“拍出来”的短片：有想法的开场、卖点靠玩法演示而不是字幕念稿、有转折、有让人记住 Sol 和 Luna 区别的画面，结尾呼应开头并带出新的意思。静音看也能看懂在讲什么，开声音时环境声、拟音和音乐各有各的分量。

角色是一个真的由方块拼起来的小人：手握武器是真的握住，脚踩地面是真的踩住，转身、挥砍、举起附魔武器时身体各部分始终连在一起，不会散架，也不会互相穿过去。方块世界的语法要统一，从地形到道具到角色，都像出自同一个世界。

镜头怎么走、世界怎么搭、什么时候安静、什么时候炸，都由你决定。
