import type { StoredFamilyMember } from './familyMemberTypes'

/** 欧氏距离阈值：越小越严格（光照/角度会影响，家用可略放宽） */
export const DEFAULT_FAMILY_DISTANCE_THRESHOLD = 0.48

/** MediaPipe 框与 face-api 框的最小 IoU，低于则认为未对齐 */
export const MIN_FACE_DETECTOR_IOU = 0.12

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

export function nearestFamilyDistance(descriptor: Float32Array, members: StoredFamilyMember[]): number {
  if (members.length === 0) {
    return Infinity
  }
  let min = Infinity
  for (const m of members) {
    const d = euclideanDistance(descriptor, new Float32Array(m.descriptor))
    if (d < min) {
      min = d
    }
  }
  return min
}

/** 返回距离最近的登记成员；距离不小于阈值时视为不匹配 */
export function matchFamilyMember(
  descriptor: Float32Array,
  members: StoredFamilyMember[],
  threshold = DEFAULT_FAMILY_DISTANCE_THRESHOLD
): StoredFamilyMember | null {
  if (members.length === 0) {
    return null
  }
  let best: StoredFamilyMember | null = null
  let bestD = Infinity
  for (const m of members) {
    const d = euclideanDistance(descriptor, new Float32Array(m.descriptor))
    if (d < bestD) {
      bestD = d
      best = m
    }
  }
  return best !== null && bestD < threshold ? best : null
}

export function isDescriptorMatchingFamily(
  descriptor: Float32Array,
  members: StoredFamilyMember[],
  threshold = DEFAULT_FAMILY_DISTANCE_THRESHOLD
): boolean {
  return matchFamilyMember(descriptor, members, threshold) !== null
}

export function intersectionOverUnion(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const iw = Math.max(0, x2 - x1)
  const ih = Math.max(0, y2 - y1)
  const inter = iw * ih
  const union = a.width * a.height + b.width * b.height - inter + 1e-9
  return inter / union
}
