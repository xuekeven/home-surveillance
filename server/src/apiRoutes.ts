import type { Express, NextFunction, Request, Response } from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import {
  addFamilyMember,
  listFamilyMembers,
  removeFamilyMember,
  updateFamilyMember,
  type FamilyMemberRecord
} from './persist/familyMembersRepo.js'
import { STRANGER_IMAGES_DIR } from './persist/dir.js'
import { isRoomJoinAllowed, listRoomPolicies, removeRoomPolicy, getRoomPolicy, patchRoomPolicy } from './persist/roomPoliciesRepo.js'
import { isValidRoomId } from './rooms.js'
import { formatStrangerSnapshotBaseLabel } from './strangerSnapshotLabel.js'
import { dispatchFaceAlert } from './weworkFaceAlert.js'

export function requireRoomToken(request: Request, response: Response, next: NextFunction): void {
  const auth = request.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (token !== config.roomToken) {
    response.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (!config.adminToken) {
    response.status(503).json({ error: 'admin_not_configured' })
    return
  }
  const auth = request.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (token !== config.adminToken) {
    response.status(401).json({ error: 'admin_unauthorized' })
    return
  }
  next()
}

const MAX_FAMILY_PHOTO_DATA_URL_CHARS = 750_000
/** 陌生人整帧截图 body 上限（base64 字符串） */
const MAX_STRANGER_SNAPSHOT_DATA_URL_CHARS = 14 * 1024 * 1024

function decodeSnapshotDataUrl(dataUrl: string): { buffer: Buffer; ext: 'png' } | null {
  const trimmed = dataUrl.trim()
  const png = /^data:image\/png;base64,(.+)$/i.exec(trimmed)
  if (!png || png[1].length > MAX_STRANGER_SNAPSHOT_DATA_URL_CHARS) {
    return null
  }
  try {
    const buffer = Buffer.from(png[1], 'base64')
    if (buffer.length < 80 || buffer.length > 12 * 1024 * 1024) {
      return null
    }
    return { buffer, ext: 'png' }
  } catch {
    return null
  }
}

function isValidDescriptor(raw: unknown): raw is number[] {
  if (!Array.isArray(raw) || raw.length < 64 || raw.length > 2048) {
    return false
  }
  return raw.every((x) => typeof x === 'number' && Number.isFinite(x))
}

function isValidPhotoDataUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') {
    return false
  }
  if (raw.length < 30 || raw.length > MAX_FAMILY_PHOTO_DATA_URL_CHARS) {
    return false
  }
  return raw.startsWith('data:image/')
}

export function mountApi(app: Express, apiPrefix: string): void {
  app.get(`${apiPrefix}/ice-servers`, (_request, response) => {
    response.json({ iceServers: config.iceServers })
  })

  app.get(`${apiPrefix}/family-members`, requireRoomToken, async (_request, response) => {
    try {
      const members = await listFamilyMembers()
      response.json({ members })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read_failed'
      response.status(500).json({ error: 'family_members_read_failed', message })
    }
  })

  app.post(`${apiPrefix}/wework/face-alert`, async (request, response) => {
    const rawRoomId = request.body?.roomId
    const rawToken = request.body?.token
    const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : ''
    const token = typeof rawToken === 'string' ? rawToken : ''

    if (!roomId || roomId.length > 160 || /[<>"']/.test(roomId)) {
      response.status(400).json({ error: 'invalid_room_id' })
      return
    }

    if (token !== config.roomToken) {
      response.status(401).json({ error: 'unauthorized' })
      return
    }

    try {
      const allowed = await isRoomJoinAllowed(roomId)
      if (!allowed) {
        response.status(403).json({ ok: false, skipped: true, reason: 'room_disabled' })
        return
      }

      const roomPolicy = await getRoomPolicy(roomId)
      if (!roomPolicy?.strangerFaceAlert) {
        response.json({ ok: false, skipped: true, reason: 'stranger_alert_disabled' })
        return
      }

      const rawCount = request.body?.strangerCount
      let strangerCount = 1
      if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
        strangerCount = Math.max(1, Math.min(99, Math.floor(rawCount)))
      }

      const result = await dispatchFaceAlert(roomId, strangerCount)
      response.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'relay_error'
      response.status(502).json({ error: 'relay_failed', message })
    }
  })

  app.post(`${apiPrefix}/stranger-screenshots`, requireRoomToken, async (request, response) => {
    const rawRoomId = request.body?.roomId
    const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : ''

    if (!isValidRoomId(roomId)) {
      response.status(400).json({ error: 'invalid_room_id' })
      return
    }

    try {
      const allowed = await isRoomJoinAllowed(roomId)
      if (!allowed) {
        response.status(403).json({ error: 'room_disabled' })
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'policy_read_failed'
      response.status(500).json({ error: 'room_policy_failed', message })
      return
    }

    const imageDataUrl = request.body?.imageDataUrl
    if (
      typeof imageDataUrl !== 'string' ||
      imageDataUrl.length > MAX_STRANGER_SNAPSHOT_DATA_URL_CHARS
    ) {
      response.status(400).json({ error: 'invalid_image' })
      return
    }

    const decoded = decodeSnapshotDataUrl(imageDataUrl)
    if (!decoded) {
      response.status(400).json({ error: 'invalid_image_data_url' })
      return
    }

    let strangerCount = 1
    const rawCount = request.body?.strangerCount
    if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
      strangerCount = Math.max(1, Math.min(99, Math.floor(rawCount)))
    }

    const baseLabel = formatStrangerSnapshotBaseLabel()

    try {
      for (let r = 1; r <= strangerCount; r++) {
        const filename = `${baseLabel}陌生人${r}.${decoded.ext}`
        await fs.writeFile(path.join(STRANGER_IMAGES_DIR, filename), decoded.buffer)
      }
      response.json({ ok: true, saved: strangerCount })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'write_failed'
      response.status(500).json({ error: 'stranger_screenshot_write_failed', message })
    }
  })

  app.get(`${apiPrefix}/admin/family-members`, requireAdmin, async (_request, response) => {
    try {
      const members = await listFamilyMembers()
      response.json({ members })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read_failed'
      response.status(500).json({ error: 'family_members_read_failed', message })
    }
  })

  app.post(`${apiPrefix}/admin/family-members`, requireAdmin, async (request, response) => {
    const labelRaw = request.body?.label
    const descriptorRaw = request.body?.descriptor
    const photoRaw = request.body?.photoDataUrl
    const label = typeof labelRaw === 'string' ? labelRaw.trim().slice(0, 120) : ''
    if (!label || !isValidDescriptor(descriptorRaw) || !isValidPhotoDataUrl(photoRaw)) {
      response.status(400).json({ error: 'invalid_payload' })
      return
    }

    const member: FamilyMemberRecord = {
      id: crypto.randomUUID(),
      label,
      descriptor: descriptorRaw,
      photoDataUrl: photoRaw
    }

    try {
      await addFamilyMember(member)
      response.status(201).json({ member })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'write_failed'
      response.status(500).json({ error: 'family_members_write_failed', message })
    }
  })

  app.patch(`${apiPrefix}/admin/family-members/:id`, requireAdmin, async (request, response) => {
    const id = typeof request.params.id === 'string' ? request.params.id.trim() : ''
    if (!id || id.length > 80) {
      response.status(400).json({ error: 'invalid_id' })
      return
    }

    const labelRaw = request.body?.label
    const descriptorRaw = request.body?.descriptor
    const photoRaw = request.body?.photoDataUrl

    const patch: { label?: string; descriptor?: number[]; photoDataUrl?: string } = {}

    if (labelRaw !== undefined) {
      const label = typeof labelRaw === 'string' ? labelRaw.trim().slice(0, 120) : ''
      if (!label) {
        response.status(400).json({ error: 'invalid_label' })
        return
      }
      patch.label = label
    }

    const hasDescriptor = descriptorRaw !== undefined
    const hasPhoto = photoRaw !== undefined
    if (hasDescriptor !== hasPhoto) {
      response.status(400).json({ error: 'descriptor_photo_mismatch' })
      return
    }
    if (hasDescriptor) {
      if (!isValidDescriptor(descriptorRaw) || !isValidPhotoDataUrl(photoRaw)) {
        response.status(400).json({ error: 'invalid_payload' })
        return
      }
      patch.descriptor = descriptorRaw
      patch.photoDataUrl = photoRaw
    }

    if (patch.label === undefined && patch.descriptor === undefined) {
      response.status(400).json({ error: 'empty_patch' })
      return
    }

    try {
      const updated = await updateFamilyMember(id, patch)
      if (!updated) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      response.json({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'write_failed'
      response.status(500).json({ error: 'family_members_write_failed', message })
    }
  })

  app.delete(`${apiPrefix}/admin/family-members/:id`, requireAdmin, async (request, response) => {
    const id = typeof request.params.id === 'string' ? request.params.id.trim() : ''
    if (!id || id.length > 80) {
      response.status(400).json({ error: 'invalid_id' })
      return
    }

    try {
      const removed = await removeFamilyMember(id)
      if (!removed) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      response.json({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'delete_failed'
      response.status(500).json({ error: 'family_members_delete_failed', message })
    }
  })

  app.get(`${apiPrefix}/rooms/:roomId/policy`, requireRoomToken, async (request, response) => {
    const roomId = typeof request.params.roomId === 'string' ? request.params.roomId.trim() : ''
    if (!isValidRoomId(roomId)) {
      response.status(400).json({ error: 'invalid_room_id' })
      return
    }

    try {
      const policy = await getRoomPolicy(roomId)
      if (!policy) {
        response.status(404).json({ error: 'room_not_found' })
        return
      }
      response.json({ strangerFaceAlert: policy.strangerFaceAlert })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read_failed'
      response.status(500).json({ error: 'room_policy_read_failed', message })
    }
  })

  app.get(`${apiPrefix}/admin/rooms`, requireAdmin, async (_request, response) => {
    try {
      const rooms = await listRoomPolicies()
      response.json({ rooms })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read_failed'
      response.status(500).json({ error: 'room_policies_read_failed', message })
    }
  })

  app.patch(`${apiPrefix}/admin/rooms/:roomId`, requireAdmin, async (request, response) => {
    const roomId = typeof request.params.roomId === 'string' ? request.params.roomId.trim() : ''
    if (!isValidRoomId(roomId)) {
      response.status(400).json({ error: 'invalid_room_id' })
      return
    }

    const rawEnabled = request.body?.enabled
    const rawAlert = request.body?.strangerFaceAlert
    if (typeof rawEnabled !== 'boolean' && typeof rawAlert !== 'boolean') {
      response.status(400).json({ error: 'no_fields_to_patch' })
      return
    }

    try {
      const policy = await patchRoomPolicy(roomId, {
        ...(typeof rawEnabled === 'boolean' ? { enabled: rawEnabled } : {}),
        ...(typeof rawAlert === 'boolean' ? { strangerFaceAlert: rawAlert } : {})
      })
      response.json({ ok: true, roomId, ...policy })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'write_failed'
      response.status(500).json({ error: 'room_policy_write_failed', message })
    }
  })

  app.delete(`${apiPrefix}/admin/rooms/:roomId`, requireAdmin, async (request, response) => {
    const roomId = typeof request.params.roomId === 'string' ? request.params.roomId.trim() : ''
    if (!isValidRoomId(roomId)) {
      response.status(400).json({ error: 'invalid_room_id' })
      return
    }

    try {
      const removed = await removeRoomPolicy(roomId)
      if (!removed) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      response.json({ ok: true, roomId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'delete_failed'
      response.status(500).json({ error: 'room_policy_delete_failed', message })
    }
  })
}
