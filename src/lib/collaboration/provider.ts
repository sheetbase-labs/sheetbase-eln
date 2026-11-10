/**
 * Browser side of Sheetbase's bundled co-editing server
 * (scripts/lib/collab-server.mjs). One provider joins one room: it keeps a Yjs
 * document and the people-here (awareness) state in step with the server over a
 * WebSocket, reconnecting on its own and giving up only when the server says
 * the person has no access.
 *
 * The room is a relay, never an authority. Scientific content is saved to
 * PostgreSQL by the ordinary notebook save path; see the server's header.
 */
import * as awarenessProtocol from 'y-protocols/awareness'
import { z } from 'zod'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as Y from 'yjs'

import type { CollaborationPresence } from '#/lib/collaboration/types'

// Keep in step with scripts/lib/collab-server.mjs.
export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_SEED = 2
export const MESSAGE_ACCESS = 3

const FINAL_CLOSE_CODES = new Set([4401, 4403, 4408, 4429])

export type CollabStatus =
  'connecting' | 'connected' | 'disconnected' | 'denied'

export interface CollabIdentity {
  id: string
  name: string
  avatar: string | null
  color: string
}

type Listener = () => void

/**
 * The origin Yjs reports for a transaction: this provider, a peer's, or another
 * object the app passes. It is only ever compared by identity here.
 */
type TransactionOrigin = Y.Transaction['origin']

/** The access message the server sends on connect. */
const collabAccessSchema = z.looseObject({
  userId: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  canWrite: z.boolean(),
})

/**
 * A stable colour for a person's caret and presence chip, as `#rrggbb` (the
 * caret extension rejects any other notation). Dark enough for white labels.
 */
export function colorForUser(userId: string): string {
  let hash = 0

  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }

  const hue = Math.abs(hash) % 360
  const saturation = 0.62
  const lightness = 0.4
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation

  const channel = (n: number) => {
    const k = (n + hue / 30) % 12

    const value =
      lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))

    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
  }

  return `#${channel(0)}${channel(8)}${channel(4)}`
}

export function collabUrl(roomId: string, location: Location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

  return `${protocol}//${location.host}/api/collaboration/ws?room=${encodeURIComponent(roomId)}`
}

export class CollabProvider {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  status: CollabStatus = 'connecting'
  /** True once the server's copy of the document has been merged in. */
  synced = false
  /** Set by the server on connect; false until then and for read-only rooms. */
  canWrite = false
  /** The verified person, set by the server on connect. */
  identity: CollabIdentity | null = null

  private ws: WebSocket | null = null
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private presence: CollaborationPresence = {}
  private readonly listeners = new Set<Listener>()
  private readonly seedClaims = new Map<string, (granted: boolean) => void>()
  private readonly onDocUpdate: (
    update: Uint8Array,
    origin: TransactionOrigin,
  ) => void
  private readonly onAwarenessUpdate: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: TransactionOrigin,
  ) => void

  constructor(
    private readonly url: string,
    doc: Y.Doc = new Y.Doc(),
  ) {
    this.doc = doc
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.awareness.setLocalState(null)

    this.onDocUpdate = (update, origin) => {
      if (origin === this) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      this.send(encoding.toUint8Array(encoder))
    }

    this.onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === this) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          added.concat(updated, removed),
        ),
      )
      this.send(encoding.toUint8Array(encoder))
    }

    doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    this.connect()
  }

  /** Subscribe to status / sync / identity changes. Returns the unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  private emit() {
    // A snapshot: a listener may unsubscribe while it is being told.
    const listeners = [...this.listeners]

    for (const listener of listeners) listener()
  }

  private setStatus(status: CollabStatus) {
    if (this.status === status) return
    this.status = status
    this.emit()
  }

  private send(message: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // SAFETY: every message is a buffer the encoder allocated for this send (`encoding.toUint8Array`), which is ArrayBuffer-backed; lib0's type keeps the buffer type generic.
      this.ws.send(message as Uint8Array<ArrayBuffer>)
    }
  }

  private connect() {
    if (this.destroyed || typeof WebSocket === 'undefined') return
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data))
      const type = decoding.readVarUint(decoder)

      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)

        const syncType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          this,
        )

        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder))
        }

        // Step 2 is the server's reply to our step 1: its copy is now merged.
        if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
          this.synced = true
          this.emit()
        }
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this,
        )
      } else if (type === MESSAGE_SEED) {
        const blockId = decoding.readVarString(decoder)
        const granted = decoding.readVarUint(decoder) === 1
        this.seedClaims.get(blockId)?.(granted)
        this.seedClaims.delete(blockId)
      } else if (type === MESSAGE_ACCESS) {
        const access = collabAccessSchema.parse(
          JSON.parse(decoding.readVarString(decoder)),
        )

        this.canWrite = access.canWrite
        this.identity = {
          id: access.userId,
          name: access.name,
          avatar: access.avatar,
          color: colorForUser(access.userId),
        }
        this.publishPresence()
        this.emit()
      }
    }

    ws.onopen = () => {
      this.retry = 0
      this.setStatus('connected')
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, this.doc)
      this.send(encoding.toUint8Array(encoder))

      // The server forgot us when the last connection dropped; say who we are.
      if (this.awareness.getLocalState()) {
        const aware = encoding.createEncoder()
        encoding.writeVarUint(aware, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          aware,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
            this.doc.clientID,
          ]),
        )
        this.send(encoding.toUint8Array(aware))
      }
    }

    ws.onclose = (event) => {
      if (this.ws === ws) this.ws = null
      const wasSynced = this.synced
      this.synced = false
      this.canWrite = false

      for (const resolve of this.seedClaims.values()) resolve(false)
      this.seedClaims.clear()

      // Everyone else's presence is stale until we are back.
      const others = [...this.awareness.getStates().keys()].filter(
        (id) => id !== this.doc.clientID,
      )

      awarenessProtocol.removeAwarenessStates(this.awareness, others, this)

      if (this.destroyed) return

      if (FINAL_CLOSE_CODES.has(event.code)) {
        this.setStatus('denied')

        return
      }

      this.setStatus('disconnected')

      if (wasSynced) this.emit()

      const delay =
        Math.min(10_000, 500 * 2 ** this.retry) * (0.75 + Math.random() / 2)

      this.retry += 1
      this.retryTimer = setTimeout(() => this.connect(), delay)
    }
  }

  /** Merge fields into what other people see about me (block, mode, selection). */
  setPresence(patch: Partial<CollaborationPresence>) {
    this.presence = { ...this.presence, ...patch }
    this.publishPresence()
  }

  private publishPresence() {
    if (!this.identity) return
    // Merge, never replace: the editor keeps its own caret position in this
    // same state, which a wholesale replace would wipe.
    this.awareness.setLocalState({
      ...this.awareness.getLocalState(),
      user: {
        id: this.identity.id,
        name: this.identity.name,
        avatar: this.identity.avatar,
        color: this.identity.color,
      },
      presence: this.presence,
    })
  }

  /**
   * Ask for the right to put a block's saved content into the shared document.
   * Exactly one client is told yes per block; everyone else waits for that
   * client's content to arrive. Resolves false when not connected.
   */
  claimSeed(blockId: string): Promise<boolean> {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.canWrite) {
      return Promise.resolve(false)
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.seedClaims.delete(blockId)
        resolve(false)
      }, 5000)

      this.seedClaims.set(blockId, (granted) => {
        clearTimeout(timer)
        resolve(granted)
      })
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SEED)
      encoding.writeVarString(encoder, blockId)
      this.send(encoding.toUint8Array(encoder))
    })
  }

  /** Hand back a seed claim that was granted but will not be used. */
  releaseSeed(blockId: string) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SEED)
    encoding.writeVarString(encoder, blockId)
    encoding.writeVarUint(encoder, 0)
    this.send(encoding.toUint8Array(encoder))
  }

  destroy() {
    this.destroyed = true

    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    // Tell the room we left before the socket closes.
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      'local',
    )
    this.ws?.close(1000)
    this.ws = null
    this.awareness.destroy()
    this.listeners.clear()
  }
}
