import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import http from 'node:http'
import { Server } from 'socket.io'
import { config, isAllowedOrigin } from './config.js'
import { registerSocketHandlers } from './socket.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
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

app.get('/healthz', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/ice-servers', (_request, response) => {
  response.json({ iceServers: config.iceServers })
})

registerSocketHandlers(io)

const webDistPath = path.resolve(__dirname, '../../web/dist')
const staticBasePath = config.publicBasePath || '/'

if (config.nodeEnv === 'production') {
  app.use(staticBasePath, express.static(webDistPath))
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(webDistPath, 'index.html'))
  })
}

server.listen(config.port, () => {
  console.log(`home-surveillance server listening on http://localhost:${config.port}`)
})
