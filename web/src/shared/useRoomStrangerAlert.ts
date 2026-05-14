import { useEffect, useState } from 'react'
import { fetchRoomStrangerAlertEnabled } from './familyMembersApi'

const POLL_MS = 45_000

/**
 * 从服务端读取当前房间的「陌生人警告」开关（与后台 `strangerFaceAlert` 同源）。
 * 需在客户端开启人脸检测并上报时，再结合 `FaceAnalysisOverlay.faceAlert.enabled` 使用。
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
