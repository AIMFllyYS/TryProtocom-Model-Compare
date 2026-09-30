# 任务：虚构重型火箭「Aether-9」的 3D 交互式产品官网

## 背景（虚构，不需要上网调研）
航天公司 Helios Dynamics（虚构）发布可复用两级重型火箭 Aether-9。官网内容以下表为准，不得自行编造其他参数：
| 参数 | 数值 |
|---|---|
| 全高 / 直径 | 118 m / 9 m |
| 一级 | 可回收助推器，21 台甲烷发动机，带 4 片栅格舵 |
| 二级 | 6 台发动机，含 3 台真空版 |
| 近地轨道运力 | 120 t（完全复用） |
| 一级分离 | T+160 s，高度约 70 km |

## 技术要求
- 源码使用 React 18+ 和 TypeScript（strict 模式），3D 部分使用 three.js，可以配合 @react-three/fiber 或 drei。
- 允许的依赖仅限：react、react-dom、three、@react-three/fiber、@react-three/drei、@react-three/postprocessing、gsap、vite、vite-plugin-singlefile、typescript、tailwindcss。
- 用 Vite 构建出单文件 `dist/index.html`：所有 JS、CSS、字体和贴图全部内联，文件体积不超过 8 MB。
- 页面运行时不得发出任何网络请求。贴图和环境光照必须用代码生成，或者内联嵌入。
- `npm ci && npm run build` 必须能从零复现构建，`npx tsc --noEmit` 不能报错。

## 3D 真实感要求
- 使用 PBR 材质（MeshStandardMaterial 或 MeshPhysicalMaterial），并配有程序化生成的细节贴图，比如焊缝、隔热瓦、污渍。
- 开启色调映射（ACES 或同类）和阴影，环境光照可以程序化生成。
- 发动机尾焰要有体积感或粒子效果，并随推力变化。
- 箭体比例、发动机数量、栅格舵数量都要与参数表一致。命名约定：一级发动机网格名以 `engine-s1-` 开头，二级海平面发动机以 `engine-s2-sl-` 开头，真空发动机以 `engine-s2-vac-` 开头，栅格舵以 `gridfin-` 开头。每台发动机、每片舵对应且只对应一个这样命名的对象（可以是 Group），其子对象不要再使用这些前缀。

## 交互要求
必做：
1. 视角可以旋转、缩放，并设置合理的边界。
2. 部件热点：点击后显示该部件说明，内容来自参数表。
3. 分级爆炸视图：一级和二级沿轴线分开展示。
4. 发射演示：包含倒计时、点火、升空和 T+160 s 的级分离，同时显示遥测数据（时间、高度、速度）。数据要随时间单调合理变化，分离时刻的数值与参数表一致。
5. 滚动叙事：页面滚动时，3D 镜头跟随切换到对应的内容区块。

开放项：再设计至少一个你认为新颖的交互，并在页面上用一句话说明它帮用户理解了什么。

## 页面与性能
- 页面至少包含以下区块：首屏、参数、发射演示、复用流程、行动号召。桌面端（1920×1080）和手机端（390×844）都要布局合理。
- 在普通笔记本上帧率稳定在 50 FPS 以上，首屏 3 秒内出现 3D 画面。控制台不能有任何报错。

## 评测接口（必须实现）
```js
window.__scene      // THREE.Scene
window.__renderer   // THREE.WebGLRenderer
window.__bench = {
  launch(),                 // 开始发射演示
  setTimeScale(k),          // 发射演示时间倍速（用于自动测试，例如 20 倍）
  getTelemetry() → { t, altitudeKm, velocityMs, stage },  // stage：1 或 2（分离后为 2）
  setExploded(on: boolean),
  listHotspots() → string[],
  openHotspot(id) → boolean,
  scrollToSection(id)       // id ∈ 'hero' | 'specs' | 'launch' | 'reuse' | 'cta'
}
```

## 交付
在工作目录下新建文件夹 `aether9-site/`，放入源码、package.json、lock 文件和构建好的 `dist/index.html`。最后用不超过 150 字说明交付了什么，以及那个新颖交互的设计思路。
