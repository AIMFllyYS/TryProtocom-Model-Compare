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

我想要一辆让懂车的人也点头的自行车。

它不是一个“看起来像自行车”的模型，而是一台机器：车架的几何、前叉的倾角、车把与车座的位置，链条怎么绕过牙盘和飞轮、后拨怎么张紧链条、轮子怎么由轮毂、辐条、轮圈、轮胎组成、刹车怎么夹住轮圈，每一处都应该是对的。我可以把镜头凑到传动系统前面，看着曲柄转一圈、链条走一圈、飞轮转几圈，数一数是不是真的对得上。

它也应该是美的：材质、涂装、光线、放在什么样的环境里，都由你来定。想让它是一台公路车、通勤车、山地车还是复古车，也由你来定。越讲究越好，不要因为我没写就省掉某个零件。
