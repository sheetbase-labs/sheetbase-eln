import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

export const COLLAB_PATH: string

export type CollabLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  fields?: {
    room?: string
    error?: string
    userId?: string
    canWrite?: boolean
  },
) => void

export interface CollabHost {
  /** Returns false when the request is not for the co-editing server. */
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => boolean
  /** Live counts for the diagnostics page. */
  stats: () => { rooms: number; connections: number }
  close: () => void
}

export function createCollabHost(options: {
  fetchApp: (request: Request) => Promise<Response>
  log?: CollabLog
}): CollabHost
