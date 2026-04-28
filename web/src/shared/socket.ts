import { io, type Socket } from 'socket.io-client'
import { appConfig } from '../config'

/** 提示文案：连接失败时在页面 alert 使用 */
export function formatSocketConnectError(err: Error): string {
  const msg = err.message || String(err)
  return `${msg}（若页面挂在子路径部署，请确认反向代理把同一前缀下的 /socket.io/ 与 /api/ 转到 Node；含 HTTP 长轮询与 WebSocket 升级）`
}

/** 长时间卡在「连接信令」且无 connect_error 时（常见于反代漏配） */
export const SOCKET_HANDSHAKE_STALL_HINT =
  '信令长时间无法建立：Socket.IO 与 REST API 按前端 base 挂在 `{PUBLIC_BASE_PATH}/socket.io/`、`{PUBLIC_BASE_PATH}/api/`（开发环境 root 时为 `/socket.io/`、`/api/`）。请确认 HTTPS 入口把这些路径转到 Node，并与静态页面同源。'

export function createSocket(): Socket {
  return io(appConfig.socketUrl, {
    path: appConfig.socketPath,
    // 先 polling 再走 websocket：部分移动端 / 反代场景下 WS 握手失败且不易降级时，更容易连通。
    transports: ['polling', 'websocket'],
    upgrade: true,
    timeout: 25_000,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1500
  })
}
