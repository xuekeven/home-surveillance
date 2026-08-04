import type { WebRtcLinkStats } from './webrtcStats'

export interface CaptureVideoStats {
  width?: number
  height?: number
  frameRate?: number
}

function formatBitrate(value: number | undefined): string {
  if (value === undefined) {
    return '--'
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} Mbps`
  }
  return `${Math.round(value / 1000)} Kbps`
}

function formatMilliseconds(value: number | undefined): string {
  return value === undefined ? '--' : `${Math.round(value)} ms`
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) {
    return '--'
  }
  return `${value < 0.1 ? value.toFixed(2) : value.toFixed(1)}%`
}

function formatVideoSize(
  width: number | undefined,
  height: number | undefined,
  framesPerSecond: number | undefined
): string {
  if (!width || !height) {
    return '--'
  }
  const fps = framesPerSecond ? ` / ${Math.round(framesPerSecond)} fps` : ''
  return `${width} x ${height}${fps}`
}

function qualityLimitationLabel(reason: string | undefined): string {
  switch (reason) {
    case 'bandwidth':
      return '带宽受限'
    case 'cpu':
      return 'CPU 受限'
    case 'other':
      return '其他限制'
    case 'none':
      return '无'
    default:
      return '--'
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item webrtc-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function WebRtcStatsPanel({
  stats,
  capture,
  inline = false
}: {
  stats?: WebRtcLinkStats
  capture?: CaptureVideoStats
  inline?: boolean
}) {
  const bandwidth =
    stats?.direction === 'outbound'
      ? stats.availableOutgoingBitrateBps
      : stats?.availableIncomingBitrateBps
  const route = stats
    ? `${stats.localCandidateType ?? '?'} -> ${stats.remoteCandidateType ?? '?'}${
        stats.protocol ? ` / ${stats.protocol.toUpperCase()}` : ''
      }`
    : '--'

  const metrics = (
    <>
      {capture ? (
        <Metric
          label="本地采集"
          value={formatVideoSize(capture.width, capture.height, capture.frameRate)}
        />
      ) : null}
      <Metric
        label={stats?.direction === 'outbound' ? '视频发送码率' : '视频接收码率'}
        value={formatBitrate(stats?.bitrateBps)}
      />
      <Metric
        label={stats?.direction === 'outbound' ? '可用上行带宽' : '可用下行带宽'}
        value={formatBitrate(bandwidth)}
      />
      <Metric
        label="传输规格"
        value={formatVideoSize(stats?.frameWidth, stats?.frameHeight, stats?.framesPerSecond)}
      />
      <Metric label="往返延迟 RTT" value={formatMilliseconds(stats?.roundTripTimeMs)} />
      <Metric label="丢包率" value={formatPercent(stats?.packetLossPercent)} />
      <Metric label="抖动" value={formatMilliseconds(stats?.jitterMs)} />
      <Metric label="ICE 路径" value={route} />
      <Metric label="视频编码" value={stats?.codec ?? '--'} />
      {stats?.direction === 'outbound' ? (
        <Metric label="画质限制" value={qualityLimitationLabel(stats.qualityLimitationReason)} />
      ) : null}
      {stats?.implementation ? <Metric label="编解码实现" value={stats.implementation} /> : null}
    </>
  )

  if (inline) {
    return metrics
  }

  return (
    <div className="webrtc-diagnostics">
      <div className="grid webrtc-metrics">{metrics}</div>
    </div>
  )
}
