import { FaceDetector, FilesetResolver, type Detection } from '@mediapipe/tasks-vision'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { faceapi, ensureFaceApiModels } from './faceApiModels'
import type { StoredFamilyMember } from './familyMemberTypes'
import {
  intersectionOverUnion,
  matchFamilyMember,
  MIN_FACE_DETECTOR_IOU
} from './faceRecognitionCompare'
import { postFaceAlert } from './faceAlertApi'
import { compositeVideoFrameWithOverlay, postStrangerScreenshots } from './strangerSnapshot'
import { createFaceTrackerState, stepFaceTracks, type FaceTrackerState, type TrackedFace } from './faceTracking'

const CLIENT_FACE_ALERT_DEBOUNCE_MS = 60_000
const STRANGER_SCREENSHOT_DEBOUNCE_MS = 60_000
const FACE_API_CLASSIFY_INTERVAL_FRAMES = 14

const MEDIAPIPE_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const BLAZE_FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite'

function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

function isLikelyRestrictedWebView(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent
  return /MicroMessenger|QQ\//i.test(ua)
}

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
  const cpuOpts = {
    baseOptions: {
      modelAssetPath: BLAZE_FACE_MODEL,
      delegate: 'CPU' as const
    },
    runningMode: 'VIDEO' as const,
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.35
  }

  if (isLikelyMobile() || isLikelyRestrictedWebView()) {
    return FaceDetector.createFromOptions(wasm, cpuOpts)
  }

  try {
    return await FaceDetector.createFromOptions(wasm, {
      ...cpuOpts,
      baseOptions: { ...cpuOpts.baseOptions, delegate: 'GPU' }
    })
  } catch {
    return FaceDetector.createFromOptions(wasm, cpuOpts)
  }
}

type TrackFaceIdentity = { kind: 'family'; memberLabel: string } | { kind: 'stranger' }

function shouldSendFaceAlert(
  tracked: TrackedFace[],
  familyMembers: StoredFamilyMember[],
  identities: Map<number, TrackFaceIdentity>
): boolean {
  if (tracked.length === 0) {
    return false
  }
  if (familyMembers.length === 0) {
    return true
  }
  return tracked.some((t) => identities.get(t.id)?.kind === 'stranger')
}

/** 当前帧中计入告警的人脸数（均已 motionLive）：无家庭成员登记时按全部确认人脸；有登记时仅统计陌生人轨 */
function countStrangerFacesForAlert(
  tracked: TrackedFace[],
  familyMembers: StoredFamilyMember[],
  identities: Map<number, TrackFaceIdentity>
): number {
  if (tracked.length === 0) {
    return 0
  }
  if (familyMembers.length === 0) {
    return tracked.length
  }
  return tracked.filter((t) => identities.get(t.id)?.kind === 'stranger').length
}

type FaceAlertNotifyConfig = {
  roomId: string
  token: string
  enabled: boolean
}

type FaceAnalysisOverlayProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  active: boolean
  faceAlert?: FaceAlertNotifyConfig
  /** 家庭成员描述向量；非空时仅「陌生人」在开启上报且后台允许时触发 faceAlert */
  familyMembers?: StoredFamilyMember[]
}

/**
 * MediaPipe 检出人脸框后，仅当轨迹判定为「移动活体」(motionLive) 时才视为「人脸」：
 * 画框、face-api 比对、陌生人告警均只针对这类轨迹；静止照片等一般在未位移阶段不会出现确认框。
 */
export function FaceAnalysisOverlay({
  videoRef,
  active,
  faceAlert,
  familyMembers = []
}: FaceAnalysisOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackerRef = useRef<FaceTrackerState>(createFaceTrackerState())
  const faceAlertRef = useRef(faceAlert)
  faceAlertRef.current = faceAlert

  const familyMembersRef = useRef(familyMembers)
  familyMembersRef.current = familyMembers

  const lastTrackedCountRef = useRef(0)
  const lastTrackedListRef = useRef<TrackedFace[]>([])
  const lastClientAlertAtRef = useRef(0)
  const lastStrangerScreenshotAtRef = useRef(0)
  const trackIdentityRef = useRef<Map<number, TrackFaceIdentity>>(new Map())

  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) {
      setInitError(null)
      trackIdentityRef.current.clear()
      lastStrangerScreenshotAtRef.current = 0
      const c = canvasRef.current
      const ctx = c?.getContext('2d')
      if (c && ctx) {
        ctx.clearRect(0, 0, c.width, c.height)
      }
      return
    }

    trackerRef.current = createFaceTrackerState()
    trackIdentityRef.current = new Map()

    let cancelled = false
    let detector: FaceDetector | null = null
    let raf = 0
    let lastDetections: Detection[] = []
    let frameTick = 0
    let classifyBusy = false

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

    const draw = (ctx: CanvasRenderingContext2D, dpr: number, video: HTMLVideoElement, confirmedFaces: TrackedFace[]) => {
      const cw = video.clientWidth
      const ch = video.clientHeight
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)

      const vw = video.videoWidth
      const vh = video.videoHeight
      const rect = videoContentRect(video)
      if (!rect || !vw || !vh) {
        lastTrackedCountRef.current = 0
        lastTrackedListRef.current = []
        return
      }

      lastTrackedCountRef.current = confirmedFaces.length
      lastTrackedListRef.current = confirmedFaces

      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.lineWidth = 3

      const membersNonEmpty = familyMembersRef.current.length > 0
      const identities = trackIdentityRef.current

      const strangersForRank = confirmedFaces.filter((f) => {
        if (!membersNonEmpty) {
          return true
        }
        return identities.get(f.id)?.kind === 'stranger'
      })
      const strangerRank = new Map<number, number>(
        [...strangersForRank].sort((a, b) => a.id - b.id).map((f, i) => [f.id, i + 1])
      )

      for (const face of confirmedFaces) {
        const ident = identities.get(face.id)
        let stroke: string
        let text: string
        if (!membersNonEmpty) {
          stroke = '#d97676'
          text = `陌生人${strangerRank.get(face.id) ?? 1}`
        } else if (!ident) {
          stroke = '#c9b038'
          text = '识别中…'
        } else if (ident.kind === 'family') {
          stroke = '#5cb894'
          text = `家庭成员 · ${ident.memberLabel.trim()}`
        } else {
          stroke = '#d97676'
          text = `陌生人${strangerRank.get(face.id) ?? 1}`
        }

        ctx.strokeStyle = stroke
        const { x, y, w, h } = mapBoxToOverlay(face.box, rect, vw, vh)
        ctx.strokeRect(x, y, w, h)

        const padX = 8
        const tw = ctx.measureText(text).width
        const boxH = 22
        const lx = x
        const ly = Math.max(0, y - boxH - 4)

        ctx.fillStyle = 'rgba(44, 63, 54, 0.78)'
        ctx.fillRect(lx, ly, tw + padX * 2, boxH)

        ctx.fillStyle = '#e8f8f0'
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

      if (familyMembersRef.current.length === 0) {
        trackIdentityRef.current.clear()
      }

      resizeCanvas()
      const ctx = canvas.getContext('2d')
      if (!ctx || !detector) {
        return
      }

      const vw = video.videoWidth
      const vh = video.videoHeight

      const dpr = canvas.width / Math.max(1, video.clientWidth)

      frameTick++
      if (frameTick % 2 === 0) {
        try {
          lastDetections = detector.detectForVideo(video, performance.now()).detections
        } catch {
          lastDetections = []
        }
      }

      let tracked: TrackedFace[] = []
      if (vw > 0 && vh > 0) {
        tracked = stepFaceTracks(lastDetections, vw, vh, trackerRef.current)
      }

      const confirmedFaces = tracked.filter((t) => t.motionLive)

      const activeIds = new Set(tracked.map((t) => t.id))
      for (const key of [...trackIdentityRef.current.keys()]) {
        if (!activeIds.has(key)) {
          trackIdentityRef.current.delete(key)
        }
      }
      for (const t of tracked) {
        if (!t.motionLive) {
          trackIdentityRef.current.delete(t.id)
        }
      }

      draw(ctx, dpr, video, confirmedFaces)

      const members = familyMembersRef.current
      if (
        members.length > 0 &&
        confirmedFaces.length > 0 &&
        frameTick % FACE_API_CLASSIFY_INTERVAL_FRAMES === 0 &&
        !classifyBusy
      ) {
        classifyBusy = true
        const snapshot = [...confirmedFaces]
        void (async () => {
          try {
            await ensureFaceApiModels()
            if (cancelled) {
              return
            }
            const results = await faceapi
              .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
              .withFaceLandmarks()
              .withFaceDescriptors()

            for (const t of snapshot) {
              const mpBox = {
                x: t.box.originX,
                y: t.box.originY,
                width: t.box.width,
                height: t.box.height
              }
              let bestIou = 0
              let bestDesc: Float32Array | null = null
              for (const r of results) {
                const b = r.detection.box
                const faBox = { x: b.x, y: b.y, width: b.width, height: b.height }
                const iou = intersectionOverUnion(mpBox, faBox)
                if (iou > bestIou) {
                  bestIou = iou
                  bestDesc = r.descriptor
                }
              }
              if (bestIou < MIN_FACE_DETECTOR_IOU || !bestDesc) {
                trackIdentityRef.current.set(t.id, { kind: 'stranger' })
              } else {
                const matched = matchFamilyMember(bestDesc, members)
                trackIdentityRef.current.set(
                  t.id,
                  matched ? { kind: 'family', memberLabel: matched.label } : { kind: 'stranger' }
                )
              }
            }
          } catch (err) {
            console.warn('[FaceAnalysisOverlay] face-api classify:', err)
          } finally {
            classifyBusy = false
          }
        })()
      }

      const alertCfg = faceAlertRef.current
      const identities = trackIdentityRef.current
      if (
        alertCfg?.enabled &&
        alertCfg.roomId &&
        alertCfg.token &&
        shouldSendFaceAlert(confirmedFaces, members, identities)
      ) {
        const strangerCount = Math.max(1, countStrangerFacesForAlert(confirmedFaces, members, identities))
        const now = Date.now()
        if (now - lastClientAlertAtRef.current >= CLIENT_FACE_ALERT_DEBOUNCE_MS) {
          lastClientAlertAtRef.current = now
          void postFaceAlert(alertCfg.roomId, alertCfg.token, strangerCount)
        }
      }

      const strangerSnapCount =
        confirmedFaces.length === 0
          ? 0
          : confirmedFaces.filter((f) => {
              if (members.length === 0) {
                return true
              }
              return identities.get(f.id)?.kind === 'stranger'
            }).length

      const snapCfg = faceAlertRef.current
      const snapNow = Date.now()
      if (
        strangerSnapCount > 0 &&
        snapCfg?.roomId &&
        snapCfg?.token &&
        snapNow - lastStrangerScreenshotAtRef.current >= STRANGER_SCREENSHOT_DEBOUNCE_MS
      ) {
        const dataUrl = compositeVideoFrameWithOverlay(video, canvas)
        if (dataUrl) {
          lastStrangerScreenshotAtRef.current = snapNow
          void postStrangerScreenshots({
            roomId: snapCfg.roomId,
            token: snapCfg.token,
            imageDataUrl: dataUrl,
            strangerCount: strangerSnapCount
          })
        }
      }
    }

    const startLoop = () => {
      if (!cancelled && detector) {
        setInitError(null)
        raf = requestAnimationFrame(loop)
      }
    }

    void (async () => {
      setInitError(null)
      try {
        detector = await createDetector()
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.warn('[FaceAnalysisOverlay] init failed:', detail)
        if (!cancelled) {
          setInitError(
            '人脸检测引擎加载失败。手机常见原因：① 网络无法访问模型地址（Google Storage）或 WASM（jsDelivr）；② 微信等内置浏览器限制 WebAssembly。请用系统 Safari/Chrome 打开本站，或换网络/Wi‑Fi 重试。'
          )
        }
        detector = null
      }

      if (cancelled) {
        detector?.close()
        return
      }

      if (!detector) {
        return
      }

      startLoop()
    })()

    const videoEl = videoRef.current
    const onVideoReady = () => {
      if (!cancelled && detector) {
        resizeCanvas()
      }
    }
    videoEl?.addEventListener('loadedmetadata', onVideoReady)

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resizeCanvas()) : null
    const v = videoRef.current
    if (v && ro) {
      ro.observe(v)
    }

    return () => {
      cancelled = true
      videoEl?.removeEventListener('loadedmetadata', onVideoReady)
      cancelAnimationFrame(raf)
      ro?.disconnect()
      detector?.close()
      detector = null
    }
  }, [active, videoRef])

  return (
    <>
      <canvas ref={canvasRef} className="video-face-overlay-canvas" aria-hidden />
      {initError ? (
        <div className="face-engine-hint" role="status">
          {initError}
        </div>
      ) : null}
    </>
  )
}
