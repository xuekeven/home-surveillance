import type { Server, Socket } from 'socket.io'
import { isAuthorized } from './auth.js'
import { config } from './config.js'
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
import type { JoinRoomPayload, SignalPayload } from './types.js'

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

function handleJoinRoom(io: Server, socket: Socket, payload: unknown): void {
  if (!isJoinRoomPayload(payload)) {
    sendRoomError(socket, 'join-room 参数无效')
    return
  }

  if (!isAuthorized(payload)) {
    sendRoomError(socket, '房间口令无效')
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

  const result = joinViewer(payload.roomId, socket.id, config.maxViewersPerRoom)
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
    socket.on('join-room', (payload) => handleJoinRoom(io, socket, payload))
    socket.on('signal', (payload) => handleSignal(io, socket, payload))
    socket.on('disconnect', () => handleDisconnect(io, socket))
  })
}
