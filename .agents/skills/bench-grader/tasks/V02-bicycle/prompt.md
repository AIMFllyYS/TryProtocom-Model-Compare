# 一辆自行车

## 契约

- 在工作目录下新建文件夹 `bicycle/`，入口是 `bicycle/index.html`。Chrome 双击就能运行，不需要启动服务；可以拆成多个文件，但都放在这个文件夹里。
- 可以从 CDN 加载你需要的开源库（固定版本号）。但所有画面都要由代码当场生成：几何、纹理、光照、动画、声音都不要引用或携带外部图片、模型、音频、字体文件。
- 鼠标拖动可以转动镜头，滚轮可以缩放。
- 页面加载后把下面这个接口挂在 `window` 上，评测会用它取景拍照，并读取最少的几个物理量：

```js
window.__bench = {
  views: ['side', 'three_quarter', 'top', 'closeup_drivetrain', 'closeup_front', 'closeup_wheel'],
  setView(id) {},        // 把镜头切到这个命名视角（可以做过渡动画，1 秒内完成）
  listParts() {},        // 可选，但鼓励：返回部件树 [{ id, name, parent }]
  setSpeed(v) {},        // 车子前进的速度，米/秒；0 表示静止
  getState() {           // 返回当前状态
    return { speed, wheelAngle, crankAngle, wheelRadius, chainringTeeth, cogTeeth };
    // wheelAngle / crankAngle：后轮、曲柄累计转过的角度（弧度，只增不取模）；wheelRadius：米；
    // chainringTeeth / cogTeeth：牙盘与后飞轮的齿数
  },
};
```

- 如果用 Three.js，请同时暴露 `window.__scene`（THREE.Scene）和 `window.__renderer`（THREE.WebGLRenderer）。
- 完成时在工作目录写 `FINAL_MESSAGE.md`，说明做了什么、怎么看、哪里最想让我多看两眼。

## 愿望

我想要一辆让懂车的人也点头的自行车。它首先是一台机器：几何、传动、轮组、制动的关系都应该是对的，可以把镜头凑到传动系统前，看曲柄转一圈、链条走一圈是否对得上。

至于它是公路车、通勤车、山地车还是别的什么，材质、涂装、光线、环境、是否带一点叙事，风格上的一切都由你自己分析和决定，我不指定。

同时，无论是 JavaScript、WebGL、Three.js 还是什么各种技术都可以，用你最大的努力，我希望：

1. 作品本身视觉是惊艳的、艺术性顶尖的。
2. 内容本身是高级的、有深刻含义的。
3. 转场、画面（或镜头、场景、交互）之间的衔接是自然的：可以一镜到底，或者至少画面和画面之间有主线、不突兀。
4. 从观众的视角感受到的是大师之作，并且震惊这竟然是用代码生成的。
5. 可以不限 token，尽可能炫技。
