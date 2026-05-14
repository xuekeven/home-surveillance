import { useEffect, useState } from 'react'
import { fetchRoomStrangerAlertEnabled } from './familyMembersApi'

const POLL_MS = 45_000

/**
 * 从服务端读取当前房间的「陌生人抓拍和警告」开关（字段仍为 `strangerFaceAlert`，与后台同源）。
 * **采集端**：仅在为 true 时才挂载人脸推理链路（MediaPipe / face-api）并抓拍、可告警。
 * **观看端**：是否与远端人脸推理无关；观看端仍仅由页面「陌生人检测」开关控制。
 */
export function useRoomStrangerAlert(roomToken: string, roomId: string): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const next = await fetchRoomStrangerAlertEnabled(roomToken, roomId)
        if (!cancelled) {
          setEnabled(next)
        }
      } catch {
        if (!cancelled) {
          setEnabled(false)
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [roomToken, roomId])

  return enabled
}
