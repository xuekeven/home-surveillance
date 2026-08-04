#!/usr/bin/env node
/**
 * 从仓库根目录 `.env` 注入环境变量后启动并发命令，
 * 使 server / web（含 Vite proxy）共用 PORT、ALLOWED_ORIGINS、VITE_* 等。
 * 用法：npm run dev（默认 concurrent server + web）；或 node scripts/run-dev.mjs "<自定义命令>"
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const envPath = path.join(root, '.env')

if (!fs.existsSync(envPath)) {
  console.warn('[dev] 未找到 .env，请复制 .env.example 为 .env 并填写变量后再运行。')
}

dotenv.config({ path: envPath })

const merged = {
  ...process.env,
  VITE_PUBLIC_ORIGIN:
    process.env.VITE_PUBLIC_ORIGIN || process.env.FACE_ALERT_ORIGIN_SECONDARY || '',
  VITE_INTERNAL_ORIGIN:
    process.env.VITE_INTERNAL_ORIGIN || process.env.FACE_ALERT_ORIGIN_PRIMARY || ''
}

const defaultCmd =
  'npx concurrently "npm run dev -w server" "npm run dev -w web"'
const shellCmd =
  process.argv.slice(2).join(' ').trim() || defaultCmd

const child = spawn(shellCmd, {
  cwd: root,
  env: merged,
  shell: true,
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
