/**
 * face-api 68 点（与 iBUG / dlib 顺序一致）下的粗略「正对镜头」判定，
 * 用于跳过侧脸、抬头、低头时的比对与陌生人告警（家用几何阈值，非绝对精确）。
 *
 * 默认偏宽松：若仍易被误判为非正面，可再略增大 YAW、拓宽 NOSE_RATIO 区间；
 * 若侧脸仍被判成正面，则反向收紧。
 */
export const FRONTAL_MAX_YAW_RATIO = 0.38
export const FRONTAL_NOSE_RATIO_MIN = 0.28
export const FRONTAL_NOSE_RATIO_MAX = 0.88

function eyeCentroid(
  positions: ReadonlyArray<{ x: number; y: number }>,
  startIdx: number
): { x: number; y: number } {
  let sx = 0
  let sy = 0
  for (let i = 0; i < 6; i++) {
    const p = positions[startIdx + i]
    sx += p.x
    sy += p.y
  }
  return { x: sx / 6, y: sy / 6 }
}

/** `positions.length` 须 ≥ 68（FaceLandmarks68.positions） */
export function isRoughlyFrontalFaceLandmarks(
  positions: ReadonlyArray<{ x: number; y: number }>
): boolean {
  if (positions.length < 68) {
    return false
  }

  const rightEye = eyeCentroid(positions, 36)
  const leftEye = eyeCentroid(positions, 42)
  const noseTip = positions[30]
  const chin = positions[8]

  const midEyeY = (leftEye.y + rightEye.y) / 2
  const io = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y)
  if (io < 8) {
    return false
  }

  const midEyeX = (leftEye.x + rightEye.x) / 2
  const yawRatio = Math.abs(noseTip.x - midEyeX) / io
  if (yawRatio > FRONTAL_MAX_YAW_RATIO) {
    return false
  }

  const chinSpan = chin.y - midEyeY
  if (chinSpan < io * 0.28) {
    return false
  }

  const noseRatio = (noseTip.y - midEyeY) / chinSpan
  return noseRatio >= FRONTAL_NOSE_RATIO_MIN && noseRatio <= FRONTAL_NOSE_RATIO_MAX
}
