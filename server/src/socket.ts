import type { Server, Socket } from 'socket.io'
import { isAuthorized } from './auth.js'
import { config } from './config.js'
import { checkRoomJoin, getRoomPolicy } from './persist/roomPoliciesRepo.js'
import {
  getClient,
  getRoom,
  isValidRole,
  isValidRoomId,
  joinCamera,
  joinViewer,
  listViewers,
  removeClient,
  toPublicRoomState
} from './rooms.js'
import type {
  CameraCatalogPayload,
  CameraRoomClockPayload,
  JoinRoomPayload,
  SignalPayload,
  SwitchCameraPayload,
  SwitchFailedPayload
} from './types.js'

function emitRoomState(io: Server, roomId: string): void {
  const state = toPublicRoomState(roomId)
  const room = getRoom(roomId)

  if (room?.cameraSocketId) {
    io.to(room.cameraSocketId).emit('room-state', state)
  }

  for (const viewerSocketId of room?.viewers ?? []) {
    io.to(viewerSocketId).emit('room-state', state)
  }
}

function sendRoomError(socket: Socket, message: string): void {
  socket.emit('room-error', { message })
}

function isJoinRoomPayload(payload: unknown): payload is JoinRoomPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<JoinRoomPayload>
  return (
    isValidRoomId(candidate.roomId) &&
    isValidRole(candidate.role) &&
    typeof candidate.token === 'string'
  )
}

function isCameraCatalogPayload(payload: unknown): payload is CameraCatalogPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<CameraCatalogPayload>
  if (!isValidRoomId(candidate.roomId) || typeof candidate.activeCameraId !== 'string') {
    return false
  }

  if (!Array.isArray(candidate.devices)) {
    return false
  }

  return candidate.devices.every(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { deviceId?: unknown }).deviceId === 'string' &&
      typeof (entry as { label?: unknown }).label === 'string'
  )
}

function isSwitchCameraPayload(payload: unknown): payload is SwitchCameraPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<SwitchCameraPayload>
  return isValidRoomId(candidate.roomId) && typeof candidate.deviceId === 'string' && candidate.deviceId.length > 0
}

function isSwitchFailedPayload(payload: unknown): payload is SwitchFailedPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<SwitchFailedPayload>
  return typeof candidate.viewerSocketId === 'string' && typeof candidate.message === 'string'
}

function isSignalPayload(payload: unknown): payload is SignalPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<SignalPayload>
  return (
    isValidRoomId(candidate.roomId) &&
    typeof candidate.to === 'string' &&
    candidate.to.length > 0 &&
    'signal' in candidate
  )
}

function isCameraRoomClockPayload(payload: unknown): payload is CameraRoomClockPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<CameraRoomClockPayload>
  return (
    typeof candidate.roomId === 'string' &&
    isValidRoomId(candidate.roomId) &&
    typeof candidate.ts === 'number' &&
    Number.isFinite(candidate.ts)
  )
}

function handleCameraRoomClock(socket: Socket, payload: unknown): void {
  if (!isCameraRoomClockPayload(payload)) {
    return
  }

  const client = getClient(socket.id)
  if (!client || client.role !== 'camera' || client.roomId !== payload.roomId) {
    return
  }

  socket.to(payload.roomId).emit('room-clock', { ts: payload.ts })
}

async function handleJoinRoom(io: Server, socket: Socket, payload: unknown): Promise<void> {
  if (!isJoinRoomPayload(payload)) {
    sendRoomError(socket, 'join-room 参数无效')
    return
  }

  if (!isAuthorized(payload)) {
    sendRoomError(socket, '房间口令无效')
    return
  }

  const joinCheck = await checkRoomJoin(payload.roomId)
  if (!joinCheck.ok) {
    sendRoomError(
      socket,
      joinCheck.reason === 'room_missing' ? '房间不存在' : '房间未开放，请联系管理员'
    )
    return
  }

  const existingClient = getClient(socket.id)
  if (existingClient) {
    removeClient(socket.id)
  }

  if (payload.role === 'camera') {
    const result = joinCamera(payload.roomId, socket.id)
    if (!result.ok) {
      sendRoomError(socket, result.reason)
      return
    }

    socket.join(payload.roomId)
    socket.emit('room-state', toPublicRoomState(payload.roomId))

    for (const viewerSocketId of listViewers(payload.roomId)) {
      socket.emit('viewer-joined', { viewerSocketId })
    }

    emitRoomState(io, payload.roomId)
    return
  }

  const policy = await getRoomPolicy(payload.roomId)
  const maxViewers = policy?.maxViewersPerRoom ?? config.maxViewersPerRoom
  const result = joinViewer(payload.roomId, socket.id, maxViewers)
  if (!result.ok) {
    sendRoomError(socket, result.reason)
    return
  }

  socket.join(payload.roomId)
  socket.emit('room-state', toPublicRoomState(payload.roomId))

  const cameraSocketId = getRoom(payload.roomId)?.cameraSocketId
  if (cameraSocketId) {
    io.to(cameraSocketId).emit('viewer-joined', { viewerSocketId: socket.id })
  }

  emitRoomState(io, payload.roomId)
}

function handleCameraCatalog(io: Server, socket: Socket, payload: unknown): void {
  if (!isCameraCatalogPayload(payload)) {
    return
  }

  const client = getClient(socket.id)
  if (!client || client.role !== 'camera' || client.roomId !== payload.roomId) {
    return
  }

  for (const viewerSocketId of listViewers(client.roomId)) {
    io.to(viewerSocketId).emit('camera-catalog', {
      devices: payload.devices,
      activeCameraId: payload.activeCameraId
    })
  }
}

function handleSwitchCamera(io: Server, socket: Socket, payload: unknown): void {
  if (!isSwitchCameraPayload(payload)) {
    sendRoomError(socket, 'switch-camera 参数无效')
    return
  }

  const client = getClient(socket.id)
  if (!client || client.role !== 'viewer' || client.roomId !== payload.roomId) {
    sendRoomError(socket, '当前连接尚未加入该房间或为采集端')
    return
  }

  const cameraSocketId = getRoom(client.roomId)?.cameraSocketId
  if (!cameraSocketId) {
    sendRoomError(socket, '采集端不在线')
    return
  }

  io.to(cameraSocketId).emit('viewer-switch-camera', {
    deviceId: payload.deviceId,
    viewerSocketId: socket.id
  })
}

function handleCameraSwitchFailed(io: Server, socket: Socket, payload: unknown): void {
  if (!isSwitchFailedPayload(payload)) {
    return
  }

  const client = getClient(socket.id)
  if (!client || client.role !== 'camera') {
    return
  }

  io.to(payload.viewerSocketId).emit('camera-switch-failed', {
    message: payload.message
  })
}

function handleSignal(io: Server, socket: Socket, payload: unknown): void {
  if (!isSignalPayload(payload)) {
    sendRoomError(socket, 'signal 参数无效')
    return
  }

  const client = getClient(socket.id)
  if (!client || client.roomId !== payload.roomId) {
    sendRoomError(socket, '当前连接尚未加入该房间')
    return
  }

  io.to(payload.to).emit('signal', {
    from: socket.id,
    signal: payload.signal
  })
}

function handleDisconnect(io: Server, socket: Socket): void {
  const client = removeClient(socket.id)
  if (!client) {
    return
  }

  if (client.role === 'viewer') {
    const cameraSocketId = getRoom(client.roomId)?.cameraSocketId
    if (cameraSocketId) {
      io.to(cameraSocketId).emit('viewer-left', { viewerSocketId: socket.id })
    }
  }

  if (client.role === 'camera') {
    for (const viewerSocketId of listViewers(client.roomId)) {
      io.to(viewerSocketId).emit('camera-left')
    }
  }

  emitRoomState(io, client.roomId)
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('join-room', (payload) => {
      void handleJoinRoom(io, socket, payload)
    })
    socket.on('signal', (payload) => handleSignal(io, socket, payload))
    socket.on('camera-catalog', (payload) => handleCameraCatalog(io, socket, payload))
    socket.on('switch-camera', (payload) => handleSwitchCamera(io, socket, payload))
    socket.on('camera-switch-failed', (payload) => handleCameraSwitchFailed(io, socket, payload))
    socket.on('camera-room-clock', (payload) => handleCameraRoomClock(socket, payload))
    socket.on('disconnect', () => handleDisconnect(io, socket))
  })
}
