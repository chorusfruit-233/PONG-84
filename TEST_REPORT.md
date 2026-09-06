# 本次发布测试报告

对象：PONG-84 6.0.0 / 团队协议 v2。报告只记录本次实际执行结果，不沿用旧发布的测试数。

## 自动检查结果

| 范围 | 通过 / 总数 | 方法 |
| --- | ---: | --- |
| 多设备团队逻辑与协议 | 66 / 66 | 独立 Chromium 浏览器上下文，真实房间/物理代码，**显式内存消息传输替身** |
| 新团队 UI、操作与性能 | 37 / 37 | 真实 DOM / 按键 / 原生 Fullscreen API，模拟移动端触控，软件渲染采样 |
| 原有功能回归 | 75 / 75 | 单打、原有渲染与输入、六组宽高比、横屏提示等 |
| **合计** | **178 / 178** | 不是 178 次真实网络实战 |

以上三组没有记录未捕获浏览器 JavaScript 异常。构建后的 `validation/compiled.js` 已通过 `node --check`。原始记录保留在 `validation/*.json`。

## 网络检查：哪些成功，哪些没有成功

`tools/test_native_environment.py` 使用未经修改的生产邀请生成路径，结果如下：

- `file://` 导航：失败，`ERR_BLOCKED_BY_ADMINISTRATOR`。没有修改浏览器策略或绕过禁止。
- 生产手动邀请：失败，浏览器未提供可用连接地址；地址完整性检查仍然生效，没有把空邀请当成功。
- 原生 offer / answer API：双方 signalingState 到达 stable；可靠控制通道有序，实时通道 `ordered=false, maxRetransmits=0`。
- ICE 候选数：双方均为 0；连接仍为 new，**未连接**。

这些原生 API 结果不能证明 WebRTC 数据已经流通。未完成实体四设备、PeerJS 公共信令、TURN、线上 GitHub Pages 或真实浏览器本地文件打开的端到端验收。自动迁移的主备连接协商、公网时序与跨设备故障行为仍需实机验证。

## 协议测试覆盖

测试加载完整生产页面到独立浏览器上下文，再把数据通道跨页传输替换为显式队列；房间身份检查、操作权限、物理、检查点、投票、恢复与 UI 仍使用生产实现。测试时钟可控，部分路径直接构造合法输入/状态。

覆盖 2+2+观众、四个单人设备、后加入观众、同机双输入、错席发球、过期/乱序数据、陌生玩家 ID、非法数值、20% 确定性实时丢包、AI 接管与返回、前后碰撞、共享效果权限、见证多数迁移、旧主机隔离、有序两节点移交与两节点突然断线拒绝选主。

**替身并不经过真实 ICE / NAT / TURN；测试通过不等于实际 P2P 建连成功。** 没有宣称实现通过形式化共识证明或对抗性安全审计。

## UI 与画面测试覆盖

真实触发人数/阵型选项、AI/迁移复选框、准备/开始、两组键盘、两个发球按钮、原生全屏与退出。移动端采用触控能力、视口与指针事件模拟，不是实体手机。检查包含两指独立运动、取消一指不发球、横竖屏提示和保留 16:9 球场。

截图 `screenshots/depth_court.webp`、`screenshots/team_controls.webp` 来自固定比赛状态的真实渲染，不是联网对打记录。

## ASCII 性能采样

| 工况 | 绘制提交次数 | 采样时长 | 平均提交频率 | 提交间隔 P95 | Canvas 请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 倍 CPU 节流 | 210 | 3.503 s | 59.95/s | 17.70 ms | 0 |
| 6 倍 CPU 节流 | 210 | 3.506 s | 59.90/s | 20.00 ms | 0 |

场景为 1 真人 + 3 AI、ASCII 作为权威主机。关闭 GPU 加速与 CPU 节流已由浏览器诊断记录；测量提交频率不代表显示器真实 FPS。详见 [性能报告](PERFORMANCE.md)。

## 可复现命令

```sh
python tools/build.py
node --check validation/compiled.js
python tools/test_team_protocol.py
python tools/test_team_ui.py
python tools/regression.py
python tools/test_native_environment.py
```

原生环境检查的输出是诊断，不使用“脚本退出成功”代表“ICE 接通”。请在自己的设备和网络中重新检查。

## 正式公网发布前仍需完成

需要在实际浏览器直接打开两个入口，完成四台设备同局域网及混合网络试打；验证 2+2+观众见证的突发掉线迁移、原房主回连、云短码更新和 TURN 中继；验证 iOS/Android 原生全屏、多指操控、锁屏/后台；长时检查分数和道具一致性、带宽、内存及低端主机帧耗时。上述项目本次未完成，不填写虚构结果。

## 自动检查逐项结果

### 团队协议

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 2 + 2 occupy four independent seats on two devices | 通过 |
| 2 | Viewer has no player object | 通过 |
| 3 | No Canvas context on all ASCII cold starts | 通过 |
| 4 | All rosters pass production validation | 通过 |
| 5 | Cannot begin without human device readiness | 通过 |
| 6 | Full same-team allocation fails atomically | 通过 |
| 7 | Same-device controls can exchange front/back positions | 通过 |
| 8 | Formation rule reaches clients and clears readiness | 通过 |
| 9 | Start after per-device readiness and standby mesh | 通过 |
| 10 | Barrier prepares and releases all independent pages | 通过 |
| 11 | Checkpoint committed with three-device voter group | 通过 |
| 12 | W/S and arrows move same-device teammates independently | 通过 |
| 13 | Two-player remote input uses two authenticated player IDs | 通过 |
| 14 | Space does not serve the other local teammate | 通过 |
| 15 | Enter serves local player 2 without restarting match | 通过 |
| 16 | Repeated serve ignored in ongoing rally | 通过 |
| 17 | Spectator cannot pause or forge player input | 通过 |
| 18 | Spectator cannot request a serve | 通过 |
| 19 | Spectator readiness does not gate gameplay | 通过 |
| 20 | Input guard: foreign | 通过 |
| 21 | Input guard: nan | 通过 |
| 22 | Input guard: term | 通过 |
| 23 | Input guard: round | 通过 |
| 24 | Input guard: clamp | 通过 |
| 25 | Input guard: stale | 通过 |
| 26 | Depth physics: front | 通过 |
| 27 | Depth physics: back | 通过 |
| 28 | Depth physics: friendly | 通过 |
| 29 | Depth physics: reject | 通过 |
| 30 | Authority checkpoint restores hidden timers and bot state | 通过 |
| 31 | Spectator can join after match start without restarting | 通过 |
| 32 | Late spectator not silently inserted into current electorate | 通过 |
| 33 | Disconnect replaces both same-device teammates with AI | 通过 |
| 34 | AI no-benefit: noLong | 通过 |
| 35 | AI no-benefit: noShield | 通过 |
| 36 | AI no-benefit: longTargets | 通过 |
| 37 | AI no-benefit: noSpeed | 通过 |
| 38 | AI no-benefit: noSmall | 通过 |
| 39 | AI no-benefit: noSlow | 通过 |
| 40 | AI no-benefit: noBig | 通过 |
| 41 | AI no-benefit: noSpin | 通过 |
| 42 | AI no-benefit: speedCap | 通过 |
| 43 | Reconnected human waits for next rally boundary | 通过 |
| 44 | New serve returns both paddles to original people | 通过 |
| 45 | Same committed checkpoint reaches all members | 通过 |
| 46 | Isolated old host stops physics on majority lease loss | 通过 |
| 47 | Remaining player becomes host with spectator witness vote | 通过 |
| 48 | Observers follow elected authority without becoming host | 通过 |
| 49 | Migration retains team scores and hidden effect timer | 通过 |
| 50 | Old host two-seat team is replaced by AI after election | 通过 |
| 51 | New host automatically issues synchronized resume barrier | 通过 |
| 52 | Delayed old-host state fenced out by term and authority ID | 通过 |
| 53 | No browser runtime errors in mixed-player room | 通过 |
| 54 | Start after per-device readiness and standby mesh | 通过 |
| 55 | Barrier prepares and releases all independent pages | 通过 |
| 56 | Two-device orderly handoff receives explicit acknowledgement | 通过 |
| 57 | Orderly handoff moves authority and preserves score | 通过 |
| 58 | Start after per-device readiness and standby mesh | 通过 |
| 59 | Barrier prepares and releases all independent pages | 通过 |
| 60 | Two-device sudden loss does not manufacture a quorum | 通过 |
| 61 | Four-device consent-based seat swapping preserved | 通过 |
| 62 | Start after per-device readiness and standby mesh | 通过 |
| 63 | Barrier prepares and releases all independent pages | 通过 |
| 64 | Original split formation seam accelerates exactly once | 通过 |
| 65 | 20 percent deterministic RT loss keeps valid room membership | 通过 |
| 66 | No uncaught browser exceptions in all protocol scenarios | 通过 |

### 团队 UI

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | New room UI creates a two-person team plus two CPUs | 通过 |
| 2 | Formation selectors are locked during a match | 通过 |
| 3 | Two independently labeled serve buttons are visible | 通过 |
| 4 | Real keyboard events address two teammate paddles | 通过 |
| 5 | Player 2 key cannot serve for player 1 | 通过 |
| 6 | Space serves current teammate without clearing score | 通过 |
| 7 | Held Space cannot serve another rally | 通过 |
| 8 | Released Space can serve again | 通过 |
| 9 | Player 2 toolbar button serves only player 2 | 通过 |
| 10 | Host can open invitation/observer tools without pausing | 通过 |
| 11 | Manual connection cards cover all seven guest devices | 通过 |
| 12 | Team mode uses native fullscreen | 通过 |
| 13 | Team fullscreen aspect fit 1920x1080 | 通过 |
| 14 | Team fullscreen aspect fit 1440x900 | 通过 |
| 15 | Team fullscreen aspect fit 2560x1080 | 通过 |
| 16 | Team fullscreen aspect fit 1024x768 | 通过 |
| 17 | Graphics still allocates optical renderer | 通过 |
| 18 | Switching to ASCII releases graphics contexts and caches | 通过 |
| 19 | Rendering/fullscreen changes do not replace match identity | 通过 |
| 20 | Leaving a solo-host team clears room and returns menu | 通过 |
| 21 | Existing singles modes remain reachable after leaving team room | 通过 |
| 22 | Mobile portrait shows orientation hint | 通过 |
| 23 | Landscape dismisses portrait hint | 通过 |
| 24 | Same-device team activates the dual-pointer touch layer | 通过 |
| 25 | Two emulated touch pointers move independent teammates | 通过 |
| 26 | Cancelling one touch neither serves nor releases the other | 通过 |
| 27 | Touch gameplay and landscape changes allocate no Canvas in ASCII | 通过 |
| 28 | Returning portrait shows hint again | 通过 |
| 29 | Lobby formation select actually changes authoritative rules | 通过 |
| 30 | Lobby device-count select atomically adds a teammate | 通过 |
| 31 | AI checkbox removes empty-seat bots and blocks incomplete start | 通过 |
| 32 | AI checkbox restores two vacant-seat bots | 通过 |
| 33 | Migration checkbox updates room policy | 通过 |
| 34 | Current host cannot turn into a spectator without handing off | 通过 |
| 35 | ASCII authoritative device with 3 CPUs stays finite / zero Canvas at throttle 1 | 通过 |
| 36 | ASCII authoritative device with 3 CPUs stays finite / zero Canvas at throttle 6 | 通过 |
| 37 | No uncaught browser JavaScript errors in team UI tests | 通过 |

### 原有回归

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | Fresh default is high-quality graphics | 通过 |
| 2 | Canvas backing uses high DPI with exact 16:9 pixel grid | 通过 |
| 3 | Graphical renderer created lazily in graphic mode | 通过 |
| 4 | Menu has no continuous game frame loop | 通过 |
| 5 | ASCII energy profile cannot cap graphical FPS | 通过 |
| 6 | Graphical quality changes actual resolution | 通过 |
| 7 | Display changes preserve entire paused gameplay state | 通过 |
| 8 | Space serves without replacing match ID | 通过 |
| 9 | Held/repeated Space does not serve the next rally | 通过 |
| 10 | Released and pressed Space serves again | 通过 |
| 11 | Uses native Fullscreen API | 通过 |
| 12 | Graphics native fullscreen contained 16:9 1920x1080 | 通过 |
| 13 | ASCII native fullscreen contained 16:9 1920x1080 | 通过 |
| 14 | ASCII context/cache released 1920x1080 | 通过 |
| 15 | Graphics native fullscreen contained 16:9 1440x900 | 通过 |
| 16 | ASCII native fullscreen contained 16:9 1440x900 | 通过 |
| 17 | ASCII context/cache released 1440x900 | 通过 |
| 18 | Graphics native fullscreen contained 16:9 2560x1080 | 通过 |
| 19 | ASCII native fullscreen contained 16:9 2560x1080 | 通过 |
| 20 | ASCII context/cache released 2560x1080 | 通过 |
| 21 | Graphics native fullscreen contained 16:9 1024x768 | 通过 |
| 22 | ASCII native fullscreen contained 16:9 1024x768 | 通过 |
| 23 | ASCII context/cache released 1024x768 | 通过 |
| 24 | Graphics native fullscreen contained 16:9 390x844 | 通过 |
| 25 | ASCII native fullscreen contained 16:9 390x844 | 通过 |
| 26 | ASCII context/cache released 390x844 | 通过 |
| 27 | Graphics native fullscreen contained 16:9 844x390 | 通过 |
| 28 | ASCII native fullscreen contained 16:9 844x390 | 通过 |
| 29 | ASCII context/cache released 844x390 | 通过 |
| 30 | Wide desktop without touch does not show mobile portrait hint | 通过 |
| 31 | Fullscreen resize does not reset paused score, effects or serve | 通过 |
| 32 | Fullscreen controls automatically hide and become inert | 通过 |
| 33 | Reveal button reopens controls | 通过 |
| 34 | Fullscreen pause shows temporary menu overlay | 通过 |
| 35 | Pause overlay bounded within screen | 通过 |
| 36 | Paused frame loop stops | 通过 |
| 37 | Resume removes sidebar again | 通过 |
| 38 | F exits native fullscreen and restores normal layout | 通过 |
| 39 | Human paddle speed remains 1100 | 通过 |
| 40 | Computer speed and shield remain unboosted | 通过 |
| 41 | Random effect generation never enlarges AI paddle or grants shield | 通过 |
| 42 | Graphical redraws and particles do not consume gameplay PRNG | 通过 |
| 43 | Static optical court cache is reused | 通过 |
| 44 | Burst particles and shockwaves have hard object bounds | 通过 |
| 45 | ASCII cold boot requests zero canvas contexts | 通过 |
| 46 | ASCII cold boot allocates no graphical renderer | 通过 |
| 47 | ASCII uses persistent Text nodes only | 通过 |
| 48 | ASCII menu stops scheduling animation frames | 通过 |
| 49 | ASCII visible UI has no filters/shadows/animations/compositing hints | 通过 |
| 50 | ASCII energy mode targets 30 Hz | 通过 |
| 51 | ASCII gameplay still makes zero Canvas requests | 通过 |
| 52 | Identical ASCII frames cause no row writes | 通过 |
| 53 | Denied fullscreen keeps normal layout and informs user | 通过 |
| 54 | Mobile portrait hint visible even below 500 px | 通过 |
| 55 | Orientation tip can be dismissed | 通过 |
| 56 | Dismissal persists across same-orientation resize | 通过 |
| 57 | Landscape automatically hides orientation hint | 通过 |
| 58 | Hint returns on next portrait orientation | 通过 |
| 59 | Hint fullscreen button uses native API | 通过 |
| 60 | Portrait fullscreen menu does not cover orientation hint | 通过 |
| 61 | Portrait normal page has no horizontal overflow | 通过 |
| 62 | Touch layer covers full graphical court | 通过 |
| 63 | Touch layer remains aligned in fullscreen ASCII | 通过 |
| 64 | Mobile full portrait keeps black bars and a 16:9 court | 通过 |
| 65 | Dismissing hint neither pauses nor restarts the match | 通过 |
| 66 | Graphical touch coordinates exclude letterbox bars | 通过 |
| 67 | Pointer cancellation releases control without serving | 通过 |
| 68 | ASCII touch center maps to world center | 通过 |
| 69 | Landscape normal page has no horizontal overflow | 通过 |
| 70 | ASCII mobile orientation tip uses text symbol instead of SVG | 通过 |
| 71 | Cold ASCII orientation/fullscreen path requests zero Canvas contexts | 通过 |
| 72 | Reduced-motion preference disables burst particles and shockwaves | 通过 |
| 73 | No uncaught browser JavaScript errors | 通过 |
| 74 | OnlinePeer source unchanged by UI rewrite | 通过 |
| 75 | InputManager source unchanged by UI rewrite | 通过 |
