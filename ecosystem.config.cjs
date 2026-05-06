/**
 * 仅 PM2 进程形态配置。运行时密钥与变量见仓库根目录 `.env`（服务端启动时由 dotenv 加载）。
 */
module.exports = {
  apps: [
    {
      name: 'home-surveillance',
      script: './server/dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      time: true
    }
  ]
}
