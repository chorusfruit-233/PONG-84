# v4 回归测试记录

日期：2026-09-05。**55 / 55 项通过，无未捕获 JavaScript 异常。** 原始结果为 `validation/regression.json`。

采用真实 Chromium 的 DOM、Canvas 与原生 Fullscreen API，注入发布 HTML；测试使用内存偏好、可复现对局状态与模拟键盘/指针。全屏断言同时检查 `document.fullscreenElement`、球场边界、临时菜单和可操作按钮，不是仅检查 CSS 类。视口覆盖 1920×1080、1440×900、2560×1080、1024×768、390×844 和 844×390；两种画面逐项验证。

未完成：file:// 双击导航、HTTP/Pages 实际部署、实体操作系统的地址栏/任务栏显示验证、实体手机手势与刘海区域、公网 PeerJS/TURN 和两台设备联机。未将上述项目计入通过项。

另完成两个定向检验：`ascii_start.html` 在已有图形偏好时仍以零 Canvas 请求启动；主入口在 Canvas 2D 不可用时正确回退 ASCII。详见 `validation/targeted_checks.json`，不并入上述 55 项回归计数。

软件渲染性能另见 [PERFORMANCE.md](PERFORMANCE.md)。本报告只对应此发布版本，未沿用上一版本的测试计数。

| 编号 | 检查项 | 结果 |
| --- | --- | --- |
| 1 | Fresh default is high-quality graphics | 通过 |
| 2 | Canvas backing follows displayed size and high DPI | 通过 |
| 3 | Graphical renderer created lazily in graphic mode | 通过 |
| 4 | Menu has no continuous game frame loop | 通过 |
| 5 | ASCII energy profile cannot cap graphical FPS | 通过 |
| 6 | Graphical quality changes actual resolution | 通过 |
| 7 | Display changes preserve entire paused gameplay state | 通过 |
| 8 | Space serves without replacing match ID | 通过 |
| 9 | Held/repeated Space does not serve the next rally | 通过 |
| 10 | Released and pressed Space serves again | 通过 |
| 11 | Uses native Fullscreen API | 通过 |
| 12 | Graphics full viewport 1920x1080 | 通过 |
| 13 | ASCII full viewport 1920x1080 | 通过 |
| 14 | ASCII context/cache released 1920x1080 | 通过 |
| 15 | Graphics full viewport 1440x900 | 通过 |
| 16 | ASCII full viewport 1440x900 | 通过 |
| 17 | ASCII context/cache released 1440x900 | 通过 |
| 18 | Graphics full viewport 2560x1080 | 通过 |
| 19 | ASCII full viewport 2560x1080 | 通过 |
| 20 | ASCII context/cache released 2560x1080 | 通过 |
| 21 | Graphics full viewport 1024x768 | 通过 |
| 22 | ASCII full viewport 1024x768 | 通过 |
| 23 | ASCII context/cache released 1024x768 | 通过 |
| 24 | Graphics full viewport 390x844 | 通过 |
| 25 | ASCII full viewport 390x844 | 通过 |
| 26 | ASCII context/cache released 390x844 | 通过 |
| 27 | Graphics full viewport 844x390 | 通过 |
| 28 | ASCII full viewport 844x390 | 通过 |
| 29 | ASCII context/cache released 844x390 | 通过 |
| 30 | Fullscreen controls automatically hide and become inert | 通过 |
| 31 | Reveal button reopens controls | 通过 |
| 32 | Fullscreen pause shows temporary menu overlay | 通过 |
| 33 | Pause overlay bounded within screen | 通过 |
| 34 | Paused frame loop stops | 通过 |
| 35 | Resume removes sidebar again | 通过 |
| 36 | F exits native fullscreen and restores normal layout | 通过 |
| 37 | Human paddle speed remains 1100 | 通过 |
| 38 | Computer speed and shield remain unboosted | 通过 |
| 39 | Random effect generation never enlarges AI paddle or grants shield | 通过 |
| 40 | ASCII cold boot requests zero canvas contexts | 通过 |
| 41 | ASCII cold boot allocates no graphical renderer | 通过 |
| 42 | ASCII uses persistent Text nodes only | 通过 |
| 43 | ASCII menu stops scheduling animation frames | 通过 |
| 44 | ASCII visible UI has no filters/shadows/animations/compositing hints | 通过 |
| 45 | ASCII energy mode targets 30 Hz | 通过 |
| 46 | ASCII gameplay still makes zero Canvas requests | 通过 |
| 47 | Identical ASCII frames cause no row writes | 通过 |
| 48 | Denied fullscreen keeps normal layout and informs user | 通过 |
| 49 | Portrait normal page has no horizontal overflow | 通过 |
| 50 | Touch layer covers full graphical court | 通过 |
| 51 | Touch layer remains aligned in fullscreen ASCII | 通过 |
| 52 | Landscape normal page has no horizontal overflow | 通过 |
| 53 | No uncaught browser JavaScript errors | 通过 |
| 54 | OnlinePeer source unchanged by UI rewrite | 通过 |
| 55 | InputManager source unchanged by UI rewrite | 通过 |
