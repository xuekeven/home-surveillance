import { apiFaceAlertUrl } from '../config'

/** 上报服务端以触发企微通知（服务端再做冷却与 RELAY 调用） */
export async function postFaceAlert(roomId: string, token: string, strangerCount: number): Promise<void> {
  try {
    const res = await fetch(apiFaceAlertUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, token, strangerCount })
    })
    if (!res.ok) {
      const text = await res.text()
      console.warn('[face-alert]', res.status, text.slice(0, 200))
    }
  } catch (error) {
    console.warn('[face-alert]', error)
  }
}
