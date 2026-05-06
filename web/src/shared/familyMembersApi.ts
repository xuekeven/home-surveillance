import { apiFamilyMembersUrl, apiRoomPolicyUrl, appConfig } from '../config'
import type { StoredFamilyMember } from './familyMemberTypes'

function apiAdminRoot(): string {
  const p = appConfig.publicBasePath
  return p ? `${p}/api/admin` : '/api/admin'
}

export function apiAdminFamilyMembersUrl(): string {
  return `${apiAdminRoot()}/family-members`
}

export function apiAdminRoomsUrl(): string {
  return `${apiAdminRoot()}/rooms`
}

export function apiAdminRoomUrl(roomId: string): string {
  return `${apiAdminRoot()}/rooms/${encodeURIComponent(roomId)}`
}

function adminFailureMessage(status: number, bodyText: string): string {
  let code: string | undefined
  try {
    const j = JSON.parse(bodyText) as { error?: string }
    code = typeof j.error === 'string' ? j.error : undefined
  } catch {
    /* ignore */
  }
  if (code === 'admin_unauthorized') {
    return '管理员密钥不正确：须与服务器环境变量 ADMIN_TOKEN 完全一致（不要用 ROOM_TOKEN）。请退出后重新登录。'
  }
  if (code === 'admin_not_configured') {
    return '服务器未配置 ADMIN_TOKEN，请在进程环境中设置后重启服务。'
  }
  const trimmed = bodyText.trim().slice(0, 200)
  return trimmed || `请求失败（HTTP ${status}）`
}

export async function fetchFamilyMembersForRoom(roomToken: string): Promise<StoredFamilyMember[]> {
  const res = await fetch(apiFamilyMembersUrl(), {
    headers: { Authorization: `Bearer ${roomToken}` }
  })
  if (!res.ok) {
    throw new Error(`family-members ${res.status}`)
  }
  const data = (await res.json()) as { members?: StoredFamilyMember[] }
  return Array.isArray(data.members) ? data.members : []
}

export async function adminFetchFamily(adminToken: string): Promise<StoredFamilyMember[]> {
  const res = await fetch(apiAdminFamilyMembersUrl(), {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
  const data = (await res.json()) as { members?: StoredFamilyMember[] }
  return Array.isArray(data.members) ? data.members : []
}

export async function adminAddFamilyMember(
  adminToken: string,
  payload: { label: string; descriptor: number[]; photoDataUrl: string }
): Promise<void> {
  const res = await fetch(apiAdminFamilyMembersUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
}

export async function adminUpdateFamilyMember(
  adminToken: string,
  id: string,
  payload: { label?: string; descriptor?: number[]; photoDataUrl?: string }
): Promise<void> {
  const res = await fetch(`${apiAdminFamilyMembersUrl()}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
}

export async function adminDeleteFamilyMember(adminToken: string, id: string): Promise<void> {
  const res = await fetch(`${apiAdminFamilyMembersUrl()}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
}

export type RoomPolicyClient = {
  enabled: boolean
  strangerFaceAlert: boolean
  maxViewersPerRoom: number
}

export async function adminFetchRooms(adminToken: string): Promise<Record<string, RoomPolicyClient>> {
  const res = await fetch(apiAdminRoomsUrl(), {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
  const data = (await res.json()) as { rooms?: Record<string, RoomPolicyClient> }
  return data.rooms && typeof data.rooms === 'object' ? data.rooms : {}
}

export async function adminPatchRoom(
  adminToken: string,
  roomId: string,
  patch: { enabled?: boolean; strangerFaceAlert?: boolean; maxViewersPerRoom?: number }
): Promise<void> {
  const res = await fetch(apiAdminRoomUrl(roomId), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(patch)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
}

/** 采集端/观看端：当前房间是否在后台开启了陌生人脸告警 */
export async function fetchRoomStrangerAlertEnabled(roomToken: string, roomId: string): Promise<boolean> {
  const res = await fetch(apiRoomPolicyUrl(roomId), {
    headers: { Authorization: `Bearer ${roomToken}` }
  })
  if (!res.ok) {
    return false
  }
  const data = (await res.json()) as { strangerFaceAlert?: boolean }
  return data.strangerFaceAlert === true
}

export async function adminDeleteRoom(adminToken: string, roomId: string): Promise<void> {
  const res = await fetch(apiAdminRoomUrl(roomId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(adminFailureMessage(res.status, text))
  }
}
