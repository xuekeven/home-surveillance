import * as faceapi from 'face-api.js'

/**
 * face-api.js 的 npm 包不含 weights，不要用 `/npm/face-api.js@x/weights/`（会 404）。
 * 权重在 GitHub 仓库；用 jsDelivr 的 gh 代理与库版本对齐。
 * 自建：把 weights 拷到 `web/public/face-api-weights/`，并设置环境变量
 * `VITE_FACE_API_MODEL_BASE=/face-api-weights`（随 `base` 拼接，勿末尾斜杠多余）。
 */
function resolveFaceApiModelBase(): string {
  const raw = import.meta.env.VITE_FACE_API_MODEL_BASE
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/\/$/, '')
    if (t) {
      return t
    }
  }
  return 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights'
}

let loading: Promise<void> | null = null

/** 加载 SSD + 关键点 + 人脸识别模型（从 CDN 或 VITE_FACE_API_MODEL_BASE 拉权重） */
export async function ensureFaceApiModels(): Promise<void> {
  if (loading) {
    return loading
  }
  const MODEL_BASE = resolveFaceApiModelBase()
  loading = (async () => {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE)
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE)
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE)
  })()
  try {
    await loading
  } catch {
    loading = null
    throw new Error('家庭成员识别模型加载失败，请检查网络（模型 CDN）或稍后重试')
  }
}

export { faceapi }
