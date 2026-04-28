#!/usr/bin/env node
/**
 * 家庭云生产构建：`VITE_ROOM_TOKEN`、`VITE_ICE_SERVERS_JSON` 与 ecosystem.config.cjs 的 env 对齐，
 * 避免出现「信令已连接但房间口令无效」（前端仍为默认 change-me）。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const eco = require(path.join(root, 'ecosystem.config.cjs'))
const prod = eco.apps?.[0]?.env

if (!prod || typeof prod !== 'object') {
  console.error('ecosystem.config.cjs: 缺少 apps[0].env')
  process.exit(1)
}

const env = {
  ...process.env,
  VITE_PUBLIC_BASE_PATH: '/surveillance',
  VITE_ROOM_TOKEN: prod.ROOM_TOKEN,
  VITE_ICE_SERVERS_JSON: prod.ICE_SERVERS_JSON
}

let code = spawnSync('npm', ['run', 'build', '-w', 'web'], {
  cwd: root,
  env,
  stdio: 'inherit'
}).status
if (code !== 0) {
  process.exit(code ?? 1)
}

code = spawnSync('npm', ['run', 'build', '-w', 'server'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
}).status
process.exit(code ?? 1)
