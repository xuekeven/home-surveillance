import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import type { IceServer } from './types.js'

const configDir = path.dirname(fileURLToPath(import.meta.url))
/** `src/config.ts` 与 `dist/config.js` 均在 server 包内；再上溯一级为 monorepo 根目录 */
const repoRootEnvPath = path.resolve(configDir, '..', '..', '.env')

loadDotenv({ path: repoRootEnvPath })

const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
]

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return ['http://localhost:5173', 'http://localhost:3000']
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function parseIceServers(value: string | undefined): IceServer[] {
  if (!value) {
    return DEFAULT_ICE_SERVERS
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      throw new Error('ICE_SERVERS_JSON must be an array')
    }

    return parsed.map((item) => {
      if (!item || typeof item !== 'object' || !('urls' in item)) {
        throw new Error('Each ICE server must include urls')
      }

      return item as IceServer
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new Error(`Failed to parse ICE_SERVERS_JSON: ${message}`)
  }
}

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === '/') {
    return ''
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInteger(process.env.PORT, 3000),
  publicBasePath: normalizeBasePath(process.env.PUBLIC_BASE_PATH),
  roomToken: process.env.ROOM_TOKEN || 'change-me',
  /** 房间策略 JSON 未写 maxViewersPerRoom 时的默认观看端上限（每房间可在后台单独设置） */
  maxViewersPerRoom: parseInteger(process.env.MAX_VIEWERS_PER_ROOM, 2),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  iceServers: parseIceServers(process.env.ICE_SERVERS_JSON),
  /** 企微中转服务基址，无末尾斜杠；未配置则不调用 relay */
  weworkRelayUrl: (process.env.WEWORK_RELAY_URL || '').trim().replace(/\/$/, ''),
  weworkRelayApiKey: (process.env.WEWORK_RELAY_API_KEY || '').trim(),
  weworkRelayTouser: (process.env.WEWORK_RELAY_TOUSER || '').trim() || undefined,
  faceAlertOriginPrimary:
    (process.env.FACE_ALERT_ORIGIN_PRIMARY || 'https://localhost').trim().replace(/\/$/, ''),
  faceAlertOriginSecondary:
    (process.env.FACE_ALERT_ORIGIN_SECONDARY || 'https://localhost').trim().replace(/\/$/, ''),
  faceAlertCooldownMs: parseInteger(process.env.FACE_ALERT_COOLDOWN_MS, 120000),
  /** 后台管理接口密钥（勿写入前端构建）；空字符串则禁用相关校验 */
  adminToken: (process.env.ADMIN_TOKEN || '').trim()
}

/** Express REST：`/api/*` 或 `{PUBLIC_BASE_PATH}/api/*` */
export function apiMountPrefix(publicBasePath: string): string {
  return publicBasePath ? `${publicBasePath}/api` : '/api'
}

/** Socket.IO 引擎路径（须与前端 `socket.io-client` path 一致） */
export function socketIoHttpPath(publicBasePath: string): string {
  return publicBasePath ? `${publicBasePath}/socket.io/` : '/socket.io/'
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true
  }

  return config.allowedOrigins.includes(origin)
}
