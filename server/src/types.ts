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
  /** 当前房间内观看端 socket id（与信令服务端 Set 一致） */
  viewerSocketIds: string[]
}

export interface CameraDeviceOptionPayload {
  deviceId: string
  label: string
}

export interface CameraCatalogPayload {
  roomId: string
  devices: CameraDeviceOptionPayload[]
  activeCameraId: string
}

export interface SwitchCameraPayload {
  roomId: string
  deviceId: string
}

export interface SwitchFailedPayload {
  viewerSocketId: string
  message: string
}

/** 采集端广播房间时钟（Unix 毫秒），由信令转给观看端 */
export interface CameraRoomClockPayload {
  roomId: string
  ts: number
}
