import type { PeerInstance } from './rtc'

export type WebRtcStatsDirection = 'outbound' | 'inbound'

export interface WebRtcStatsSnapshot {
  sampledAtMs: number
  videoBytes: number
  packetsLost?: number
  packetsReceived?: number
}

export interface WebRtcLinkStats {
  sampledAtMs: number
  direction: WebRtcStatsDirection
  bitrateBps?: number
  availableOutgoingBitrateBps?: number
  availableIncomingBitrateBps?: number
  roundTripTimeMs?: number
  packetLossPercent?: number
  jitterMs?: number
  frameWidth?: number
  frameHeight?: number
  framesPerSecond?: number
  codec?: string
  localCandidateType?: string
  remoteCandidateType?: string
  protocol?: string
  qualityLimitationReason?: string
  implementation?: string
}

type StatsRecord = Record<string, unknown> & {
  id?: string
  type?: string
  timestamp?: number
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function toRecord(value: unknown): StatsRecord | undefined {
  return value && typeof value === 'object' ? (value as StatsRecord) : undefined
}

function findSelectedCandidatePair(report: RTCStatsReport): StatsRecord | undefined {
  let selectedPair: StatsRecord | undefined

  report.forEach((raw) => {
    const stat = toRecord(raw)
    if (!stat) {
      return
    }

    if (stat.type === 'transport') {
      const pairId = asString(stat.selectedCandidatePairId)
      const pair = pairId ? toRecord(report.get(pairId)) : undefined
      if (pair) {
        selectedPair = pair
      }
      return
    }

    if (
      stat.type === 'candidate-pair' &&
      (stat.selected === true || (stat.nominated === true && stat.state === 'succeeded'))
    ) {
      selectedPair = stat
    }
  })

  return selectedPair
}

function findVideoRtpStat(
  report: RTCStatsReport,
  direction: WebRtcStatsDirection
): StatsRecord | undefined {
  let match: StatsRecord | undefined
  const expectedType = direction === 'outbound' ? 'outbound-rtp' : 'inbound-rtp'

  report.forEach((raw) => {
    const stat = toRecord(raw)
    if (
      stat?.type === expectedType &&
      stat.isRemote !== true &&
      (stat.kind === 'video' || stat.mediaType === 'video')
    ) {
      match = stat
    }
  })

  return match
}

function findRemoteInboundStat(
  report: RTCStatsReport,
  outbound: StatsRecord | undefined
): StatsRecord | undefined {
  let fallback: StatsRecord | undefined
  let match: StatsRecord | undefined

  report.forEach((raw) => {
    const stat = toRecord(raw)
    if (stat?.type !== 'remote-inbound-rtp' || (stat.kind !== 'video' && stat.mediaType !== 'video')) {
      return
    }

    fallback = stat
    if (outbound?.id && stat.localId === outbound.id) {
      match = stat
    }
  })

  return match ?? fallback
}

function computeBitrate(
  sampledAtMs: number,
  bytes: number,
  previous: WebRtcStatsSnapshot | undefined
): number | undefined {
  if (!previous || bytes < previous.videoBytes || sampledAtMs <= previous.sampledAtMs) {
    return undefined
  }

  const elapsedSeconds = (sampledAtMs - previous.sampledAtMs) / 1000
  return elapsedSeconds > 0 ? ((bytes - previous.videoBytes) * 8) / elapsedSeconds : undefined
}

function computePacketLossPercent(
  source: StatsRecord | undefined,
  previous: WebRtcStatsSnapshot | undefined
): number | undefined {
  const fractionLost = asNumber(source?.fractionLost)
  if (fractionLost !== undefined && fractionLost >= 0) {
    return Math.min(100, fractionLost * 100)
  }

  const packetsLost = asNumber(source?.packetsLost)
  const packetsReceived = asNumber(source?.packetsReceived)
  if (
    packetsLost === undefined ||
    packetsReceived === undefined ||
    previous?.packetsLost === undefined ||
    previous.packetsReceived === undefined
  ) {
    return undefined
  }

  const lostDelta = Math.max(0, packetsLost - previous.packetsLost)
  const receivedDelta = Math.max(0, packetsReceived - previous.packetsReceived)
  const total = lostDelta + receivedDelta
  return total > 0 ? (lostDelta / total) * 100 : 0
}

export function getPeerConnection(peer: PeerInstance): RTCPeerConnection | undefined {
  return (peer as PeerInstance & { _pc?: RTCPeerConnection })._pc
}

export async function sampleWebRtcLinkStats(
  peer: PeerInstance,
  direction: WebRtcStatsDirection,
  previous?: WebRtcStatsSnapshot
): Promise<{ stats: WebRtcLinkStats; snapshot: WebRtcStatsSnapshot } | null> {
  const connection = getPeerConnection(peer)
  if (!connection || connection.connectionState === 'closed') {
    return null
  }

  const report = await connection.getStats()
  const video = findVideoRtpStat(report, direction)
  if (!video) {
    return null
  }

  const remoteInbound = direction === 'outbound' ? findRemoteInboundStat(report, video) : undefined
  const lossSource = remoteInbound ?? video
  const pair = findSelectedCandidatePair(report)
  const localCandidate = toRecord(
    pair ? report.get(asString(pair.localCandidateId) ?? '') : undefined
  )
  const remoteCandidate = toRecord(
    pair ? report.get(asString(pair.remoteCandidateId) ?? '') : undefined
  )
  const codec = toRecord(report.get(asString(video.codecId) ?? ''))

  const sampledAtMs = asNumber(video.timestamp) ?? Date.now()
  const videoBytes =
    asNumber(direction === 'outbound' ? video.bytesSent : video.bytesReceived) ?? 0
  const packetsLost = asNumber(lossSource.packetsLost)
  const packetsReceived = asNumber(lossSource.packetsReceived)
  const snapshot: WebRtcStatsSnapshot = {
    sampledAtMs,
    videoBytes,
    ...(packetsLost !== undefined ? { packetsLost } : {}),
    ...(packetsReceived !== undefined ? { packetsReceived } : {})
  }

  const pairRtt = asNumber(pair?.currentRoundTripTime)
  const remoteRtt = asNumber(remoteInbound?.roundTripTime)
  const jitterSeconds = asNumber(lossSource.jitter)

  return {
    snapshot,
    stats: {
      sampledAtMs,
      direction,
      bitrateBps: computeBitrate(sampledAtMs, videoBytes, previous),
      availableOutgoingBitrateBps: asNumber(pair?.availableOutgoingBitrate),
      availableIncomingBitrateBps: asNumber(pair?.availableIncomingBitrate),
      roundTripTimeMs:
        pairRtt !== undefined
          ? pairRtt * 1000
          : remoteRtt !== undefined
            ? remoteRtt * 1000
            : undefined,
      packetLossPercent: computePacketLossPercent(lossSource, previous),
      jitterMs: jitterSeconds !== undefined ? jitterSeconds * 1000 : undefined,
      frameWidth: asNumber(video.frameWidth),
      frameHeight: asNumber(video.frameHeight),
      framesPerSecond: asNumber(video.framesPerSecond),
      codec: asString(codec?.mimeType)?.replace(/^video\//i, ''),
      localCandidateType: asString(localCandidate?.candidateType),
      remoteCandidateType: asString(remoteCandidate?.candidateType),
      protocol: asString(pair?.protocol) ?? asString(localCandidate?.protocol),
      qualityLimitationReason: asString(video.qualityLimitationReason),
      implementation:
        asString(video.encoderImplementation) ?? asString(video.decoderImplementation)
    }
  }
}
