# 软件渲染与性能说明

本版的目标是不要求 GPU 加速也能玩，而不是宣称所有硬件、浏览器和系统负载下都锁定 60 FPS。

## 实现

ASCII 默认走 DOM 文本路径，既不创建游戏 Canvas 上下文，也不创建用于测字的隐藏 Canvas。字体宽度仅在初始化测量一次；网格适配在尺寸变化或档位变化时执行，不在每帧查询布局。

网格由固定数量的行元素与 Text 节点组成，使用有上限的 `Uint8Array` 缓冲区。复用静态边框与中线，每帧只向已变化的行写入字符；相同画面没有文本写入。没有为每个字符创建 DOM 元素，也不将整个 `<pre>` 每帧重新生成。

ASCII 不生成球拖尾。UI 中没有持续 CSS 动画、滤镜、扫描线和发光。菜单与暂停状态只响应事件重绘；本地游戏隐藏后暂停，回到前台仍等待玩家继续。

自适应高档目标 60 帧；连续两次采样窗判定为高负载后降到 30 帧，普通尺寸字符网格同时从 96×32 降到 80×26。降档不自动反复升档，可重新选择自适应重试。30 帧档仍通过前台帧回调推进 240 次/秒目标的固定步长物理，而不是把球或球拍运动减速。

单次帧回调最多补算 20 个物理步；大卡顿时会丢弃过量累计时间，避免无限补算。它不是硬实时系统；极慢 CPU 上不能同时保证准时物理和任意画面帧率。性能详情中的「卡顿丢弃时间」用于观察这一情况。

## 本次实际环境

- Linux x86-64 / KVM 容器；5 个可见 vCPU，报告型号 AMD EPYC 9V74。
- Chromium **144.0.7559.96**，无头模式，1366×768，设备像素比 1。
- 显式禁用 GPU、GPU 合成、加速 Canvas、WebGL 及软件 3D 光栅器路径；通过 DevTools `SystemInfo.getInfo` 核实实际状态，不只凭启动参数判断。
- 返回状态：`gpu_compositing=disabled_software`、`rasterization=disabled_software`、`2d_canvas=disabled_software`；WebGL、WebGPU、OpenGL 和 Vulkan 为禁用。
- 使用真实浏览器加载完整 HTML 内容，但通过 `set_content` 注入空白页面。容器禁止直接导航 `file://` 与本地 HTTP，因此**不是本地双击文件或线上 URL 导航测试**。

## 连续运动测试

每种工况预热约 1.1 秒后采样 10 秒，关闭音效。测试夹具只在浏览器内临时让两侧球拍自动接球，保持球连续运动并保留正常碰撞与功能效果；不是在等发球画面上测帧率，也不修改发布的游戏文件。CPU 节流使用 Chromium DevTools 的 6 倍节流设置，不等同于某种具体旧电脑。

| 工况 | 字符网格 | 画面提交频率 | 绘制函数脚本平均 / P95 | 提交间隔 P95 / 最大 | Canvas 上下文调用 |
| --- | --- | ---: | ---: | ---: | ---: |
| 自适应，正常 CPU | 96×32 | 59.99 次/秒 | 0.0645 / 0.20 ms | 17.10 / 49.90 ms | 0 |
| 自适应，6 倍 CPU 节流 | 96×32 | 59.99 次/秒 | 0.3277 / 1.30 ms | 18.90 / 28.80 ms | 0 |
| 节能档，6 倍 CPU 节流 | 80×26 | 29.99 次/秒 | 0.4573 / 1.50 ms | 35.60 / 44.20 ms | 0 |

**测量口径：**「提交频率」为调用游戏绘制函数的次数，不是显示器实际呈现帧率。绘制函数脚本耗时不包含后续浏览器排版、绘制和显示；因此不能把 0.x ms 的脚本耗时说成完整一帧耗时。提交间隔也并非全部完全均匀，正常工况出现过接近 50 ms 的单次间隔，不宣称完全没有卡顿。

完整结果包含 DevTools 的 TaskDuration、ScriptDuration、LayoutDuration、RecalcStyleDuration 增量，保存在 `validation/`。这些是当前环境单次测试结果，不是跨设备认证或所有配置的最低保证。

## 额外验证

完全封锁 `HTMLCanvasElement.getContext` 时，默认 ASCII 仍能进入倒计时；尝试切到图形会显示提示并自动回到 ASCII。菜单与暂停的帧循环停止、相同画面不写文本行、字符模式不记录拖尾均已检查。

向每次绘制注入约 35 ms 的人工主线程阻塞后，自适应降到 30 帧与低密度网格。这个用例用于检验降档逻辑，不能解释成实际无人工阻塞时也达到同等帧率。

## 在自己的电脑上看

直接在游戏内展开「画面与性能」即可看本机采样；较弱设备使用「30 帧节能」。默认 ASCII 已不要求 GPU API，不必为了玩游戏额外安装测试工具。

开发者可选用附带脚本复现相同软件渲染测试。需要 Python 3.10+、Playwright 和可用的 Chromium；已有 Chrome/Chromium 时也可用 `--browser` 指定可执行文件。

```sh
python -m pip install playwright
python -m playwright install chromium
python tools/benchmark.py index.html --seconds 10 --profile auto --out result-auto.json
python tools/benchmark.py index.html --seconds 10 --cpu-rate 6 --profile auto --out result-cpu6.json
python tools/benchmark.py index.html --seconds 10 --cpu-rate 6 --profile eco --out result-eco.json
```

测试脚本注入本地 HTML 内容、运行自动接球夹具并导出 JSON，不会改写 `index.html`，也不会验证公网联机。测试路径与发布游戏的正常操作路径不同，结果需按上述口径解读。

## 设计参考

[MDN：requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) 说明帧回调与显示刷新、后台页面调度的关系；[web.dev：避免大规模布局和布局抖动](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing) 说明布局读取、修改交错的开销；[MDN：textContent](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent) 区分文本内容与依赖样式的文本读取。浏览器仍负责文本的排版和绘制，本项目没有能力保证其在任意设备上的耗时。
