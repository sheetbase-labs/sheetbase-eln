import type { IncomingMessage } from 'node:http'
import type { CollabHost, CollabLog } from './collab-host.mjs'

export const COLLAB_PATH: string
export const MESSAGE_SYNC: 0
export const MESSAGE_AWARENESS: 1
export const MESSAGE_SEED: 2
export const MESSAGE_ACCESS: 3
export const CLOSE_UNAUTHENTICATED: 4401
export const CLOSE_FORBIDDEN: 4403
export const CLOSE_BAD_REQUEST: 4408
export const CLOSE_ROOM_FULL: 4429

export type Authorization =
  | {
      ok: true
      user: { id: string; name: string; avatar?: string | null }
      canWrite: boolean
    }
  | { ok: false; status: number }

export function createCollabServer(options: {
  authorize: (request: IncomingMessage, room: string) => Promise<Authorization>
  log?: CollabLog
  allowedOrigin?: (
    origin: string | undefined,
    request: IncomingMessage,
  ) => boolean
  maxConnectionsPerRoom?: number
  maxRoomBytes?: number
  idleMs?: number
  pingMs?: number
}): CollabHost

export function sameOrigin(
  origin: string | undefined,
  request: IncomingMessage,
): boolean
