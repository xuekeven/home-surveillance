export type Role = 'camera' | 'viewer'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface JoinRoomPayload {
  roomId: string
  role: Role
  token: string
}

export interface SignalPayload {
  roomId: string
  to: string
  signal: unknown
}

export interface ClientState {
  roomId: string
  role: Role
}

export interface RoomState {
  cameraSocketId?: string
  viewers: Set<string>
}

export interface PublicRoomState {
  roomId: string
  hasCamera: boolean
  viewerCount: number
}
