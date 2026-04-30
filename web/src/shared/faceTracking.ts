import type { BoundingBox, Detection } from '@mediapipe/tasks-vision'

type InternalTrack = {
  id: number
  smoothBox: BoundingBox
  /** 归一化中心，用于移动活体 */
  centers: { nx: number; ny: number }[]
}

export type TrackedFace = {
  id: number
  box: BoundingBox
  /** 基于人脸框中心位移：能区分长时间静止画面与真人微动；非金融级活体 */
  motionLive: boolean
}

export type FaceTrackerState = {
  nextId: number
  tracks: InternalTrack[]
}

export function createFaceTrackerState(): FaceTrackerState {
  return { nextId: 1, tracks: [] }
}

function smoothBox(prev: BoundingBox, raw: BoundingBox, alpha: number): BoundingBox {
  return {
    originX: alpha * raw.originX + (1 - alpha) * prev.originX,
    originY: alpha * raw.originY + (1 - alpha) * prev.originY,
    width: alpha * raw.width + (1 - alpha) * prev.width,
    height: alpha * raw.height + (1 - alpha) * prev.height,
    angle: raw.angle
  }
}

function motionLiveFromCenters(centers: { nx: number; ny: number }[], vw: number, vh: number): boolean {
  const slice = centers.slice(-28)
  if (slice.length < 10) {
    return false
  }
  let sum = 0
  for (let i = 1; i < slice.length; i++) {
    sum += Math.hypot((slice[i].nx - slice[i - 1].nx) * vw, (slice[i].ny - slice[i - 1].ny) * vh)
  }
  const threshold = Math.max(14, 0.02 * Math.min(vw, vh))
  return sum > threshold
}

/**
 * 将当前帧检测结果与上一帧轨迹关联，平滑框体并计算移动活体。
 */
export function stepFaceTracks(
  detections: Detection[],
  vw: number,
  vh: number,
  state: FaceTrackerState
): TrackedFace[] {
  const rawBoxes: BoundingBox[] = []
  for (const d of detections) {
    const b = d.boundingBox
    if (b && b.width > 1 && b.height > 1) {
      rawBoxes.push({ ...b, angle: b.angle ?? 0 })
    }
  }

  const prevTracks = state.tracks
  const matchedPrev = new Set<number>()
  const nextTracks: InternalTrack[] = []

  for (const box of rawBoxes) {
    const cx = box.originX + box.width / 2
    const cy = box.originY + box.height / 2
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < prevTracks.length; i++) {
      if (matchedPrev.has(i)) {
        continue
      }
      const p = prevTracks[i].smoothBox
      const tcx = p.originX + p.width / 2
      const tcy = p.originY + p.height / 2
      const dist = Math.hypot(cx - tcx, cy - tcy)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }

    const matchGate = Math.max(box.width, box.height) * 0.55

    if (bestIdx >= 0 && bestDist < matchGate) {
      matchedPrev.add(bestIdx)
      const prev = prevTracks[bestIdx]
      const alpha = 0.42
      const smooth = smoothBox(prev.smoothBox, box, alpha)
      const centers = [...prev.centers, { nx: cx / vw, ny: cy / vh }].slice(-36)
      nextTracks.push({
        id: prev.id,
        smoothBox: smooth,
        centers
      })
    } else {
      nextTracks.push({
        id: state.nextId++,
        smoothBox: { ...box },
        centers: [{ nx: cx / vw, ny: cy / vh }]
      })
    }
  }

  state.tracks = nextTracks

  return nextTracks.map((t) => ({
    id: t.id,
    box: t.smoothBox,
    motionLive: motionLiveFromCenters(t.centers, vw, vh)
  }))
}
