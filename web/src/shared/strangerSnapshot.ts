import { apiStrangerScreenshotsUrl } from '../config'

const PNG_PREFIX = 'data:image/png;base64,'

function videoContentRect(video: HTMLVideoElement) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const cw = video.clientWidth
  const ch = video.clientHeight
  if (!vw || !vh || !cw || !ch) {
    return null
  }
  const scale = Math.min(cw / vw, ch / vh)
  const dw = vw * scale
  const dh = vh * scale
  const ox = (cw - dw) / 2
  const oy = (ch - dh) / 2
  return { ox, oy, dw, dh }
}

/** 与叠加层一致：视频 letterbox + 半透明人脸框，导出 PNG data URL */
export function compositeVideoFrameWithOverlay(
  video: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement
): string | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const cw = video.clientWidth
  const ch = video.clientHeight
  const rect = videoContentRect(video)
  if (!rect || !vw || !vh || overlayCanvas.width < 1 || overlayCanvas.height < 1) {
    return null
  }

  const out = document.createElement('canvas')
  out.width = overlayCanvas.width
  out.height = overlayCanvas.height
  const ctx = out.getContext('2d')
  if (!ctx) {
    return null
  }

  try {
    const scale = out.width / cw
    const { ox, oy, dw, dh } = rect
    ctx.drawImage(video, 0, 0, vw, vh, ox * scale, oy * scale, dw * scale, dh * scale)
    ctx.drawImage(overlayCanvas, 0, 0)

    return out.toDataURL('image/png')
  } catch {
    return null
  }
}

export async function postStrangerScreenshots(options: {
  roomId: string
  token: string
  imageDataUrl: string
  strangerCount: number
}): Promise<void> {
  const n = Math.max(1, Math.min(99, Math.floor(options.strangerCount)))
  if (!options.imageDataUrl.startsWith(PNG_PREFIX)) {
    console.warn('[stranger-screenshots] expected PNG data URL')
    return
  }

  try {
    const res = await fetch(apiStrangerScreenshotsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token}`
      },
      body: JSON.stringify({
        roomId: options.roomId,
        imageDataUrl: options.imageDataUrl,
        strangerCount: n
      })
    })
    if (!res.ok) {
      const text = await res.text()
      console.warn('[stranger-screenshots]', res.status, text.slice(0, 200))
    }
  } catch (error) {
    console.warn('[stranger-screenshots]', error)
  }
}
