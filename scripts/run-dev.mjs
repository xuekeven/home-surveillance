#!/usr/bin/env node
/**
 * 将 ecosystem.config.cjs 中的 env_development 合并进环境变量后启动命令，
 * 使 concurrently 下的 server、web 进程都能拿到 PORT / ALLOWED_ORIGINS / VITE_* 等。
 * 用法：npm run dev（默认并发 server + web）；或 node scripts/run-dev.mjs "<自定义命令>"
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const eco = require(path.join(root, 'ecosystem.config.cjs'))
const dev = eco.apps?.[0]?.env_development

if (!dev || typeof dev !== 'object') {
  console.error('ecosystem.config.cjs: 缺少 apps[0].env_development')
  process.exit(1)
}

const merged = { ...process.env }
for (const [key, val] of Object.entries(dev)) {
  merged[key] = typeof val === 'string' ? val : JSON.stringify(val)
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
