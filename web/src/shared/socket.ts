import { io, type Socket } from 'socket.io-client'
import { appConfig } from '../config'

export function createSocket(): Socket {
  return io(appConfig.socketUrl, {
    path: appConfig.socketPath,
    transports: ['websocket', 'polling']
  })
}
