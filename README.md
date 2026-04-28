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

开发与生产均以根目录 `ecosystem.config.cjs` 为准：

- `env_development` 供本地 `npm run dev`（经 `scripts/run-dev.mjs` 注入）及 `pm2 start … --env development`；
- `env` 供生产 PM2。可选将 `env.development.example` 复制为根目录 `.env` 做本地覆盖。细节见 `[docs/5.部署方案.md](docs/5.部署方案.md)`。

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
7. 加入 HTTPS、鉴权、房间口令、连接状态和 TURN fallback。
8. 外部自用设备通过公网域名观看端跑通 WebRTC Mesh。

