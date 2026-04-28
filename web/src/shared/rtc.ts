import SimplePeer from 'simple-peer'
import { appConfig, type IceServer } from '../config'

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

export function assertWebRtcSupport(): WebRtcConstructors {
  const wrtc = getBrowserWebRtc()
  if (!wrtc) {
    throw new Error(`当前浏览器或页面环境不支持 WebRTC RTCPeerConnection。探测结果：${getWebRtcSupportReport()}`)
  }

  return wrtc
}

export async function getIceServers(): Promise<IceServer[]> {
  try {
    const response = await fetch('/api/ice-servers')
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
