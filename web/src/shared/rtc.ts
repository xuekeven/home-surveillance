import SimplePeer from 'simple-peer'
import { apiIceServersUrl, appConfig, type IceServer } from '../config'

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

/** 采集端首次获取音视频；麦克风失败时降级为仅视频，避免整页不可用 */
export async function getCameraCaptureStream(): Promise<MediaStream> {
  const video = {
    facingMode: 'environment' as const,
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 20, max: 30 }
  }
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio })
  } catch {
    return navigator.mediaDevices.getUserMedia({ video, audio: false })
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
  const base = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 20, max: 30 }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...base, deviceId: { exact: deviceId } },
      audio: false
    })
  } catch {
    return navigator.mediaDevices.getUserMedia({
      video: { ...base, deviceId: { ideal: deviceId } },
      audio: false
    })
  }
}

export async function detectSelectedCandidateType(peer: PeerInstance): Promise<string | undefined> {
  const rtcPeer = peer as PeerInstance & { _pc?: RTCPeerConnection }
  const connection = rtcPeer._pc
  if (!connection) {
    return undefined
  }

  const stats = await connection.getStats()
  let selectedCandidatePair: Record<string, unknown> | undefined

  stats.forEach((report) => {
    const typedReport = report as unknown as Record<string, unknown>
    if (report.type === 'transport' && typeof typedReport.selectedCandidatePairId === 'string') {
      selectedCandidatePair = stats.get(typedReport.selectedCandidatePairId) as unknown as Record<string, unknown>
    }

    if (
      report.type === 'candidate-pair' &&
      typedReport.nominated === true &&
      typedReport.state === 'succeeded'
    ) {
      selectedCandidatePair = typedReport
    }
  })

  const localCandidateId = selectedCandidatePair?.localCandidateId
  if (typeof localCandidateId !== 'string') {
    return undefined
  }

  const localCandidate = stats.get(localCandidateId) as unknown as Record<string, unknown> | undefined
  return typeof localCandidate?.candidateType === 'string'
    ? localCandidate.candidateType
    : undefined
}
