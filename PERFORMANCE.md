# v4 渲染设计与性能记录

## 两条路径各自负责什么

图形路径追求清晰度与光效：按实际显示尺寸创建高清 Canvas 2D，缓存球场背景和光晕，独立粒子与拖尾，提供精致/均衡画质。ASCII 路径为有上限的字节缓冲区和持久 Text 节点，不创建图形上下文，只更新变化行。切回 ASCII 释放图形缓存，取消粒子与拖尾生成，主画布缩为 1×1。

没有为了 ASCII 性能关闭图形模式特效。ASCII 的节能、自适应降档只影响 ASCII 绘制，不会把图形模式固定在低分辨率或 30 次/秒。

## 实测口径

测试日期：2026-09-05。浏览器：144.0.7559.96。1366×768 CSS 像素，设备像素比 1。每组预热约 1.1 秒、采样约 6 秒。

通过 Chromium 启动参数禁用 GPU 合成、加速 Canvas、WebGL 和软件 3D 光栅器；CDP 返回 `gpu_compositing=disabled_software`、`rasterization=disabled_software`、`webgl=disabled_off`、`webgpu=disabled_off`。实际参数及状态写在 `validation/ascii_software_*.json`。

在执行未改动 HTML 前，以内存本地存储测试桩指定 ASCII，因而零 Canvas 统计包含冷启动；不是先初始化图形再切换 ASCII。为持续对打，测试桩让双方自动跟随球，关闭音频，不修改发布 HTML。CPU 6× 是 DevTools 节流，不对应某一型号旧 CPU。

| 工况 | 画面提交 / 秒 | 提交间隔 P95 / ms | 渲染脚本 P95 / ms | Canvas 上下文请求 |
| --- | ---: | ---: | ---: | ---: |
| 自适应 / CPU 1× | 60.0 | 17.0 | 0.2 | 0 |
| 自适应 / CPU 6× 节流 | 60.15 | 18.2 | 1.2 | 0 |
| 节能 / CPU 6× 节流 | 30.16 | 35.1 | 1.1 | 0 |

以上三组均无未捕获 JavaScript 异常。短时间采样、端点计数和调度误差可使提交次数略高于设定目标，并不表示突破屏幕刷新率。

**提交频率不是显示器实际呈现帧率。** `render_js_p95_ms` 只计算应用提交文本更新的脚本耗时，不包括随后发生的排版、绘制与显示延迟。本记录不保证任意无独显设备恒定 60 FPS，也不替代实体设备测试。

图形模式没有进行实体 GPU 的性能基准；不把其 60 次/秒目标写成实测保证。浏览器是否硬件加速由运行环境决定。

## 全屏与逻辑几何

图形与字符球场均覆盖原生全屏视口；不留固定 16:9 容器、页面外边距、边框或固定侧栏。保留 960×540 逻辑世界，非 16:9 视口采用独立横纵缩放，所以图形比例会随显示比例改变。该做法保留原有碰撞和网络物理规则，触控使用相同归一化映射。

## 复现

安装 Python 与 Playwright，并准备 Chromium 浏览器后，在发布目录运行：

```bash
python -m pip install playwright
python tools/benchmark.py index.html --seconds 10 --cpu-rate 6 --profile auto --out validation/local-benchmark.json
python tools/regression.py index.html
```

需要自定义浏览器路径时，采样脚本支持 `--browser`。回归脚本默认查找 PATH 中的 `chromium`；也可在脚本中将 `executable_path` 指向本机 Chromium。游戏运行本身不依赖 Python、Playwright 或这些测试工具。

测试使用 `page.set_content` 注入原始 HTML，并非 file:// 或 HTTP 页面导航。测试环境的导航策略限制没有被绕过；这些结果不应描述成双击 HTML、线上 Pages 或系统级浏览器窗口全屏的端到端测试。
