import type { ClientState, PublicRoomState, Role, RoomState } from './types.js'

const rooms = new Map<string, RoomState>()
const clients = new Map<string, ClientState>()

function ensureRoom(roomId: string): RoomState {
  const existing = rooms.get(roomId)
  if (existing) {
    return existing
  }

  const room: RoomState = {
    viewers: new Set<string>()
  }
  rooms.set(roomId, room)
  return room
}

function pruneRoom(roomId: string): void {
  const room = rooms.get(roomId)
  if (!room) {
    return
  }

  if (!room.cameraSocketId && room.viewers.size === 0) {
    rooms.delete(roomId)
  }
}

export function isValidRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(roomId)
}

export function isValidRole(role: unknown): role is Role {
  return role === 'camera' || role === 'viewer'
}

export function joinCamera(roomId: string, socketId: string): { ok: true } | { ok: false; reason: string } {
  const room = ensureRoom(roomId)

  if (room.cameraSocketId && room.cameraSocketId !== socketId) {
    return { ok: false, reason: '该房间已有采集端在线' }
  }

  room.cameraSocketId = socketId
  clients.set(socketId, { roomId, role: 'camera' })
  return { ok: true }
}

export function joinViewer(
  roomId: string,
  socketId: string,
  maxViewers: number,
  deviceName?: string
): { ok: true } | { ok: false; reason: string } {
  const room = ensureRoom(roomId)

  if (!room.viewers.has(socketId) && room.viewers.size >= maxViewers) {
    return { ok: false, reason: `该房间最多允许 ${maxViewers} 个观看端` }
  }

  room.viewers.add(socketId)
  clients.set(socketId, { roomId, role: 'viewer', deviceName })
  return { ok: true }
}

export function removeClient(socketId: string): ClientState | undefined {
  const client = clients.get(socketId)
  if (!client) {
    return undefined
  }

  const room = rooms.get(client.roomId)
  if (room) {
    if (client.role === 'camera' && room.cameraSocketId === socketId) {
      room.cameraSocketId = undefined
    }

    if (client.role === 'viewer') {
      room.viewers.delete(socketId)
    }
  }

  clients.delete(socketId)
  pruneRoom(client.roomId)

  return client
}

export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId)
}

export function getClient(socketId: string): ClientState | undefined {
  return clients.get(socketId)
}

export function listViewers(roomId: string): string[] {
  return [...(rooms.get(roomId)?.viewers ?? [])]
}

export function toPublicRoomState(roomId: string): PublicRoomState {
  const room = rooms.get(roomId)
  const viewerSocketIds = room ? [...room.viewers] : []
  const viewerDeviceNames = Object.fromEntries(
    viewerSocketIds.flatMap((socketId) => {
      const deviceName = clients.get(socketId)?.deviceName
      return deviceName ? [[socketId, deviceName]] : []
    })
  )

  const viewerVideoQualityPreferences = Object.fromEntries(
    viewerSocketIds.flatMap((socketId) => {
      const preference = clients.get(socketId)?.videoQualityPreference
      return preference ? [[socketId, preference]] : []
    })
  )

  return {
    roomId,
    hasCamera: Boolean(room?.cameraSocketId),
    viewerCount: room?.viewers.size ?? 0,
    viewerSocketIds,
    viewerDeviceNames,
    viewerVideoQualityPreferences
  }
}
