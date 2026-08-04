import path from 'node:path'
import { config } from '../config.js'
import { DATA_DIR } from './dir.js'
import { createMutationQueue, readTextFileIfExists, writeJsonAtomic } from './fileStore.js'

/** 持久化字段；旧数据可能仅有 enabled */
type StoredRoomPolicy = {
  enabled: boolean
  strangerFaceAlert?: boolean
  /** 该房间允许同时在线的观看端数量（不含采集端） */
  maxViewersPerRoom?: number
}

type Payload = {
  version: 1
  rooms: Record<string, StoredRoomPolicy>
}

export type RoomPolicyPublic = {
  enabled: boolean
  strangerFaceAlert: boolean
  maxViewersPerRoom: number
}

function clampMaxViewers(n: number): number {
  return Math.max(1, Math.min(99, Math.floor(Number.isFinite(n) ? n : 1)))
}

function parseStoredMaxViewers(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampMaxViewers(raw)
  }
  if (typeof raw === 'string' && raw.trim()) {
    const x = Number.parseInt(raw, 10)
    if (Number.isFinite(x)) {
      return clampMaxViewers(x)
    }
  }
  return undefined
}

const FILE = path.join(DATA_DIR, 'room-policies.json')
const enqueueMutation = createMutationQueue()

async function readPayload(): Promise<Payload> {
  const raw = await readTextFileIfExists(FILE)
  if (raw === null) {
    return { version: 1, rooms: {} }
  }

  const data = JSON.parse(raw) as Payload
  if (data.version !== 1 || typeof data.rooms !== 'object' || !data.rooms) {
    throw new Error('room-policies.json has an invalid shape')
  }
  return data
}

async function writePayload(data: Payload): Promise<void> {
  await writeJsonAtomic(FILE, data)
}

function normalize(raw: StoredRoomPolicy | undefined): RoomPolicyPublic | null {
  if (!raw || typeof raw.enabled !== 'boolean') {
    return null
  }
  const maxViewersPerRoom =
    parseStoredMaxViewers(raw.maxViewersPerRoom) ?? clampMaxViewers(config.maxViewersPerRoom)
  return {
    enabled: raw.enabled === true,
    strangerFaceAlert: raw.strangerFaceAlert === true,
    maxViewersPerRoom
  }
}

export type RoomJoinCheck =
  | { ok: true }
  | { ok: false; reason: 'room_missing' | 'room_closed' }

/** room_missing：后台未登记该房间；room_closed：已登记但未开放（enabled !== true） */
export async function checkRoomJoin(roomId: string): Promise<RoomJoinCheck> {
  const data = await readPayload()
  const policy = data.rooms[roomId]
  if (!policy) {
    return { ok: false, reason: 'room_missing' }
  }
  if (policy.enabled !== true) {
    return { ok: false, reason: 'room_closed' }
  }
  return { ok: true }
}

export async function isRoomJoinAllowed(roomId: string): Promise<boolean> {
  const r = await checkRoomJoin(roomId)
  return r.ok
}

export async function listRoomPolicies(): Promise<Record<string, RoomPolicyPublic>> {
  const data = await readPayload()
  const out: Record<string, RoomPolicyPublic> = {}
  for (const [id, r] of Object.entries(data.rooms)) {
    const n = normalize(r)
    if (n) {
      out[id] = n
    }
  }
  return out
}

/** 房间不存在时返回 null */
export async function getRoomPolicy(roomId: string): Promise<RoomPolicyPublic | null> {
  const data = await readPayload()
  return normalize(data.rooms[roomId])
}

/** 合并更新策略字段（可新建房间条目） */
export async function patchRoomPolicy(
  roomId: string,
  patch: Partial<{ enabled: boolean; strangerFaceAlert: boolean; maxViewersPerRoom: number }>
): Promise<RoomPolicyPublic> {
  return enqueueMutation(async () => {
    const data = await readPayload()
    const prev =
      normalize(data.rooms[roomId]) ?? {
        enabled: false,
        strangerFaceAlert: false,
        maxViewersPerRoom: clampMaxViewers(config.maxViewersPerRoom)
      }
    const next: RoomPolicyPublic = {
      enabled: patch.enabled !== undefined ? patch.enabled : prev.enabled,
      strangerFaceAlert:
        patch.strangerFaceAlert !== undefined ? patch.strangerFaceAlert : prev.strangerFaceAlert,
      maxViewersPerRoom:
        patch.maxViewersPerRoom !== undefined
          ? clampMaxViewers(patch.maxViewersPerRoom)
          : prev.maxViewersPerRoom
    }
    data.rooms[roomId] = {
      enabled: next.enabled,
      strangerFaceAlert: next.strangerFaceAlert,
      maxViewersPerRoom: next.maxViewersPerRoom
    }
    await writePayload(data)
    return next
  })
}

/** 删除房间策略；不存在则返回 false */
export async function removeRoomPolicy(roomId: string): Promise<boolean> {
  return enqueueMutation(async () => {
    const data = await readPayload()
    if (!Object.prototype.hasOwnProperty.call(data.rooms, roomId)) {
      return false
    }
    delete data.rooms[roomId]
    await writePayload(data)
    return true
  })
}
