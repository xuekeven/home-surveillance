import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 运行时数据目录：`server/data`（相对编译产物 `dist`） */
export const DATA_DIR = path.resolve(__dirname, '..', '..', 'data')

/** 陌生人抓拍图：仓库根目录 `images/stranger`（从 `dist/persist` 向上三级） */
export const STRANGER_IMAGES_DIR = path.resolve(__dirname, '..', '..', '..', 'images', 'stranger')

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export async function ensureStrangerImagesDir(): Promise<void> {
  await fs.mkdir(STRANGER_IMAGES_DIR, { recursive: true })
}
