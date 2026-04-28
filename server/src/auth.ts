import { config } from './config.js'
import type { JoinRoomPayload } from './types.js'

export function isAuthorized(payload: JoinRoomPayload): boolean {
  return payload.token === config.roomToken
}
