import SimplePeer from 'simple-peer'
import { appConfig, type IceServer } from '../config'

export type PeerInstance = SimplePeer.Instance

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
    config: { iceServers }
  })
}

export function createViewerPeer(iceServers: IceServer[]): PeerInstance {
  return new SimplePeer({
    initiator: false,
    config: { iceServers }
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
