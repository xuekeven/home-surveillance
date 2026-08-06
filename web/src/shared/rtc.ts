import SimplePeer from 'simple-peer'
import { apiIceServersUrl, appConfig, type IceServer } from '../config'
import {
  getVideoQualityProfile,
  type VideoQualityPreference
} from './videoQualityPreference'

export type PeerInstance = SimplePeer.Instance

interface WebRtcConstructors {
  RTCPeerConnection: typeof RTCPeerConnection
  RTCSessionDescription: typeof RTCSessionDescription
  RTCIceCandidate: typeof RTCIceCandidate
}

type WebRtcScope = typeof globalThis & {
  mozRTCPeerConnection?: typeof RTCPeerConnection
  webkitRTCPeerConnection?: typeof RTCPeerConnection
  mozRTCSessionDescription?: typeof RTCSessionDescription
  webkitRTCSessionDescription?: typeof RTCSessionDescription
  mozRTCIceCandidate?: typeof RTCIceCandidate
  webkitRTCIceCandidate?: typeof RTCIceCandidate
}

const RTCSessionDescriptionFallback = function RTCSessionDescriptionFallback(
  description: RTCSessionDescriptionInit
) {
  return description
} as unknown as typeof RTCSessionDescription

const RTCIceCandidateFallback = function RTCIceCandidateFallback(
  candidate: RTCIceCandidateInit
) {
  return candidate
} as unknown as typeof RTCIceCandidate

function getBrowserWebRtc(): WebRtcConstructors | undefined {
  const scopes = [
    globalThis,
    typeof window !== 'undefined' ? window : undefined,
    typeof self !== 'undefined' ? self : undefined
  ].filter(Boolean) as WebRtcScope[]

  const RTCPeerConnectionCtor = scopes
    .map((scope) => scope.RTCPeerConnection || scope.mozRTCPeerConnection || scope.webkitRTCPeerConnection)
    .find(Boolean)

  if (!RTCPeerConnectionCtor) {
    return undefined
  }

  const RTCSessionDescriptionCtor = scopes
    .map((scope) => scope.RTCSessionDescription || scope.mozRTCSessionDescription || scope.webkitRTCSessionDescription)
    .find(Boolean) ||
    RTCSessionDescriptionFallback
  const RTCIceCandidateCtor = scopes
    .map((scope) => scope.RTCIceCandidate || scope.mozRTCIceCandidate || scope.webkitRTCIceCandidate)
    .find(Boolean) ||
    RTCIceCandidateFallback

  return {
    RTCPeerConnection: RTCPeerConnectionCtor,
    RTCSessionDescription: RTCSessionDescriptionCtor,
    RTCIceCandidate: RTCIceCandidateCtor
  }
}

export function getWebRtcSupportReport(): string {
  const windowScope = typeof window !== 'undefined' ? window : undefined
  const selfScope = typeof self !== 'undefined' ? self : undefined
  const scope = globalThis as typeof globalThis & {
    webkitRTCPeerConnection?: typeof RTCPeerConnection
    mozRTCPeerConnection?: typeof RTCPeerConnection
  }

  return [
    `secureContext=${String(window.isSecureContext)}`,
    `globalThis.RTCPeerConnection=${typeof globalThis.RTCPeerConnection}`,
    `window.RTCPeerConnection=${typeof windowScope?.RTCPeerConnection}`,
    `self.RTCPeerConnection=${typeof selfScope?.RTCPeerConnection}`,
    `webkitRTCPeerConnection=${typeof scope.webkitRTCPeerConnection}`,
    `mozRTCPeerConnection=${typeof scope.mozRTCPeerConnection}`,
    `protocol=${window.location.protocol}`,
    `host=${window.location.host}`,
    `userAgent=${navigator.userAgent}`
  ].join(', ')
}

/** 主动 destroy / 页面卸载时 Chromium 常见「假错误」，不应占满 UI */
export function isBenignPeerTeardownError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /User-Initiated Abort|Close called|The operation was aborted|Connection was closed before/.test(
    msg
  )
}

export function assertWebRtcSupport(): WebRtcConstructors {
  const wrtc = getBrowserWebRtc()
  if (!wrtc) {
    throw new Error(`当前浏览器或页面环境不支持 WebRTC RTCPeerConnection。探测结果：${getWebRtcSupportReport()}`)
  }

  return wrtc
}

export async function getIceServers(): Promise<IceServer[]> {
  try {
    const response = await fetch(apiIceServersUrl())
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = (await response.json()) as { iceServers?: IceServer[] }
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return data.iceServers
    }
  } catch {
    // 本地纯前端调试或 API 不可用时，使用构建变量中的 STUN/TURN 配置兜底。
  }

  return appConfig.fallbackIceServers
}

/** 采集端摄像头采集约束（ideal，终端可按性能降级） */
export const CAMERA_CAPTURE_VIDEO_CONSTRAINTS = {
  facingMode: 'environment' as const,
  width: { ideal: 1920, min: 640 },
  height: { ideal: 1080, min: 360 },
  frameRate: { min: 30, ideal: 30, max: 60 }
}

const SWITCH_CAMERA_VIDEO_CONSTRAINTS = {
  width: { ideal: 1920, min: 640 },
  height: { ideal: 1080, min: 360 },
  frameRate: { min: 30, ideal: 30, max: 60 }
}

const RESOLUTION_BITRATES: Record<number, number> = {
  360: 900_000,
  480: 1_500_000,
  720: 4_000_000,
  1080: 8_000_000,
  1440: 16_000_000,
  2160: 30_000_000
}

function preferSmoothVideo(stream: MediaStream): MediaStream {
  for (const track of stream.getVideoTracks()) {
    try {
      track.contentHint = 'motion'
    } catch {
      // Older WebViews may expose contentHint as read-only or not support it.
    }
  }
  return stream
}

/** 尽量让摄像头源满足所选项；ideal 约束不会因硬件不支持 4K/90 帧而中断现有视频。 */
export async function applyVideoQualityPreferenceToTrack(
  track: MediaStreamTrack,
  preference: VideoQualityPreference
): Promise<void> {
  const profile = getVideoQualityProfile(preference)
  try {
    track.contentHint = profile.mode === 'frame-rate' ? 'motion' : 'detail'
  } catch {
    // Older WebViews may not support contentHint.
  }

  if (profile.mode === 'frame-rate') {
    await track.applyConstraints({
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: profile.value, max: profile.value }
    })
    return
  }

  await track.applyConstraints({
    width: { ideal: Math.round(profile.value * 16 / 9) },
    height: { ideal: profile.value },
    frameRate: { ideal: 90, max: 90 }
  })
}

/** 对单个观看端设置编码降级策略；最终实际值仍受摄像头、浏览器和网络能力限制。 */
export async function configureOutgoingVideoEncoding(
  peer: PeerInstance,
  preference: VideoQualityPreference,
  videoTrack?: MediaStreamTrack
): Promise<void> {
  const rtcPeer = peer as PeerInstance & { _pc?: RTCPeerConnection }
  const sender = rtcPeer._pc?.getSenders().find((entry) => entry.track?.kind === 'video')
  if (!sender) return

  try {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]

    const profile = getVideoQualityProfile(preference)
    const encoding = params.encodings[0]
    if (profile.mode === 'frame-rate') {
      encoding.maxFramerate = profile.value
      encoding.scaleResolutionDownBy = 1
      encoding.maxBitrate = 30_000_000
      params.degradationPreference = 'maintain-framerate'
    } else {
      const settings = (videoTrack ?? sender.track)?.getSettings()
      const sourceShortSide = Math.min(
        settings?.width ?? profile.value,
        settings?.height ?? profile.value
      )
      encoding.scaleResolutionDownBy = Math.max(1, sourceShortSide / profile.value)
      delete encoding.maxFramerate
      encoding.maxBitrate = RESOLUTION_BITRATES[profile.value] ?? 8_000_000
      params.degradationPreference = 'maintain-resolution'
    }
    await sender.setParameters(params)
  } catch {
    // 协商未完成或浏览器不支持这些编码参数时，继续使用浏览器自动策略。
  }
}

/** 观看端上行麦克风（仅音频） */
export async function getViewerMicMediaStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  })
}

function cameraDevicePriority(label: string): number {
  const value = label.toLowerCase()
  if (/超广角|ultra[\s-]*wide/.test(value)) return 0
  if (/双广角|dual[\s-]*wide/.test(value)) return 1
  if (/后置|背面|rear|back|environment/.test(value)) return 2
  if (/前置|正面|front|user|facetime/.test(value)) return 3
  return 4
}

/** 按采集偏好排序：后置超广角 > 后置双广角 > 后置相机 > 前置相机。 */
export function sortVideoInputDevices(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices
    .map((device, index) => ({ device, index }))
    .sort((a, b) => cameraDevicePriority(a.device.label) - cameraDevicePriority(b.device.label) || a.index - b.index)
    .map(({ device }) => device)
}

/** 采集端首次获取音视频；麦克风失败时降级为仅视频，并选用优先级最高的后置镜头。 */
export async function getCameraCaptureStream(): Promise<MediaStream> {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
  let initialStream: MediaStream
  try {
    initialStream = preferSmoothVideo(await navigator.mediaDevices.getUserMedia({
      video: CAMERA_CAPTURE_VIDEO_CONSTRAINTS,
      audio
    }))
  } catch {
    initialStream = preferSmoothVideo(await navigator.mediaDevices.getUserMedia({
      video: CAMERA_CAPTURE_VIDEO_CONSTRAINTS,
      audio: false
    }))
  }

  try {
    const preferred = sortVideoInputDevices(await listVideoInputDevices())[0]
    const currentId = initialStream.getVideoTracks()[0]?.getSettings().deviceId
    if (!preferred?.deviceId || preferred.deviceId === currentId) return initialStream

    const preferredVideo = await getCameraVideoMediaStreamByDeviceId(preferred.deviceId)
    const videoTrack = preferredVideo.getVideoTracks()[0]
    if (!videoTrack) {
      preferredVideo.getTracks().forEach((track) => track.stop())
      return initialStream
    }
    initialStream.getVideoTracks().forEach((track) => track.stop())
    return preferSmoothVideo(new MediaStream([videoTrack, ...initialStream.getAudioTracks()]))
  } catch {
    return initialStream
  }
}

export function createCameraPeer(localStream: MediaStream, iceServers: IceServer[]): PeerInstance {
  return new SimplePeer({
    initiator: true,
    stream: localStream,
    config: { iceServers },
    wrtc: assertWebRtcSupport()
  })
}

export function createViewerPeer(iceServers: IceServer[]): PeerInstance {
  return new SimplePeer({
    initiator: false,
    config: { iceServers },
    wrtc: assertWebRtcSupport()
  })
}

/** 枚举可用摄像头（需已有摄像头权限后调用，标签才较完整） */
export async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  const list = await navigator.mediaDevices.enumerateDevices()
  const seen = new Set<string>()
  const out: MediaDeviceInfo[] = []
  for (const d of list) {
    if (d.kind !== 'videoinput' || !d.deviceId || seen.has(d.deviceId)) {
      continue
    }
    seen.add(d.deviceId)
    out.push(d)
  }
  return out
}

/**
 * 切换到指定 deviceId 的视频轨，并更新所有已建立的 camera→viewer PeerConnection 的发送轨。
 */
export async function replaceOutgoingVideoTrackForPeers(
  peers: Iterable<PeerInstance>,
  videoTrack: MediaStreamTrack
): Promise<void> {
  await Promise.all(
    [...peers].map(async (peer) => {
      const rtcPeer = peer as PeerInstance & { _pc?: RTCPeerConnection }
      const pc = rtcPeer._pc
      if (!pc) {
        return
      }
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (sender) {
        await sender.replaceTrack(videoTrack)
      }
    })
  )
}

export async function getCameraVideoMediaStreamByDeviceId(deviceId: string): Promise<MediaStream> {
  try {
    return preferSmoothVideo(await navigator.mediaDevices.getUserMedia({
      video: { ...SWITCH_CAMERA_VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } },
      audio: false
    }))
  } catch {
    return preferSmoothVideo(await navigator.mediaDevices.getUserMedia({
      video: { ...SWITCH_CAMERA_VIDEO_CONSTRAINTS, deviceId: { ideal: deviceId } },
      audio: false
    }))
  }
}
