import { useEffect, useState } from 'react'

function formatLocalClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export type VideoClockOverlayProps =
  | {
      variant: 'camera'
      /** 有本地预览流时在左上角显示采集设备当前时间（本机 wall clock） */
      active: boolean
    }
  | {
      variant: 'viewer'
      /** 采集端 Unix 时间与本机 Date.now() 的差；未收到首包时为 null */
      skewMs: number | null
      /** 有远端画面时尝试显示采集端时间 */
      active: boolean
    }

/**
 * 两端视频左上角统一展示「采集端当前时间」：
 * — 采集页：本机实时时钟；
 * — 观看页：由信令 `room-clock`（采集端每秒广播）校准后的推导时间。
 */
export function VideoClockOverlay(props: VideoClockOverlayProps) {
  const [, bump] = useState(0)
  const skewMs = props.variant === 'viewer' ? props.skewMs : null

  useEffect(() => {
    if (!props.active) {
      return undefined
    }
    if (props.variant === 'viewer' && skewMs === null) {
      return undefined
    }

    const id = window.setInterval(() => bump((x) => x + 1), 250)
    return () => window.clearInterval(id)
  }, [props.variant, props.active, skewMs])

  if (props.variant === 'camera') {
    if (!props.active) {
      return null
    }
    return (
      <div className="video-clock-overlay" aria-hidden="true">
        {formatLocalClock(new Date())}
      </div>
    )
  }

  if (!props.active || props.skewMs === null) {
    return null
  }

  const ms = Date.now() + props.skewMs
  return (
    <div className="video-clock-overlay" aria-hidden="true">
      {formatLocalClock(new Date(ms))}
    </div>
  )
}
