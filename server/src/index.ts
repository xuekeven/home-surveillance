import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import http from 'node:http'
import { Server } from 'socket.io'
import { apiMountPrefix, config, isAllowedOrigin, socketIoHttpPath } from './config.js'
import { mountApi } from './apiRoutes.js'
import { ensureDataDir, ensureStrangerImagesDir, STRANGER_IMAGES_DIR } from './persist/dir.js'
import { registerSocketHandlers } from './socket.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = http.createServer(app)

app.use(express.json({ limit: '15mb' }))
const socketPath = socketIoHttpPath(config.publicBasePath)

const io = new Server(server, {
  path: socketPath,
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`Origin not allowed: ${origin}`))
    }
  }
})

app.disable('x-powered-by')

const sendHealth = (_request: express.Request, response: express.Response) => {
  response.json({ ok: true })
}

app.get('/healthz', sendHealth)
if (config.publicBasePath) {
  app.get(`${config.publicBasePath}/healthz`, sendHealth)
}

const apiPrefix = apiMountPrefix(config.publicBasePath)
mountApi(app, apiPrefix)

registerSocketHandlers(io)

const webDistPath = path.resolve(__dirname, '../../web/dist')
const staticBasePath = config.publicBasePath || '/'

if (config.nodeEnv === 'production') {
  app.use(staticBasePath, express.static(webDistPath))
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(webDistPath, 'index.html'))
  })
}

async function main(): Promise<void> {
  await ensureDataDir()
  await ensureStrangerImagesDir()
  server.listen(config.port, () => {
    console.log(
      `home-surveillance listening on http://localhost:${config.port} (api ${apiPrefix} socket.io path ${socketPath})`
    )
    console.log(`stranger screenshots -> ${STRANGER_IMAGES_DIR}`)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
