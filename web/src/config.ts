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

function normalizeOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
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
const internalOrigin = normalizeOrigin(import.meta.env.VITE_INTERNAL_ORIGIN)
const publicOrigin = normalizeOrigin(import.meta.env.VITE_PUBLIC_ORIGIN)

function defaultSocketPath(): string {
  return publicBasePath ? `${publicBasePath}/socket.io/` : '/socket.io/'
}

export const appConfig = {
  publicBasePath,
  internalOrigin,
  publicOrigin,
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

/** 公网与内网的完整采集端 / 观看端 URL（用于后台展示） */
export function absoluteRoomEntryUrls(roomId: string): {
  publicCamera: string
  internalCamera: string
  publicViewer: string
  internalViewer: string
} {
  // 完整 URL 需要保留协议；location.host 提供当前页面的主机名和端口。
  const currentOrigin =
    typeof window === 'undefined'
      ? ''
      : `${window.location.protocol}//${window.location.host}`
  const resolvedPublicOrigin = publicOrigin ?? currentOrigin
  const resolvedInternalOrigin = internalOrigin ?? currentOrigin
  const cameraPath = cameraRoomPath(roomId)
  const viewerPath = viewerRoomPath(roomId)

  return {
    publicCamera: `${resolvedPublicOrigin}${cameraPath}`,
    internalCamera: `${resolvedInternalOrigin}${cameraPath}`,
    publicViewer: `${resolvedPublicOrigin}${viewerPath}`,
    internalViewer: `${resolvedInternalOrigin}${viewerPath}`
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
