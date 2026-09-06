# ASCII 软件渲染记录

对象：6.0.0 最终代码，`ascii_start.html`。环境：本执行环境的桌面 Chromium，`--disable-gpu`；CDP CPU 节流分别为 1 倍与 6 倍。

## 场景与方法

完整 HTML 通过 `page.set_content` 注入真实浏览器，使用正常 requestAnimationFrame 游戏循环。房间为单设备权威主机，1 名真人加 3 个 AI；测试辅助定时器只替测试玩家按发球，不替代物理循环。每种工况连续采样约 3.5 秒。

测量包装游戏绘制方法的提交调用，并拦截 `HTMLCanvasElement.getContext` 计数。它测量的是脚本提交频率，**不是屏幕实际显示 FPS、输入到显示延迟或长时稳定性**。多人协议的真实网络负载未包含在该性能场景中。

| 工况 | 绘制提交次数 | 采样时长 | 平均提交频率 | 提交间隔 P95 | Canvas 请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 倍 CPU 节流 | 210 | 3.503 s | 59.95/s | 17.70 ms | 0 |
| 6 倍 CPU 节流 | 210 | 3.506 s | 59.90/s | 20.00 ms | 0 |

两组结束时都在 playing 状态，三个 AI，物理数值有限，无未捕获脚本异常。

## 浏览器报告的图形状态

`2d_canvas`、`gpu_compositing`、`rasterization` 为 `disabled_software`；`webgl`、`webgpu`、`opengl`、`vulkan` 为关闭状态。完整记录见 `validation/team_ui.json` 的 `gpuFeatureStatus`。

## 结论边界

本次场景确认 ASCII 入口没有请求图形上下文，并在当前 CPU 条件与模拟节流下保持上述提交频率。浏览器仍需进行文字布局、软件绘制和操作系统显示处理。不承诺任意旧 CPU 恒定 60 帧，也不将 6 倍节流等同于某个真实硬件型号。

图形入口按需创建 Canvas，用于精致材质与光效；ASCII 入口启动时跳过该路径。界面检查也覆盖从图形切回 ASCII 停止图形渲染并释放缓存，但这不等于“该浏览器进程从未创建过 Canvas”。
