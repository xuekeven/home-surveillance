import 'dotenv/config'
import type { IceServer } from './types.js'

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
  maxViewersPerRoom: parseInteger(process.env.MAX_VIEWERS_PER_ROOM, 2),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  iceServers: parseIceServers(process.env.ICE_SERVERS_JSON)
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true
  }

  return config.allowedOrigins.includes(origin)
}
