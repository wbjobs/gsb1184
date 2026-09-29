# WebGL 程序化地形 + 四叉树 LOD

纯静态站点，无构建步骤。WebGL + Canvas + Web Worker + PerformanceObserver + TypedArray + IndexedDB。

## 运行

```bash
npm run serve        # python3 -m http.server 8080
# 打开 http://localhost:8080
```

操作：点击画面锁定鼠标，WASD 移动，Q/E 升降，Shift 加速，鼠标转向。

## 测试

```bash
npm test             # node --test，6 个测试文件，含无头集成测试（模拟飞行路径跑完整管线）
```

## 架构

| 模块 | 职责 |
| --- | --- |
| `src/noise.js` | 种子化 value-noise FBM + ridged 复合噪声（确定性，worker/主线程共用） |
| `src/erosion.js` | 热侵蚀 + 水滴水力侵蚀（TypedArray 原地计算） |
| `src/terrain-gen.js` / `src/terrain-worker.js` | 瓦片高度图生成；Web Worker 内执行，Transferable 回传，主线程零阻塞 |
| `src/quadtree.js` | 受限四叉树：屏幕空间误差驱动 split/merge，增量 diff 更新，邻层差 ≤1 |
| `src/geometry.js` | 瓦片网格 + 法线 + 裙边（skirt）几何，Uint16/32 自适应索引 |
| `src/renderer.js` | WebGL 渲染器，逐瓦片 VBO/IBO，LOD 调试着色，context lost 处理 |
| `src/camera.js` | 漫游相机：世界边界钳制 + 地形净空钳制（相机越界处理） |
| `src/memory.js` | 显存预算、LRU 淘汰、降级到单 LOD（带迟滞，预算上调才恢复） |
| `src/cache.js` | IndexedDB 瓦片缓存（跨会话复用高度图） |
| `src/perf.js` | PerformanceObserver(longtask) + 帧耗时 avg/p95，性能对照报告导出 |

## 验收标准对照

| 标准 | 实现与验证 |
| --- | --- |
| 地形生成正确 | 种子化噪声 + 侵蚀，确定性输出；`test/noise.test.js` |
| LOD 切换正确 | 屏幕空间误差 split/merge，远看粗、近看细；`test/quadtree.test.js`、`test/integration.test.js` |
| 裂缝处理正确 | 受限四叉树（邻层差 ≤1）+ 裙边遮挡接缝；`test/quadtree.test.js`、`test/geometry.test.js` |
| 四叉树更新正确 | 增量 diff（toLoad/toUnload），无重建、无重叠空洞；`test/quadtree.test.js` |
| 相机漫游流畅 | Worker 生成 + 增量更新 + TypedArray；HUD 实时 FPS/p95 |
| 性能对照可量化 | 面板开关 LOD/Worker/侵蚀，「导出性能报告」下载 JSON（fps/avg/p95/longtasks/VRAM） |
| 显存不足有降级 | 预算超限时 LRU 淘汰；淘汰到可见瓦片或单分配超预算 → 自动降级；`test/memory.test.js`、`test/integration.test.js` |
| 降级方案可用 | 固定单 LOD（level 1）继续渲染；面板可手动「强制降级」/恢复，调低显存预算可复现 |
| 主线程不卡 | 生成在 Worker；PerformanceObserver 统计 longtask 并在 HUD 显示 |
| 相机越界 | 位置钳制在世界范围内，高度钳制在地形净空之上、上限之下；`test/camera.test.js` |

## 性能对照方法

1. 打开页面，沿同一路线飞行（或静止）观察 HUD 的 FPS / avg / p95 / longtasks。
2. 切换 LOD / Worker / 侵蚀开关，每次切换后统计自动重置。
3. 点「导出性能报告」下载 JSON，多次采样追加在同一文件中。
4. 把显存预算调到 8MB / 2MB 可复现 LRU 淘汰与单 LOD 降级；调回 256MB 自动恢复。
