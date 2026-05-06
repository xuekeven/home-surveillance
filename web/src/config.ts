export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
]

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === '/') {
    return ''
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash
}

function parseIceServers(value: string | undefined): IceServer[] {
  if (!value) {
    return DEFAULT_ICE_SERVERS
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return DEFAULT_ICE_SERVERS
    }

    return parsed as IceServer[]
  } catch {
    return DEFAULT_ICE_SERVERS
  }
}

const publicBasePath = normalizeBasePath(import.meta.env.VITE_PUBLIC_BASE_PATH)

function defaultSocketPath(): string {
  return publicBasePath ? `${publicBasePath}/socket.io/` : '/socket.io/'
}

export const appConfig = {
  publicBasePath,
  socketUrl: import.meta.env.VITE_SOCKET_URL || undefined,
  socketPath: import.meta.env.VITE_SOCKET_PATH || defaultSocketPath(),
  roomToken: import.meta.env.VITE_ROOM_TOKEN || 'change-me',
  fallbackIceServers: parseIceServers(import.meta.env.VITE_ICE_SERVERS_JSON)
}

/** 采集端页面路径（含 `PUBLIC_BASE_PATH` 前缀） */
export function cameraRoomPath(roomId: string): string {
  const seg = `/camera/${encodeURIComponent(roomId)}`
  return publicBasePath ? `${publicBasePath}${seg}` : seg
}

/** 观看端页面路径（含 `PUBLIC_BASE_PATH` 前缀） */
export function viewerRoomPath(roomId: string): string {
  const seg = `/viewer/${encodeURIComponent(roomId)}`
  return publicBasePath ? `${publicBasePath}${seg}` : seg
}

/** 当前站点下的完整采集端 / 观看端 URL（用于后台展示） */
export function absoluteRoomEntryUrls(roomId: string): { camera: string; viewer: string } {
  if (typeof window === 'undefined') {
    return { camera: '', viewer: '' }
  }
  const origin = window.location.origin
  return {
    camera: `${origin}${cameraRoomPath(roomId)}`,
    viewer: `${origin}${viewerRoomPath(roomId)}`
  }
}

/** 与 PUBLIC_BASE_PATH / server `apiMountPrefix` 对齐 */
export function apiIceServersUrl(): string {
  return publicBasePath ? `${publicBasePath}/api/ice-servers` : '/api/ice-servers'
}

export function apiFaceAlertUrl(): string {
  const prefix = publicBasePath ? `${publicBasePath}/api` : '/api'
  return `${prefix}/wework/face-alert`
}

/** 陌生人抓拍入库（须 ROOM_TOKEN） */
export function apiStrangerScreenshotsUrl(): string {
  const prefix = publicBasePath ? `${publicBasePath}/api` : '/api'
  return `${prefix}/stranger-screenshots`
}

/** 采集端/观看端拉取家庭成员描述（须 ROOM_TOKEN） */
export function apiFamilyMembersUrl(): string {
  const prefix = publicBasePath ? `${publicBasePath}/api` : '/api'
  return `${prefix}/family-members`
}

/** 采集端/观看端拉取房间陌生人脸告警开关（须 ROOM_TOKEN） */
export function apiRoomPolicyUrl(roomId: string): string {
  const prefix = publicBasePath ? `${publicBasePath}/api` : '/api'
  return `${prefix}/rooms/${encodeURIComponent(roomId)}/policy`
}
