import { config } from './config.js'

const roomCooldownUntil = new Map<string, number>()

export function buildViewerUrls(roomId: string): { url1: string; url2: string } {
  const basePath = config.publicBasePath || ''
  const path = `${basePath}/viewer/${encodeURIComponent(roomId)}`
  return {
    url1: `${config.faceAlertOriginPrimary}${path}`,
    url2: `${config.faceAlertOriginSecondary}${path}`
  }
}

export function formatFaceAlertContent(roomId: string, strangerCount: number): string {
  const { url1, url2 } = buildViewerUrls(roomId)
  const n = Math.max(1, Math.floor(strangerCount))
  return `【${roomId}】监控检测到【${n}】个陌生人，请关注！\n点击 ${url1} 或者 ${url2} 查看实时监控。`
}

export type FaceAlertDispatchResult =
  | { ok: true; relay: unknown }
  | { ok: false; skipped: true; reason: 'relay_not_configured' | 'cooldown' }
  | { ok: false; skipped: false; status: number; body: string }

/**
 * 调用 wework-send 转发文本；同一 roomId 在 faceAlertCooldownMs 内只发送一次。
 */
export async function dispatchFaceAlert(roomId: string, strangerCount: number): Promise<FaceAlertDispatchResult> {
  if (!config.weworkRelayUrl || !config.weworkRelayApiKey) {
    return { ok: false, skipped: true, reason: 'relay_not_configured' }
  }

  const count = Number.isFinite(strangerCount) ? Math.max(1, Math.min(99, Math.floor(strangerCount))) : 1

  const now = Date.now()
  const until = roomCooldownUntil.get(roomId) ?? 0
  if (now < until) {
    return { ok: false, skipped: true, reason: 'cooldown' }
  }

  const content = formatFaceAlertContent(roomId, count)
  const url = `${config.weworkRelayUrl}/wework/send/message`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.weworkRelayApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      ...(config.weworkRelayTouser ? { touser: config.weworkRelayTouser } : {})
    })
  })

  const text = await response.text()
  if (!response.ok) {
    return { ok: false, skipped: false, status: response.status, body: text.slice(0, 500) }
  }

  roomCooldownUntil.set(roomId, now + config.faceAlertCooldownMs)

  let relayJson: unknown = text
  try {
    relayJson = JSON.parse(text) as unknown
  } catch {
    relayJson = text
  }

  return { ok: true, relay: relayJson }
}
