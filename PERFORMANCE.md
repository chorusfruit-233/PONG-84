# 渲染与性能说明 — 4.1.0

## 渲染边界

图形模式使用 Canvas 2D，可由浏览器进行硬件加速；本项目没有用 WebGL/WebGPU 实现 3D 或真实物理光线追踪。玻璃、金属、反射与光晕都是为二维球场设计的绘制效果。

ASCII 使用独立 DOM 文本路径，不依赖图形渲染器。冷启动 ASCII 时不请求 Canvas 上下文、不构建图形背景缓存，不运行图形模式的粒子、尾迹、阴影和模糊。字体测量不使用 Canvas。浏览器仍须排版和绘制文字；这不等于浏览器完全不使用硬件，也不是对任意旧设备的固定帧率保证。

`ascii_start.html` 可用于每次冷启动直接进入字符模式。普通入口也支持保存偏好与 `?render=ascii` 参数。

## 本次软件路径采样

方法：读取未改动的发布 HTML，通过 `page.set_content` 注入真实 Chromium 页面；注入本地存储设置以实现 ASCII 冷启动，用内存中的自动接球测试逻辑维持连续对打。采样前预热约 1.1 秒，三种工况分别记录约 10 秒。

启动参数关闭 GPU 合成、加速 Canvas、WebGL；CDP `SystemInfo.getInfo` 返回合成和光栅化为 `disabled_software`，WebGL/WebGPU 为 `disabled_off`。完整参数、浏览器版本与原始数据在 `validation/ascii_software_*.json`。

| 工况 | 采样秒数 | 画面提交次数/秒 | 提交间隔 P95（毫秒） | 绘制脚本耗时 P95（毫秒） | Canvas 上下文请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 自适应 / 常规 CPU | 10.001 | 59.99 | 16.9 | 0.1 | 0 |
| 自适应 / 6 倍 CPU 节流 | 10.002 | 60.09 | 18.2 | 1.1 | 0 |
| 30 帧节能 / 6 倍 CPU 节流 | 10.003 | 29.99 | 34.5 | 1 | 0 |

**测量口径：**提交次数不是显示器最终呈现帧率；脚本耗时不含全部布局、栅格化、合成和显示延迟。CPU 节流不等同于真实低端 CPU。以上是本执行环境中短时测试的结果，不宜外推为所有设备的长期表现。本次没有独立显卡硬件上的图形模式帧率数据。

## 控制开销的实现

图形背景按尺寸、主题和画质缓存；光晕贴图按有限颜色复用。粒子最多保留 128 个，扩散波纹最多 10 个；均衡画质进一步减少绘制粒子和光照。光效采用独立伪随机数，减少动态效果偏好会停用相关装饰。

ASCII 使用固定上限的网格、复用缓冲区和文本节点，只写入变化行。菜单和暂停状态不维持持续游戏帧循环；切回 ASCII 后释放图形背景和贴图缓存。三档性能设置仅影响绘制目标，物理使用原有固定步长。

## 复现

依赖 Python 3.10+、Playwright 和可执行 Chromium/Chrome；无需修改游戏源码。

```bash
python -m pip install playwright
python tools/benchmark.py index.html --seconds 10 --profile auto --out validation/ascii_software_auto.json
python tools/benchmark.py index.html --seconds 10 --cpu-rate 6 --profile auto --out validation/ascii_software_cpu6.json
python tools/benchmark.py index.html --seconds 10 --cpu-rate 6 --profile eco --out validation/ascii_software_eco.json
```

可用 `--browser` 指定浏览器路径。测试脚本不验证文件 URL、公开站点导航或网络联机。
