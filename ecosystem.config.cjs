/**
 * 运行时配置单一来源（开发与生产均为本文件）：
 * - env：PM2 默认 / `pm2 start`（生产）。
 * - env_development：`npm run dev`、本地调试及 `pm2 start ecosystem.config.cjs --env development`。
 *
 * 字段为何不完全一致：
 * - env 只包含 Node（Express）运行时读的变量。生产前端静态资源已由 `npm run build` / `build:homeserver`
 *   把 VITE_* 打进 bundle，PM2 进程里的 NODE 不会再读 VITE_*，故不必写在 env（写了也不会改变已构建的页面）。
 * - env_development 还要喂给 Vite 开发服务器，故需 VITE_PUBLIC_BASE_PATH、VITE_ROOM_TOKEN 等。
 * - PUBLIC_BASE_PATH：生产用 `/surveillance` 与线上子路径一致；本地 Vite 根路径常用 `''`（见 web 路由与代理）。
 *
 * 修改口令、跨域、ICE 等：编辑对应块后 pm2 reload；开发无需 `.env`。
 */
const devIce = JSON.stringify([
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
])

module.exports = {
  apps: [
    {
      name: 'home-surveillance',
      script: './server/dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3333',
        PUBLIC_BASE_PATH: '/surveillance',
        ROOM_TOKEN: 'xuekaixihuanshenshiyi',
        MAX_VIEWERS_PER_ROOM: '2',
        ALLOWED_ORIGINS: [
          'https://homeserver.tailed5977.ts.net',
          'https://www.kaitool.top',
          'http://localhost:5173',
          'http://localhost:3333'
        ].join(','),
        ICE_SERVERS_JSON: devIce
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: '3333',
        PUBLIC_BASE_PATH: '',
        ROOM_TOKEN: 'xuekaixihuanshenshiyi',
        MAX_VIEWERS_PER_ROOM: '2',
        ALLOWED_ORIGINS: [
          'https://homeserver.tailed5977.ts.net',
          'https://www.kaitool.top',
          'http://localhost:5173',
          'http://localhost:3333'
        ].join(','),
        ICE_SERVERS_JSON: devIce,
        VITE_PUBLIC_BASE_PATH: '/',
        VITE_SOCKET_PATH: '/socket.io/',
        VITE_ROOM_TOKEN: 'xuekaixihuanshenshiyi',
        VITE_ICE_SERVERS_JSON: devIce
      }
    }
  ]
}
