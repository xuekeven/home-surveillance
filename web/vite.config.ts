import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 与 Express 开发端口一致（`npm run dev` 由 ecosystem `env_development.PORT` 注入，未设时默认 3000） */
const devBackend = `http://127.0.0.1:${process.env.PORT || '3000'}`

/** 与 server `PUBLIC_BASE_PATH` 对齐：`/api`、`/socket.io` 可能挂在 `{base}/api`、`{base}/socket.io` */
function devProxyTargets(backend: string): Record<
  string,
  string | { target: string; ws: boolean }
> {
  const raw = process.env.VITE_PUBLIC_BASE_PATH || '/'
  const base = raw === '/' ? '' : raw.replace(/\/$/, '')
  const proxy: Record<string, string | { target: string; ws: boolean }> = {}
  if (base) {
    proxy[`${base}/api`] = backend
    proxy[`${base}/socket.io`] = {
      target: backend,
      ws: true
    }
  } else {
    proxy['/api'] = backend
    proxy['/socket.io'] = {
      target: backend,
      ws: true
    }
  }
  return proxy
}

export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE_PATH || '/',
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      events: 'events/',
      buffer: 'buffer/'
    }
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: devProxyTargets(devBackend)
  }
})
