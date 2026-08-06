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

function formatLatency(value: number | undefined): string {
  return value === undefined ? '--' : Math.round(value) + ' 毫秒'
}

function formatTransferAndLatency(
  bitrateBps: number | undefined,
  latencyMs: number | undefined
): string {
  const latency = latencyMs === undefined ? '--' : Math.round(latencyMs) + 'ms'
  return '速度 ' + formatBitrate(bitrateBps) + ' 延迟 ' + latency
}

function formatStability(value: number | undefined): string {
  if (value === undefined) {
    return '--'
  }
  return value <= 20 ? '画面稳定' : value <= 50 ? '偶尔有轻微卡顿' : '可能出现明显卡顿'
}

function formatVideoSize(
  width: number | undefined,
  height: number | undefined,
  framesPerSecond: number | undefined
): string {
  if (!width || !height) {
    return '--'
  }
  const fps = framesPerSecond ? ' 帧数 ' + Math.round(framesPerSecond) : ''
  return '像素 ' + width + '×' + height + fps
}

function formatLocalAddress(address: string | undefined): string {
  if (!address) return '浏览器未提供'
  if (address.endsWith('.local')) return '浏览器已隐藏'
  return address
}

function cleanAddress(address: string | undefined): string | undefined {
  if (!address) return undefined
  const trimmed = address.trim()
  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed
  return withoutBrackets.split("%")[0].toLowerCase()
}

function ipv4Parts(address: string | undefined): number[] | undefined {
  const value = cleanAddress(address)
  if (!value) return undefined
  const parts = value.split(".")
  if (parts.length !== 4) return undefined
  const numbers = parts.map(Number)
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? numbers
    : undefined
}

function isPrivateIpv4(address: string | undefined): boolean {
  const parts = ipv4Parts(address)
  if (!parts) return false
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  )
}

function isTailscaleIpv4(address: string | undefined): boolean {
  const parts = ipv4Parts(address)
  return Boolean(parts && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
}

function isIpv6(address: string | undefined): boolean {
  return cleanAddress(address)?.includes(":") ?? false
}

function isTailscaleIpv6(address: string | undefined): boolean {
  return cleanAddress(address)?.startsWith("fd7a:115c:a1e0:") ?? false
}

function isPrivateIpv6(address: string | undefined): boolean {
  const value = cleanAddress(address)
  if (!value) return false
  const first = Number.parseInt(value.split(":")[0], 16)
  return Number.isFinite(first) && (first & 0xfe00) === 0xfc00
}

function isLinkLocalIpv6(address: string | undefined): boolean {
  const value = cleanAddress(address)
  if (!value) return false
  const first = Number.parseInt(value.split(":")[0], 16)
  return Number.isFinite(first) && (first & 0xffc0) === 0xfe80
}

function expandIpv6(address: string | undefined): string[] | undefined {
  const value = cleanAddress(address)
  if (!value || !value.includes(":")) return undefined
  const halves = value.split("::")
  if (halves.length > 2) return undefined
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined
  const parts = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head
  if (
    parts.length !== 8 ||
    parts.some(
      (part) =>
        part.length < 1 ||
        part.length > 4 ||
        [...part].some((character) => !"0123456789abcdef".includes(character))
    )
  ) {
    return undefined
  }
  return parts.map((part) => part.padStart(4, "0"))
}

function sameIpv6Prefix64(local: string | undefined, remote: string | undefined): boolean {
  const left = expandIpv6(local)
  const right = expandIpv6(remote)
  return Boolean(left && right && left.slice(0, 4).every((part, index) => part === right[index]))
}

export function getWebRtcConnectionTypeLabel(stats: WebRtcLinkStats): string {
  const localType = stats.localCandidateType
  const remoteType = stats.remoteCandidateType
  const local = cleanAddress(stats.localAddress)
  const remote = cleanAddress(stats.remoteAddress)
  const addresses = [local, remote]

  if (localType === "relay" || remoteType === "relay") {
    return "通过服务器中转（TURN）"
  }

  const tailscaleIpv4Pair =
    localType === "host" &&
    remoteType === "host" &&
    isTailscaleIpv4(local) &&
    isTailscaleIpv4(remote)
  if (addresses.some(isTailscaleIpv6) || tailscaleIpv4Pair) {
    return "Tailscale 私有网络连接"
  }

  const usesIpv4 = stats.ipVersion === "IPv4" || addresses.some((address) => Boolean(ipv4Parts(address)))
  if (usesIpv4 && (localType === "prflx" || remoteType === "prflx")) {
    return "NAT 打洞直连（IPv4）"
  }
  if (usesIpv4 && (localType === "srflx" || remoteType === "srflx")) {
    return "NAT 映射直连（IPv4）"
  }

  const localIpv4 = ipv4Parts(local)
  const remoteIpv4 = ipv4Parts(remote)
  if (localIpv4 && remoteIpv4) {
    if (isPrivateIpv4(local) && isPrivateIpv4(remote)) return "局域网（IPv4）"
    if (!isPrivateIpv4(local) && !isPrivateIpv4(remote)) return "公网 IPv4 直连"
    return "其他私有网络连接"
  }

  if (isIpv6(local) && isIpv6(remote)) {
    if (addresses.some(isPrivateIpv6)) return "其他私有网络连接"
    if (addresses.some(isLinkLocalIpv6) || sameIpv6Prefix64(local, remote)) {
      return "局域网（IPv6）"
    }
    return "公网 IPv6 直连"
  }

  if (addresses.some(isPrivateIpv4) || addresses.some(isPrivateIpv6)) {
    return "其他私有网络连接"
  }
  if (addresses.some((address) => Boolean(ipv4Parts(address)))) return "公网 IPv4 直连"
  if (addresses.some(isIpv6)) return "公网 IPv6 直连"
  return "两台设备直接连接"
}

function codecLabel(codec: string | undefined): string {
  switch (codec?.toUpperCase()) {
    case 'VP8':
      return '浏览器自动选择（VP8）'
    case 'VP9':
      return '浏览器自动选择（VP9）'
    case 'H264':
    case 'H.264':
      return '浏览器自动选择（H.264）'
    case 'AV1':
      return '浏览器自动选择（AV1）'
    default:
      return codec ?? '--'
  }
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
  inline = false,
  viewerLayout = false,
  localAddressLabel = '本端 IP',
  connectionTypeOverride
}: {
  stats?: WebRtcLinkStats
  capture?: CaptureVideoStats
  inline?: boolean
  viewerLayout?: boolean
  localAddressLabel?: string
  connectionTypeOverride?: string
}) {
  const route =
    connectionTypeOverride ??
    (stats ? getWebRtcConnectionTypeLabel(stats) : '正在检测')
  const routeWithAddress = stats
    ? route + '；本端 IP：' + formatLocalAddress(stats.localAddress)
    : '--'

  const metrics = viewerLayout ? (
    <>
      <Metric
        label='传输和延迟'
        value={formatTransferAndLatency(stats?.bitrateBps, stats?.roundTripTimeMs)}
      />
      <Metric
        label='画面质量'
        value={formatVideoSize(stats?.frameWidth, stats?.frameHeight, stats?.framesPerSecond)}
      />
      <Metric label='画面稳定性' value={formatStability(stats?.jitterMs)} />
      <Metric label={localAddressLabel} value={stats ? formatLocalAddress(stats.localAddress) : '--'} />
      <Metric label='连接方式' value={route} />
      <Metric label='视频格式' value={codecLabel(stats?.codec)} />
    </>
  ) : (
    <>
      {capture ? (
        <Metric
          label='本地采集'
          value={formatVideoSize(capture.width, capture.height, capture.frameRate)}
        />
      ) : null}
      <Metric
        label={stats?.direction === 'outbound' ? '视频上传速度' : '视频传输速度'}
        value={formatBitrate(stats?.bitrateBps)}
      />
      <Metric
        label='画面质量'
        value={formatVideoSize(stats?.frameWidth, stats?.frameHeight, stats?.framesPerSecond)}
      />
      <Metric label='网络延迟' value={formatLatency(stats?.roundTripTimeMs)} />
      <Metric label='画面稳定性' value={formatStability(stats?.jitterMs)} />
      <Metric label='连接方式' value={routeWithAddress} />
      <Metric label='视频格式' value={codecLabel(stats?.codec)} />
      {stats?.direction === 'outbound' ? (
        <Metric label='画质限制' value={qualityLimitationLabel(stats.qualityLimitationReason)} />
      ) : null}
      {stats?.implementation ? <Metric label='编解码实现' value={stats.implementation} /> : null}
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
