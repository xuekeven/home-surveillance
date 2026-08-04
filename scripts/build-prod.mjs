#!/usr/bin/env node
/**
 * 家庭云生产构建：从仓库根 `.env` 读取运行时配置并注入 web 构建所需的 `VITE_*`，
 * 避免前后端路径、口令或后台入口地址不一致。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const envPath = path.join(root, '.env')

if (!fs.existsSync(envPath)) {
  console.error('缺少根目录 .env，请先复制 .env.example 为 .env 并填写生产变量。')
  process.exit(1)
}

dotenv.config({ path: envPath })

const defaultIce = JSON.stringify([
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
])

const webEnv = {
  ...process.env,
  VITE_PUBLIC_BASE_PATH:
    process.env.VITE_PUBLIC_BASE_PATH ?? process.env.PUBLIC_BASE_PATH ?? '/surveillance',
  VITE_ROOM_TOKEN: process.env.VITE_ROOM_TOKEN ?? process.env.ROOM_TOKEN ?? '',
  VITE_ICE_SERVERS_JSON:
    process.env.VITE_ICE_SERVERS_JSON ?? process.env.ICE_SERVERS_JSON ?? defaultIce,
  VITE_PUBLIC_ORIGIN:
    process.env.VITE_PUBLIC_ORIGIN || process.env.FACE_ALERT_ORIGIN_SECONDARY || '',
  VITE_INTERNAL_ORIGIN:
    process.env.VITE_INTERNAL_ORIGIN || process.env.FACE_ALERT_ORIGIN_PRIMARY || ''
}

let code = spawnSync('pnpm', ['--filter', '@home-surveillance/web', 'build'], {
  cwd: root,
  env: webEnv,
  stdio: 'inherit'
}).status
if (code !== 0) {
  process.exit(code ?? 1)
}

code = spawnSync('pnpm', ['--filter', '@home-surveillance/server', 'build'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
}).status
process.exit(code ?? 1)
