import path from 'node:path'
import { DATA_DIR } from './dir.js'
import { createMutationQueue, readTextFileIfExists, writeJsonAtomic } from './fileStore.js'

export type FamilyMemberRecord = {
  id: string
  label: string
  descriptor: number[]
  /** data:image/*;base64,... 登记照片缩略图（可选，旧数据可能无） */
  photoDataUrl?: string
}

type Payload = {
  version: 1
  members: FamilyMemberRecord[]
}

const FILE = path.join(DATA_DIR, 'family-members.json')
const enqueueMutation = createMutationQueue()

const MAX_PHOTO_DATA_URL_CHARS = 750_000

function sanitizePhotoDataUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  if (raw.length < 30 || raw.length > MAX_PHOTO_DATA_URL_CHARS) {
    return undefined
  }
  if (!raw.startsWith('data:image/')) {
    return undefined
  }
  return raw
}

async function readPayload(): Promise<Payload> {
  const raw = await readTextFileIfExists(FILE)
  if (raw === null) {
    return { version: 1, members: [] }
  }

  const data = JSON.parse(raw) as Payload
  if (data.version !== 1 || !Array.isArray(data.members)) {
    throw new Error('family-members.json has an invalid shape')
  }
  return data
}

async function writePayload(data: Payload): Promise<void> {
  await writeJsonAtomic(FILE, data)
}

export async function listFamilyMembers(): Promise<FamilyMemberRecord[]> {
  const data = await readPayload()
  return data.members
    .filter(
      (m) =>
        typeof m.id === 'string' &&
        typeof m.label === 'string' &&
        Array.isArray(m.descriptor) &&
        m.descriptor.length >= 64 &&
        m.descriptor.every((x) => typeof x === 'number' && Number.isFinite(x))
    )
    .map((m) => {
      const photoDataUrl = sanitizePhotoDataUrl(m.photoDataUrl)
      const base = { id: m.id, label: m.label, descriptor: m.descriptor }
      return photoDataUrl ? { ...base, photoDataUrl } : base
    })
}

export async function addFamilyMember(member: FamilyMemberRecord): Promise<void> {
  return enqueueMutation(async () => {
    const data = await readPayload()
    data.members.push(member)
    await writePayload(data)
  })
}

export async function removeFamilyMember(id: string): Promise<boolean> {
  return enqueueMutation(async () => {
    const data = await readPayload()
    const before = data.members.length
    data.members = data.members.filter((m) => m.id !== id)
    if (data.members.length === before) {
      return false
    }
    await writePayload(data)
    return true
  })
}

export async function updateFamilyMember(
  id: string,
  patch: { label?: string; descriptor?: number[]; photoDataUrl?: string }
): Promise<boolean> {
  return enqueueMutation(async () => {
    const data = await readPayload()
    const idx = data.members.findIndex((m) => m.id === id)
    if (idx === -1) {
      return false
    }
    const cur = data.members[idx]
    data.members[idx] = {
      ...cur,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.descriptor !== undefined ? { descriptor: patch.descriptor } : {}),
      ...(patch.photoDataUrl !== undefined ? { photoDataUrl: patch.photoDataUrl } : {})
    }
    await writePayload(data)
    return true
  })
}
