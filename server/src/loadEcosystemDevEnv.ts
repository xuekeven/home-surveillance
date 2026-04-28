import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 开发环境从仓库根目录 ecosystem.config.cjs 读取 apps[0].env_development，
 * 仅填充尚未设置的环境变量（便于 CI / 命令行临时覆盖）。
 */
export function applyEcosystemDevelopmentEnv(): void {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  const require = createRequire(import.meta.url)
  const here = path.dirname(fileURLToPath(import.meta.url))
  const ecoPath = path.resolve(here, '../../ecosystem.config.cjs')

  try {
    const eco = require(ecoPath) as {
      apps?: Array<{ env_development?: Record<string, unknown> }>
    }
    const dev = eco.apps?.[0]?.env_development
    if (!dev) {
      return
    }

    for (const [key, val] of Object.entries(dev)) {
      if (process.env[key] !== undefined) {
        continue
      }
      process.env[key] =
        typeof val === 'string' ? val : JSON.stringify(val)
    }
  } catch {
    // 极少数打包场景可能找不到 ecosystem —— 沿用进程已有环境与默认值
  }
}
