import { useEffect, useState } from 'react'

function formatLocalClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export type VideoClockOverlayProps =
  | {
      variant: 'camera'
      /** 与 `camera-room-clock` 同一 Unix 毫秒，未起流或未打点时不显示 */
      clockMs: number | undefined
    }
  | {
      variant: 'viewer'
      /** 采集端 Unix 时间与本机 Date.now() 的差；未收到首包时为 null */
      skewMs: number | null
      active: boolean
    }

/**
 * 统一展示采集端时钟：采集页用本机打点；观看端用信令 `room-clock` 校准后的推导时间。
 */
export function VideoClockOverlay(props: VideoClockOverlayProps) {
  const [, setBump] = useState(0)

  useEffect(() => {
    if (props.variant === 'camera') {
      if (props.clockMs === undefined) {
        return undefined
      }
    } else {
      if (!props.active || props.skewMs === null) {
        return undefined
      }
    }
    const id = window.setInterval(() => setBump((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [props])

  if (props.variant === 'camera') {
    if (props.clockMs === undefined) {
      return null
    }
    return (
      <div className="video-clock-overlay" aria-hidden="true">
        {formatLocalClock(new Date(props.clockMs))}
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
