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
  CameraConnectionInfoPayload,
  ClientState,
  CameraCatalogPayload,
  CameraRoomClockPayload,
  CameraTelemetryPayload,
  JoinRoomPayload,
  SignalPayload,
  SwitchCameraPayload,
  SwitchFailedPayload,
  VideoQualityPreference,
  VideoQualityPreferencePayload
} from './types.js'

const VIDEO_QUALITY_PREFERENCES = new Set<VideoQualityPreference>([
  'fps-10', 'fps-30', 'fps-60', 'fps-90',
  'resolution-360', 'resolution-480', 'resolution-720',
  'resolution-1080', 'resolution-1440', 'resolution-2160'
])

const CONNECTION_TYPES = new Set([
  '通过服务器中转（TURN）',
  'Tailscale 私有网络连接',
  'NAT 打洞直连（IPv4）',
  'NAT 映射直连（IPv4）',
  '局域网（IPv4）',
  '公网 IPv4 直连',
  '局域网（IPv6）',
  '公网 IPv6 直连',
  '其他私有网络连接',
  '两台设备直接连接'
])

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

function notifyClientLeft(io: Server, socketId: string, client: ClientState): void {
  if (client.role === 'viewer') {
    const cameraSocketId = getRoom(client.roomId)?.cameraSocketId
    if (cameraSocketId) {
      io.to(cameraSocketId).emit('viewer-left', { viewerSocketId: socketId })
    }
  } else {
    for (const viewerSocketId of listViewers(client.roomId)) {
      io.to(viewerSocketId).emit('camera-left')
    }
  }

  emitRoomState(io, client.roomId)
}

function isJoinRoomPayload(payload: unknown): payload is JoinRoomPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<JoinRoomPayload>
  return (
    isValidRoomId(candidate.roomId) &&
    isValidRole(candidate.role) &&
    typeof candidate.token === 'string' &&
    (candidate.deviceName === undefined ||
      (typeof candidate.deviceName === 'string' && candidate.deviceName.trim().length <= 80))
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

function isVideoQualityPreferencePayload(payload: unknown): payload is VideoQualityPreferencePayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<VideoQualityPreferencePayload>
  return (
    isValidRoomId(candidate.roomId) &&
    typeof candidate.preference === 'string' &&
    VIDEO_QUALITY_PREFERENCES.has(candidate.preference as VideoQualityPreference)
  )
}

function isCameraConnectionInfoPayload(payload: unknown): payload is CameraConnectionInfoPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<CameraConnectionInfoPayload>
  return (
    isValidRoomId(candidate.roomId) &&
    typeof candidate.viewerSocketId === 'string' &&
    candidate.viewerSocketId.length > 0 &&
    typeof candidate.connectionType === 'string' &&
    CONNECTION_TYPES.has(candidate.connectionType)
  )
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

function isCameraTelemetryPayload(payload: unknown): payload is CameraTelemetryPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<CameraTelemetryPayload>
  const temperatureValid =
    candidate.temperatureC === null ||
    (typeof candidate.temperatureC === 'number' &&
      Number.isFinite(candidate.temperatureC) &&
      candidate.temperatureC >= -50 &&
      candidate.temperatureC <= 150)

  return isValidRoomId(candidate.roomId) && temperatureValid
}

function handleCameraTelemetry(socket: Socket, payload: unknown): void {
  if (!isCameraTelemetryPayload(payload)) {
    return
  }

  const client = getClient(socket.id)
  if (!client || client.role !== 'camera' || client.roomId !== payload.roomId) {
    return
  }

  socket.to(payload.roomId).emit('camera-telemetry', {
    temperatureC: payload.temperatureC
  })
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
  if (existingClient?.roomId === payload.roomId && existingClient.role === payload.role) {
    socket.emit('room-state', toPublicRoomState(payload.roomId))
    return
  }

  if (payload.role === 'camera') {
    const cameraSocketId = getRoom(payload.roomId)?.cameraSocketId
    if (cameraSocketId && cameraSocketId !== socket.id) {
      sendRoomError(socket, '该房间已有采集端在线')
      return
    }
  }

  let maxViewers = config.maxViewersPerRoom
  if (payload.role === 'viewer') {
    const policy = await getRoomPolicy(payload.roomId)
    maxViewers = policy?.maxViewersPerRoom ?? config.maxViewersPerRoom
    const targetRoom = getRoom(payload.roomId)
    const alreadyViewer = targetRoom?.viewers.has(socket.id) === true
    if (!alreadyViewer && (targetRoom?.viewers.size ?? 0) >= maxViewers) {
      sendRoomError(socket, `该房间最多允许 ${maxViewers} 个观看端`)
      return
    }
  }

  if (!socket.connected) {
    return
  }

  if (existingClient) {
    removeClient(socket.id)
    await socket.leave(existingClient.roomId)
    notifyClientLeft(io, socket.id, existingClient)
    if (!socket.connected) {
      return
    }
  }

  if (payload.role === 'camera') {
    const result = joinCamera(payload.roomId, socket.id)
    if (!result.ok) {
      sendRoomError(socket, result.reason)
      return
    }

    socket.join(payload.roomId)
    socket.emit('room-state', toPublicRoomState(payload.roomId))

    emitRoomState(io, payload.roomId)
    return
  }

  const deviceName = payload.deviceName?.trim() || undefined
  const result = joinViewer(payload.roomId, socket.id, maxViewers, deviceName)
  if (!result.ok) {
    sendRoomError(socket, result.reason)
    return
  }

  socket.join(payload.roomId)
  socket.emit('room-state', toPublicRoomState(payload.roomId))

  const cameraSocketId = getRoom(payload.roomId)?.cameraSocketId
  if (cameraSocketId) {
    io.to(cameraSocketId).emit('viewer-joined', { viewerSocketId: socket.id, deviceName })
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

  const viewer = getClient(payload.viewerSocketId)
  if (!viewer || viewer.role !== 'viewer' || viewer.roomId !== client.roomId) {
    return
  }

  io.to(payload.viewerSocketId).emit('camera-switch-failed', {
    message: payload.message
  })
}

function handleVideoQualityPreference(io: Server, socket: Socket, payload: unknown): void {
  if (!isVideoQualityPreferencePayload(payload)) {
    sendRoomError(socket, 'set-video-quality 参数无效')
    return
  }

  const client = getClient(socket.id)
  if (!client || client.role !== 'viewer' || client.roomId !== payload.roomId) {
    sendRoomError(socket, '当前连接尚未加入该房间或为采集端')
    return
  }

  client.videoQualityPreference = payload.preference
  const cameraSocketId = getRoom(client.roomId)?.cameraSocketId
  if (cameraSocketId) {
    io.to(cameraSocketId).emit('viewer-video-quality', {
      viewerSocketId: socket.id,
      preference: payload.preference
    })
  }
}

function handleCameraConnectionInfo(io: Server, socket: Socket, payload: unknown): void {
  if (!isCameraConnectionInfoPayload(payload)) {
    return
  }

  const camera = getClient(socket.id)
  if (!camera || camera.role !== 'camera' || camera.roomId !== payload.roomId) {
    return
  }

  const viewer = getClient(payload.viewerSocketId)
  if (!viewer || viewer.role !== 'viewer' || viewer.roomId !== camera.roomId) {
    return
  }

  io.to(payload.viewerSocketId).emit('camera-connection-info', {
    connectionType: payload.connectionType
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

  const recipient = getClient(payload.to)
  if (!recipient || recipient.roomId !== client.roomId || recipient.role === client.role) {
    sendRoomError(socket, '信令接收方不在当前房间或角色无效')
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

  notifyClientLeft(io, socket.id, client)
}

let joinQueue: Promise<void> = Promise.resolve()

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('join-room', (payload) => {
      joinQueue = joinQueue
        .then(() => handleJoinRoom(io, socket, payload))
        .catch((error) => {
          console.error('[socket] join-room failed:', error)
          if (socket.connected) {
            sendRoomError(socket, '加入房间失败，请稍后重试')
          }
        })
    })
    socket.on('signal', (payload) => handleSignal(io, socket, payload))
    socket.on('camera-catalog', (payload) => handleCameraCatalog(io, socket, payload))
    socket.on('switch-camera', (payload) => handleSwitchCamera(io, socket, payload))
    socket.on('camera-switch-failed', (payload) => handleCameraSwitchFailed(io, socket, payload))
    socket.on('set-video-quality', (payload) => handleVideoQualityPreference(io, socket, payload))
    socket.on('camera-connection-info', (payload) => handleCameraConnectionInfo(io, socket, payload))
    socket.on('camera-room-clock', (payload) => handleCameraRoomClock(socket, payload))
    socket.on('camera-telemetry', (payload) => handleCameraTelemetry(socket, payload))
    socket.on('disconnect', () => handleDisconnect(io, socket))
  })
}
