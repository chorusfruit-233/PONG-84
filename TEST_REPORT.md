# PONG-84 P2P v2 测试说明

测试日期：2026-09-05

## 测试环境与边界

JavaScript 通过 Node.js 语法检查。浏览器检查使用 Chromium，将 HTML 注入 about:blank 文档执行；双端部分在两个独立应用文档中使用内存 WebRTC / PeerJS 模拟适配器，不是实际联网。测试模拟代码未加入发布的 index.html。

另外使用真实 RTCPeerConnection 检查了双数据通道的可靠性参数、真实 SDP 生成/解析、offer-answer 设置后双方 signalingState 为 stable，以及局域网配置中 iceServers 为空。SDP 协商成功不代表网络通道已经接通。

受执行环境浏览器和网络策略限制，本地 file:// 和回环 HTTP 导航被阻止，真实 WebRTC 未收集到可用连接地址；未完成两台物理设备、公网 PeerJS、TURN、实际 GitHub Pages 部署后的端到端验证，也未实测 Firefox / Safari。

## 41 项界面、逻辑及模拟双端检查

| 编号 | 检查项 | 结果 |
|---|---|---|
| 1 | Boot both application documents | 通过 |
| 2 | No automatic CDN or signaling requests | 通过 |
| 3 | Human movement and powerup constants retained | 通过 |
| 4 | Space serves without resetting scores | 通过 |
| 5 | ASCII toggle preserves game, score and effect | 通过 |
| 6 | ASCII surface uses printable ASCII and LF only | 通过 |
| 7 | AI never gains score-streak shield | 通过 |
| 8 | Manual host invitation generated after complete ICE | 通过 |
| 9 | LAN transport configuration has no external ICE servers | 通过 |
| 10 | Native channel quality flags | 通过 |
| 11 | Connection-code roundtrip and whitespace tolerance | 通过 |
| 12 | Wrong connection-code type rejected | 通过 |
| 13 | Damaged connection code rejected | 通过 |
| 14 | Short cloud room code rejected in manual form | 通过 |
| 15 | Invitation file import | 通过 |
| 16 | Guest response generated | 通过 |
| 17 | Response carries matching session ID | 通过 |
| 18 | SIMULATED dual datachannel connection | 通过 |
| 19 | Only host can start match | 通过 |
| 20 | Match ID synchronized | 通过 |
| 21 | Exit multiplayer button visible | 通过 |
| 22 | SIMULATED host serve and score retention | 通过 |
| 23 | SIMULATED client Space serve delivered to host | 通过 |
| 24 | SIMULATED client movement reaches host | 通过 |
| 25 | Render modes independent across peers | 通过 |
| 26 | SIMULATED authoritative score propagation | 通过 |
| 27 | Previous-round snapshots rejected after rematch | 通过 |
| 28 | Realtime packets dropped rather than queued under backpressure | 通过 |
| 29 | Malformed snapshot validation | 通过 |
| 30 | SIMULATED explicit disconnect propagates | 通过 |
| 31 | Cancel generation discards late callbacks | 通过 |
| 32 | Relay requires TURN config | 通过 |
| 33 | LAN rejects forced relay | 通过 |
| 34 | Manual config ignores invalid cloud-only fields | 通过 |
| 35 | SIMULATED cloud 4-digit room creation | 通过 |
| 36 | SIMULATED cloud ctrl/rt adapter connection | 通过 |
| 37 | Cloud room IDs do not depend on website hostname | 通过 |
| 38 | SIMULATED cloud start message | 通过 |
| 39 | No script exceptions during regression | 通过 |
| 40 | No real external calls made by simulation | 通过 |
| 41 | Landscape touch layout has usable input bounds | 通过 |

## 发布后的两设备验收建议

先使用同一局域网的两台设备打开新版文件，按邀请码→回应码→房主确认的流程连接，检查双方发球、移动、比分、再来一局和退出。然后用实际不同网络分别验证手动方式及云房间。配置真实 TURN 后勾选强制中继，并确认连接诊断显示 TURN 中继。最后在真实 Pages 地址重复这些步骤。

以上是部署验收建议，不代表这些现场网络测试已经执行。
