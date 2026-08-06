export type Role = 'camera' | 'viewer'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface JoinRoomPayload {
  roomId: string
  role: Role
  deviceName?: string
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
  deviceName?: string
  videoQualityPreference?: VideoQualityPreference
}

export type VideoQualityPreference =
  | 'fps-10'
  | 'fps-30'
  | 'fps-60'
  | 'fps-90'
  | 'resolution-360'
  | 'resolution-480'
  | 'resolution-720'
  | 'resolution-1080'
  | 'resolution-1440'
  | 'resolution-2160'

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
  /** 观看端 socket id 对应的、由浏览器能力识别出的设备名称 */
  viewerDeviceNames: Record<string, string>
  /** 每个观看端当前选择的视频帧数/分辨率偏好 */
  viewerVideoQualityPreferences: Record<string, VideoQualityPreference>
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

export interface VideoQualityPreferencePayload {
  roomId: string
  preference: VideoQualityPreference
}

export interface CameraConnectionInfoPayload {
  roomId: string
  viewerSocketId: string
  connectionType: string
}

/** 采集端广播房间时钟（Unix 毫秒），由信令转给观看端 */
export interface CameraRoomClockPayload {
  roomId: string
  ts: number
}

/** 采集端设备温度；null 表示当前浏览器无法读取。 */
export interface CameraTelemetryPayload {
  roomId: string
  temperatureC: number | null
}
