# PONG-84：本地 P2P 联机与 GitHub Pages 部署说明

版本：P2P v2 · 2026-09-05

本版基于 `index_ascii.html` 修改。空格/回车发球防重开、ASCII 纯字符模式、真人键盘移速 1100、高频功能球、人机不获得增益等现有逻辑保留。新增的是联机入口、连接管理和网络设置，不是重新制作另一款游戏。

## 1. 文件与适用范围

`index.html` 是完整游戏。电脑可用支持 WebRTC 的完整浏览器打开本地 HTML；发布到静态网站时使用同一个文件，不需要构建或启动本地 Node.js 服务。浏览器对 `file://`、隐私设置及设备网络的处理仍会影响实际可用性，不能保证每一种浏览器/网络均能直连。[6]

本地对战、ASCII 渲染和手动 P2P 的代码全部内置。只有点击云端创建/加入房间时，才按需加载 PeerJS 1.5.5；先尝试 unpkg，再尝试 jsDelivr。云联机不是离线功能，外部组件及信令服务的可达性需要在使用网络中验证。

| 联机入口与网络范围 | 是否使用外部信令 | 游戏代码/组件 | 网络条件 |
|---|---|---|---|
| 手动 P2P + 同一局域网 | 不使用，人工交换连接码 | 全部内置，不加载 PeerJS | 两台设备须能互通；不调用 STUN/TURN |
| 手动 P2P + 跨网络 | 不使用，人工交换连接码 | 全部内置，不加载 PeerJS | 使用所配置 STUN；无法直连时需要可用 TURN |
| 云端 4 位房间码 | 使用公共或自建 PeerServer | 按需加载 PeerJS | 信令服务必须可达；直连/中继另由 ICE 配置决定 |

**纯前端不等于“在任何网络下都不需要基础设施”。** 手动传递邀请码/回应码代替了自动信令服务；它不代替 NAT 穿透或 TURN 中继。WebRTC 将信令与实际连接分开，交换完成也不代表通道已经接通。[3][4]

## 2. 本地 HTML：手动 P2P 操作

双方使用这一新版 HTML，不要一方仍使用之前的旧版本。

### 2.1 先选择网络范围

双方打开文件，选择「联机对战」→「本地 P2P · 手动连接」。

同一家庭网络、同一 Wi-Fi 或可互通的局域网，选择「同一局域网 · 不使用 STUN/TURN」。这个组合不向外部信令、STUN、TURN 服务发起连接，也不加载外部脚本。两人可以通过已有聊天渠道或传文件交换连接码；聊天工具自身的网络使用不属于游戏内部连接。

不在同一局域网，选择「跨网络 · STUN / 可选 TURN」。默认提供 Cloudflare 和 Google 的 STUN 地址，是否可达取决于双方网络。某个地址不可达或导致收集超时时，可在高级设置中换成双方能访问的服务，或只保留已确认可用的地址。不要仅仅因为页面能打开，就认定 STUN 也一定可达。

双方的“网络范围”必须相同。STUN/TURN 服务不必完全相同，但各自填入的配置都必须有效。不要选择局域网后又勾选强制 TURN。

### 2.2 邀请、回应与开始

| 顺序 | 谁操作 | 操作 |
|---|---|---|
| 1 | 房主 | 点击「我是房主 · 生成邀请」，等待地址收集结束，将上方完整邀请码发给对方。 |
| 2 | 加入者 | 点击「我是加入者 · 粘贴邀请」，粘贴收到的邀请码，再点击「生成回应码」。 |
| 3 | 加入者 | 将新生成的回应码发回房主，保留当前页面。 |
| 4 | 房主 | 将回应码粘贴到下方输入框，点击「确认回应并连接」。 |
| 5 | 双方 | 等待显示连接成功；由房主点击「开始游戏」。 |

邀请码/回应码以 `P84V2.` 开头，内容较长，不是 4 位房间码。两次传递缺一不可。

「复制连接码」失败时可手动选中全文复制。也可点击「保存为文件」，把文本文件发送给对方，对方点击「从文件读取」，然后点击相应确认按钮。文件大小上限为 64 KB；粘贴时允许换行，但不允许夹杂聊天说明。复制完整性校验用于检测损坏，不是身份认证或加密签名。

生成邀请后不要刷新、关闭页面或再次生成邀请。刷新、取消、重新生成后，旧码不再对应当前连接。连接码包含协商信息及候选连接地址，只发给本次对手，不要公开张贴。

### 2.3 控制与退出

房主控制左拍，加入者控制右拍。双方均可使用 W/S 或上下方向键，轮到自己发球时按空格或回车。触屏设备在游戏区域拖动控制，轮到自己发球时松手发球。

R 切换自己的图形/ASCII 画面，不改变另一端的显示风格，不重置比分或道具。F 切换全屏。联机不启用本地单方暂停；可以点击右上角「退出联机」。

房主计算球、碰撞、得分和效果；加入者同步输入，使用本地球拍预测与房主状态校正。目标状态和输入频率均为 60 Hz，实际表现受设备帧率和网络影响。比赛使用独立标识，上一局的延迟状态包不能覆盖新一局。

对局期间尽量让双方页面保持前台。浏览器后台节流、手机锁屏或网络切换可能影响实时对战；本版不是无缝重连系统，长时间断线后需要重新邀请。

## 3. 发布到 GitHub Pages

### 3.1 上传文件

解压发布包，把以下文件直接放入仓库根目录，不要只上传 ZIP，也不要多套一层目录：

```text
你的仓库/
├── index.html
├── .nojekyll
├── README.md
└── TEST_REPORT.md
```

`index.html` 是入口；其他文件是发布标记和说明。仅运行游戏时不需要另外下载脚本文件，也不需要 npm 构建。云联机按需获取的 PeerJS 仍是外部依赖。

仓库已经有网站时，先备份原入口，再替换相应文件。新建仓库可使用自己的仓库名；免费方案通常使用公开仓库。[1]

### 3.2 开启 Pages

进入仓库「Settings」→「Pages」；在「Build and deployment」中选择：

```text
Source:  Deploy from a branch
Branch:  main（或实际存放文件的分支）
Folder:  / (root)
```

点击 Save。等待该次 Pages 部署成功，使用 Pages 设置页显示的网址访问。检查仓库 Actions 中的部署日志可确认是否成功。分支与发布目录必须与实际文件位置一致。[2]

在 Pages 设置里启用「Enforce HTTPS」。本版自建信令设置默认勾选安全信令；HTTPS 网页不要连接普通 `ws://` 信令端点。[5][7]

**已经发布页面，不等于已经部署联机后台。** GitHub Pages 负责提供 HTML、CSS、JavaScript 静态文件；信令服务和 TURN 不是 Pages 自动提供的功能，也不能作为常驻 Node.js/WebSocket 进程直接运行在 Pages 上。[1][3][4]

## 4. 静态 Pages 上的三种联机方案

### 方案 A：继续手动 P2P，不部署信令服务器

双方打开 Pages 网站后，照第 2 节交换邀请/回应即可。前端没有同站点限制，使用本文件的本地端和 Pages 端也可按照相同流程交换；实际连通仍取决于网络及浏览器策略。

适合朋友之间使用，能接受手动复制较长连接码。纯局域网可完全不用外部网络服务；跨网络失败时仍要处理 STUN/TURN，而不是反复更换网页托管平台。[3][4]

### 方案 B：使用保留的公共云端 4 位房间码

选择「云端联机 · 4 位房间码」。房主创建房间，将 4 位号码告诉对方，对方输入号码加入。默认不需要自己部署信令服务器，因为 PeerJS 使用公共信令服务。[7]

本版房间分组默认为 `pong84-public-v2`。双方必须使用同一信令服务、服务路径、key、分组和兼容版本。房间 ID 不再根据网页域名划分，因此本地文件端与 Pages 端不会仅因域名不同而生成不同的房间前缀。

公共信令不保证每个地区、网络或时段均可达。出现「组件下载失败」先查 CDN；出现「信令连接超时」查公共信令或切换手动方式；已经找到房间但数据通道接不通，则继续查 NAT/防火墙/TURN。自建 PeerServer 只替换信令，不自动变成 TURN。[3][4][7]

4 位码只有有限编号空间，不是密码。本版限制同一房间最多一个对手，但没有账号、密码或竞技级反作弊；它更适合熟人联机，不应被当作安全的公开匹配系统。

### 方案 C：Pages + 自建信令 + TURN

持续提供公网服务时，将职责分开：

```text
GitHub Pages             提供游戏文件
PeerServer（HTTPS/WSS）  自动交换连接信息、提供房间发现
STUN                    协助发现候选连接地址
TURN                    不能直连时转发游戏数据
凭据签发服务（可选）     为公开网站按需生成短期 TURN 凭据
```

PeerServer 可以运行在支持常驻服务及 WebSocket 的服务器/容器中，再通过带有效证书的 HTTPS/WSS 入口对外提供服务。下面仅是信令进程示例，不包含证书、反向代理、运维或 TURN，**不要在 GitHub Pages 中运行**。[7]

```bash
npm install peer
```

```javascript
// server.cjs：运行在你的服务器，不放到 Pages 充当后台。
const { PeerServer } = require('peer');
PeerServer({ port: 9000, path: '/pong84', proxied: true });
// proxied:true 对应前面有反向代理的部署。
```

```bash
node server.cjs
```

在服务器上配置 HTTPS 反向代理和 WebSocket Upgrade，将公开路径正确转发给该进程。假设你已经实际部署好了 `signal.example.com` 的 443 端口和 `/pong84` 路径，游戏高级设置应填：

| 字段 | 示例（必须替换成实际服务） |
|---|---|
| 自建 PeerServer 域名 | `signal.example.com`，不含协议头、端口或路径 |
| 端口 | `443` |
| 路径 | `/pong84` |
| 服务 key | `peerjs`，或与你的服务配置一致的值 |
| 房间分组 | 双方相同，例如 `my-pong84-v2` |
| 安全信令 | 勾选 |

普通 WebSocket 回显服务器并不兼容 PeerJS 的信令协议。不能只填一个任意 WSS 地址，也不能把 Pages 的域名当作 PeerServer 地址。

自建信令并不会取消当前客户端的 CDN 依赖。完全自主托管时还需将审核后的 PeerJS 1.5.5 文件放在你自己的静态站点，并相应修改 `loadPeerLibrary()` 中的组件 URL；本发布包未打包第三方库。

## 5. TURN：连接上房间但打不了游戏时怎么办

展开高级网络设置，填入实际 TURN 服务返回的地址、用户名、凭据。例如下面只是格式示意，不是可用免费服务：

```text
TURN 地址：
turn:turn.example.com:3478?transport=udp
turns:turn.example.com:5349?transport=tcp

TURN 用户名：你的有效用户名
TURN 密码 / 临时凭据：你的有效凭据
```

TURN 使用自己的协议，不是 HTTPS 网页 URL。用户名/凭据需与对应服务匹配。可以临时勾选「强制 TURN 中继」排查直连问题；没有有效 TURN 时不要勾选。变更配置后双方取消旧连接并重新生成邀请/重新加入房间。[4]

连接诊断会尝试从浏览器统计中读取实际候选路径。显示「浏览器直连」表示没有发现 relay 候选；显示「TURN 中继」表示使用了中继路径，不把它叫作纯直连。部分浏览器不给出完整统计时，路径会保留“尚未确定”。

本版仅实现手工填入 TURN 凭据；没有附带免费的 TURN 服务，也没有实现自动签发凭据的后台。公开运营时应由自己的后端/边缘服务保存长期服务密钥并签发短期凭据，前端只取得短期凭据。以 Cloudflare 官方说明为例，长期 TURN key 应留在服务器，不能直接当作浏览器 TURN 密码使用。[8]

**不要把长期 TURN 密码、服务商 API Token 或签发密钥写入公开的 HTML/仓库。** 本版网络设置仅留在当前页面内存，不写入 localStorage，也不将 TURN 用户名/密码加入连接码或导出的连接码文件。页面内存不等于对当前设备用户保密。

使用非逐条交换地址的手动模式时，无效/被浏览器禁止的服务端口会拖延完整地址收集。使用服务商支持浏览器的地址，避免盲目复制所有候选备用端口；例如 Cloudflare 文档特别提醒浏览器会阻止其备用 53 端口，非 trickle ICE 场景应考虑过滤。[8]

## 6. 常见故障定位

| 现象 | 优先检查 |
|---|---|
| HTML 显示成源码或附件预览 | 保存文件后用完整浏览器打开；不要将聊天软件预览当成浏览器运行环境。 |
| 页面能玩本地模式，但手动邀请生成失败 | 展开连接诊断；检查 WebRTC 接口、地址收集、防火墙/浏览器管理策略。 |
| 同一 Wi-Fi 仍然连接失败 | 访客网络、接入点隔离、设备防火墙和浏览器策略可能阻止设备互通；“同一 Wi-Fi”并非连通保证。 |
| 跨网络地址收集超时 | 检查填写的 STUN/TURN 是否可达；去掉无效地址，必要时使用有效 TURN。 |
| 已有邀请码/回应码，却始终未连接 | 确认房主完成了最后一次“确认回应”，双方页面未刷新；进一步排查 NAT/TURN。 |
| 提示回应码不属于本次邀请 | 使用当前房主页面新生成的邀请码，从头交换；不要混用旧回应。 |
| 复制按钮不可用 | 手动选中复制或使用保存/读取连接码文件。 |
| 云端组件下载失败 | 组件 CDN 不可达；手动模式不需要该组件。 |
| 云房间不存在 | 检查房间码、房间分组、信令域名/端口/路径、版本和房主是否离开。 |
| 云房间能找到但连接超时 | 信令成功不代表 WebRTC 通道成功；检查 STUN/TURN 和设备网络。 |
| 自建信令在 Pages 上失败 | 有效 TLS 证书、WSS、反向代理 Upgrade、路由和服务监听；不要使用普通 WS。 |
| 球拍/比分停止更新 | 保持页面前台；检查“实际路径”和往返延迟；持续掉线后重新连接。 |
| 仅更换 Pages 域名仍连不上 | 网页托管与 NAT/中继是不同问题，换网页域名本身不修复穿透。 |

## 7. 本次验证范围

详见 `TEST_REPORT.md`。完成 JavaScript 语法检查、Chromium 浏览器内的界面和游戏逻辑回归、双端内存模拟传输测试，以及真实 WebRTC API 的 SDP 协商检查。

执行环境限制 `file://` / 本地 HTTP 导航及实际 WebRTC 网络地址收集，因此**没有完成真实两台设备、跨运营商网络、公共 PeerJS 服务、有效 TURN 中继或已发布 GitHub Pages 的端到端实测**。不能将模拟通道测试解读成这些网络已验证可用。发布后请在实际两台设备上验收。

## 8. 外部技术资料

以下资料用于说明网页托管、浏览器与网络机制；游戏新增功能说明以本包代码为准。访问核对日期：2026-09-05。

[1] GitHub Docs, What is GitHub Pages?
https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

[2] GitHub Docs, Configuring a publishing source for your GitHub Pages site.
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

[3] WebRTC, Getting started with peer connections.
https://webrtc.org/getting-started/peer-connections

[4] WebRTC, TURN server.
https://webrtc.org/getting-started/turn-server

[5] GitHub Docs, Securing your GitHub Pages site with HTTPS.
https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https

[6] MDN, Secure contexts.
https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts

[7] PeerJS, PeerServer Getting Started; Peer API Reference.
https://peerjs.com/server/getting-started
https://peerjs.com/client/api/peer

[8] Cloudflare Realtime, Generate Credentials.
https://developers.cloudflare.com/realtime/turn/generate-credentials/
