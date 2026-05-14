import { lazy } from 'react'

/**
 * 按需加载：`faceAnalysisOverlay` 连带 face-api.js、@mediapipe/tasks-vision 等进入单独 chunk，
 * 仅采集端开启抓拍/告警或观看端开启「陌生人检测」时触发 fetch。
 */
export const FaceAnalysisOverlayLazy = lazy(() =>
  import('./faceAnalysisOverlay').then((m) => ({ default: m.FaceAnalysisOverlay }))
)
