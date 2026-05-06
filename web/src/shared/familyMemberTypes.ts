export type StoredFamilyMember = {
  id: string
  label: string
  descriptor: number[]
  /** data:image/*;base64,... 可选，旧数据可能没有 */
  photoDataUrl?: string
}
