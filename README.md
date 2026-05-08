# Home Surveillance

将闲置安卓手机改造成一个云边混合 WebRTC 家庭监控平台。

本项目采用 **家庭云为核心、阿里云为公网网关、Tailscale 为私有网络通道、WebRTC Mesh 传输视频流** 的架构。目标是在家中低延迟观看，在外网稳定访问，同时尽量降低公网暴露面和云服务器流量成本。

## 架构结论

采用方案：

- **家庭云承载主服务**：运行 Node.js 信令服务，托管前端页面，作为边缘计算中心。
- **旧手机作为采集端**：连接家庭 Wi-Fi，并已接入 Tailscale，访问家庭云页面并授权摄像头。
- **Tailscale 私有访问链路**：私人设备在外网时通过 Tailscale 访问家庭云，避免直接暴露家庭网络。
- **阿里云为公网网关和 TURN**：Nginx 通过 Tailscale 反向代理到家庭云，coturn 提供 STUN/TURN 能力。

这套架构比单纯“阿里云部署全部服务”更适合家庭监控：视频优先走端到端 P2P 或私有网络，阿里云只负责公网入口和必要时的 TURN 中继。

## 核心角色

```text
+--------------------+    家庭 Wi-Fi / Tailscale    +--------------------+
| mi10ultra Camera   | <---------------------------> | homeserver         |
| 100.126.250.4      |                               | 100.65.192.69      |
| Browser + WebRTC   |                               | Node.js + Web App  |
+--------------------+                               +----------+---------+
                                                            |
                                                            | Tailscale
                                                            |
                                                  +---------+----------+
                                                  | aliserver 阿里云网关 |
                                                  | 100.115.222.54      |
                                                  | Nginx + coturn     |
                                                  +---------+----------+
                                                            |
                                                            | Public HTTPS / TURN
                                                            |
                                                  +---------+----------+
                                                  |   Viewer 手机/电脑  |
                                                  | Browser + WebRTC   |
                                                  +--------------------+
```

## Tailscale 节点


| 节点           | 角色                     | Tailscale IP     |
| ------------ | ---------------------- | ---------------- |
| `homeserver` | 家庭云，主服务节点              | `100.65.192.69`  |
| `aliserver`  | 阿里云公网网关，Nginx + coturn | `100.115.222.54` |
| `mi10ultra`  | 旧手机采集端                 | `100.126.250.4`  |


## 两条访问链路

### 链路 A：内网 / Tailscale 通道

适用于你自己的设备。

观看端直接访问家庭云的内网地址、IPv6 地址或 Tailscale 地址 `100.65.192.69`。信令服务和前端资源都从家庭云获取；由于旧手机 `mi10ultra` 也已接入 Tailscale，WebRTC 可以同时尝试家庭 Wi-Fi、IPv6 和 Tailscale 私有地址候选。这个链路延迟低、成本低、隐私性最好。

### 链路 B：阿里云公网通道

适用于不方便安装 Tailscale 的设备或临时分享场景。

观看端访问公网域名，例如 `https://www.kaitool.top/surveillance`。阿里云 `aliserver` 的 Nginx 接收 HTTPS 和 WebSocket 请求，再通过 Tailscale 将请求反向代理到家庭云 `100.65.192.69`。WebRTC 媒体连接优先 P2P，失败时通过阿里云 coturn 走 TURN 中继。

## 必须注意

- `getUserMedia` 需要 HTTPS 或 `localhost`。旧手机访问家庭云页面时也要解决 HTTPS 问题。
- Nginx 可以代理网页和 WebSocket，但不能代理 WebRTC 的 UDP 媒体流。
- coturn 必须独立部署并开放 UDP `3478` 和中继端口范围。
- STUN 只能辅助打洞，不能保证一定成功；TURN 才是公网稳定观看的兜底。
- Mesh 架构下，观看端越多，旧手机上行压力越大。第一阶段建议限制 1 到 2 个观看端。

## 运行时配置

- **环境变量**：仓库根目录 `.env`（勿提交）。可复制 `[.env.example](.env.example)` 为 `.env` 后按需填写。
- **本地开发**：`npm run dev` 由 `[scripts/run-dev.mjs](scripts/run-dev.mjs)` 先加载根 `.env`，再并发启动 `server` 与 `web`，使 `PORT`、`ALLOWED_ORIGINS`、`VITE_*` 等与后端一致。
- **生产**：Node 进程启动时由服务端 `[server/src/config.ts](server/src/config.ts)` 通过 dotenv 读取同一套根 `.env`。PM2 形态见 `[ecosystem.config.cjs](ecosystem.config.cjs)`（进程入口为编译后的 `server/dist/index.js`，变量仍来自宿主 `.env`）。细节见 `[docs/5.部署方案.md](docs/5.部署方案.md)`。
- **房间观看端上限**：房间策略 JSON（`server/data/room-policies.json`）若未写 `maxViewersPerRoom`，则回退到服务端配置 `MAX_VIEWERS_PER_ROOM`（环境变量，默认 **2**，范围 1–99）；后台 `/admin` 可按房间持久化覆盖。新建房间条目时，若首次 `patch` 未带该字段，初始上限同样来自 `MAX_VIEWERS_PER_ROOM`。

### `.env` 变量摘要（告警 / 观看上限 / 后台）

| 变量 | 作用 |
| --- | --- |
| `MAX_VIEWERS_PER_ROOM` | 可选；策略未写 `maxViewersPerRoom` 时的默认观看端上限（默认 **2**） |
| `WEWORK_RELAY_*`、`FACE_ALERT_ORIGIN_*` | 企微告警中转与推送正文里的观看入口链接 |
| `FACE_ALERT_COOLDOWN_MS` | **服务端**同一房间连续告警最短间隔（防抖） |
| `ADMIN_TOKEN` | 非空则启用 `/api/admin/*` 后台管理能力 |

采集端还有 **前端常量**（未暴露在 `.env`）：陌生人 **企微告警** 需同一轨迹连续被判为陌生人约 **1 秒** 后才计入人数；**陌生人抓拍**按 **当前帧** 瞬时人数触发。告警另有客户端间隔（约 60s），抓拍另有全局限频（约 60s）。详见 `[web/src/shared/faceAnalysisOverlay.tsx](web/src/shared/faceAnalysisOverlay.tsx)`。

## 前端路由

| 路径 | 说明 |
| --- | --- |
| `/viewer/:roomId` | 观看端 |
| `/camera/:roomId` | 采集端（摄像头 + 人脸叠加可选） |
| `/admin` | 后台（须配置 `ADMIN_TOKEN`） |
| `/` | 默认重定向至 `/viewer/home` |

路由定义见 `[web/src/routes.tsx](web/src/routes.tsx)`；`PUBLIC_BASE_PATH` / `VITE_PUBLIC_BASE_PATH` 会为上述路径加前缀。

## 人脸流程与数据落盘（摘要）

- **检测**：MediaPipe 人脸框；轨迹须满足「移动活体」后才作为稳定人脸参与后续逻辑。
- **识别**：face-api 仅在 **近似正面** 姿态下与家庭成员描述向量比对；侧面或非正面轨迹不参与陌生人告警依据。
- **告警**：调用 `[POST …/api/wework/face-alert](server/src/apiRoutes.ts)`；房间须在策略中开启陌生人脸告警，且受服务端冷却时间约束。
- **陌生人抓拍**：合成视频帧 + 叠加层后 `POST …/api/stranger-screenshots`，PNG 写入仓库根目录 **`images/stranger/`**（见 `[server/src/persist/dir.ts](server/src/persist/dir.ts)`）。
- **持久化**：家庭成员与房间策略 JSON 位于 **`server/data/`**（运行时自动创建）。

面向采集端/观看端的只读接口（如家庭成员列表、房间策略）使用 **`Authorization: Bearer <ROOM_TOKEN>`**。后台接口使用 **`Bearer <ADMIN_TOKEN>`**。完整列表见 `[server/src/apiRoutes.ts](server/src/apiRoutes.ts)`。

## 文档

相关文档：

- `[docs/1.方案选择.md](docs/1.方案选择.md)`
- `[docs/2.技术学习.md](docs/2.技术学习.md)`
- `[docs/3.技术架构.md](docs/3.技术架构.md)`
- `[docs/4.开发步骤.md](docs/4.开发步骤.md)`
- `[docs/5.部署方案.md](docs/5.部署方案.md)`

## 推荐实施顺序

1. 在家庭云上跑通 Node.js 信令服务和前端页面。
2. 旧手机 `mi10ultra` 通过家庭 Wi-Fi 或 Tailscale 访问采集端页面，完成摄像头采集。
3. 在家局域网 / Tailscale 观看端跑通 WebRTC Mesh。
4. 外部自用设备通过 Tailscale 观看端跑通 WebRTC Mesh。
5. `aliserver` 通过 Tailscale 反向代理到 `homeserver`，配置 Nginx 公网入口。
6. 在阿里云部署 coturn，并开放安全组 UDP 端口。
7. 加入 HTTPS、`ROOM_TOKEN` 鉴权、房间策略（含观看端上限与陌生人告警开关）、后台 `/admin`、`FACE_ALERT_*` / 企微中转与 TURN fallback。
8. 外部自用设备通过公网域名观看端跑通 WebRTC Mesh。

