import { FaceDetector, FilesetResolver, type Detection } from '@mediapipe/tasks-vision'
import { type RefObject, useEffect, useRef } from 'react'
import { postFaceAlert } from './faceAlertApi'
import { createFaceTrackerState, stepFaceTracks, type FaceTrackerState } from './faceTracking'

const CLIENT_FACE_ALERT_DEBOUNCE_MS = 60_000

const MEDIAPIPE_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const BLAZE_FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite'

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

function mapBoxToOverlay(
  box: { originX: number; originY: number; width: number; height: number },
  rect: NonNullable<ReturnType<typeof videoContentRect>>,
  vw: number,
  vh: number
) {
  const { ox, oy, dw, dh } = rect
  const sx = dw / vw
  const sy = dh / vh
  return {
    x: ox + box.originX * sx,
    y: oy + box.originY * sy,
    w: box.width * sx,
    h: box.height * sy
  }
}

async function createDetector(): Promise<FaceDetector> {
  const wasm = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE)
  const opts = {
    baseOptions: {
      modelAssetPath: BLAZE_FACE_MODEL,
      delegate: 'CPU' as const
    },
    runningMode: 'VIDEO' as const,
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.35
  }
  try {
    return await FaceDetector.createFromOptions(wasm, {
      ...opts,
      baseOptions: { ...opts.baseOptions, delegate: 'GPU' }
    })
  } catch {
    return await FaceDetector.createFromOptions(wasm, opts)
  }
}

type FaceAlertNotifyConfig = {
  roomId: string
  token: string
  enabled: boolean
}

type FaceAnalysisOverlayProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  /** 无流或未就绪时不跑推理，减轻占用 */
  active: boolean
  /** 检测到人脸后上报服务端转发企微（受服务端与本地防抖限制） */
  faceAlert?: FaceAlertNotifyConfig
}

/**
 * 人脸检测 + 跨帧跟踪编号 + 基于位移的移动活体（非身份识别、非金融级活体）。
 * 在画面上绘制红色跟踪框。
 */
export function FaceAnalysisOverlay({ videoRef, active, faceAlert }: FaceAnalysisOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackerRef = useRef<FaceTrackerState>(createFaceTrackerState())
  const faceAlertRef = useRef(faceAlert)
  faceAlertRef.current = faceAlert

  const lastTrackedCountRef = useRef(0)
  const lastClientAlertAtRef = useRef(0)

  useEffect(() => {
    if (!active) {
      const c = canvasRef.current
      const ctx = c?.getContext('2d')
      if (c && ctx) {
        ctx.clearRect(0, 0, c.width, c.height)
      }
      return
    }

    trackerRef.current = createFaceTrackerState()

    let cancelled = false
    let detector: FaceDetector | null = null
    let raf = 0
    let lastDetections: Detection[] = []
    let frameTick = 0

    const resizeCanvas = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) {
        return
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const cw = video.clientWidth
      const ch = video.clientHeight
      const w = Math.max(1, Math.round(cw * dpr))
      const h = Math.max(1, Math.round(ch * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      canvas.style.width = `${cw}px`
      canvas.style.height = `${ch}px`
    }

    const draw = (
      ctx: CanvasRenderingContext2D,
      dpr: number,
      video: HTMLVideoElement,
      detections: Detection[]
    ) => {
      const cw = video.clientWidth
      const ch = video.clientHeight
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)

      const vw = video.videoWidth
      const vh = video.videoHeight
      const rect = videoContentRect(video)
      if (!rect || !vw || !vh) {
        lastTrackedCountRef.current = 0
        return
      }

      const tracked = stepFaceTracks(detections, vw, vh, trackerRef.current)
      lastTrackedCountRef.current = tracked.length

      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#ef4444'

      for (const face of tracked) {
        const { x, y, w, h } = mapBoxToOverlay(face.box, rect, vw, vh)
        ctx.strokeRect(x, y, w, h)

        const label = `人脸 ${face.id}`
        const live = face.motionLive ? '移动活体' : '待活体'
        const text = `${label} · ${live}`
        const padX = 8
        const padY = 5
        const tw = ctx.measureText(text).width
        const boxH = 22
        const lx = x
        const ly = Math.max(0, y - boxH - 4)

        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'
        ctx.fillRect(lx, ly, tw + padX * 2, boxH)

        ctx.fillStyle = face.motionLive ? '#86efac' : '#fcd34d'
        ctx.fillText(text, lx + padX, ly + 17)
      }
    }

    const loop = () => {
      if (cancelled) {
        return
      }
      raf = requestAnimationFrame(loop)

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return
      }

      resizeCanvas()
      const ctx = canvas.getContext('2d')
      if (!ctx || !detector) {
        return
      }

      const dpr = canvas.width / Math.max(1, video.clientWidth)

      frameTick++
      if (frameTick % 2 === 0) {
        try {
          lastDetections = detector.detectForVideo(video, performance.now()).detections
        } catch {
          lastDetections = []
        }
      }

      draw(ctx, dpr, video, lastDetections)

      const alertCfg = faceAlertRef.current
      if (
        alertCfg?.enabled &&
        lastTrackedCountRef.current > 0 &&
        alertCfg.roomId &&
        alertCfg.token
      ) {
        const now = Date.now()
        if (now - lastClientAlertAtRef.current >= CLIENT_FACE_ALERT_DEBOUNCE_MS) {
          lastClientAlertAtRef.current = now
          void postFaceAlert(alertCfg.roomId, alertCfg.token)
        }
      }
    }

    void (async () => {
      try {
        detector = await createDetector()
      } catch {
        detector = null
      }
      if (cancelled || !detector) {
        detector?.close()
        return
      }
      raf = requestAnimationFrame(loop)
    })()

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resizeCanvas()) : null
    const v = videoRef.current
    if (v && ro) {
      ro.observe(v)
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      detector?.close()
      detector = null
    }
  }, [active, videoRef])

  return <canvas ref={canvasRef} className="video-face-overlay-canvas" aria-hidden />
}
