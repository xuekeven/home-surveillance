import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 与 Express 开发端口一致（`npm run dev` 由 ecosystem `env_development.PORT` 注入，未设时默认 3333） */
const devBackend = `http://127.0.0.1:${process.env.PORT || '3333'}`

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
    proxy: {
      '/api': devBackend,
      '/socket.io': {
        target: devBackend,
        ws: true
      }
    }
  }
})
