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

/** 与 PUBLIC_BASE_PATH / server `apiMountPrefix` 对齐 */
export function apiIceServersUrl(): string {
  return publicBasePath ? `${publicBasePath}/api/ice-servers` : '/api/ice-servers'
}
