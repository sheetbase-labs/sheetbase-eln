/**
 * Sheetbase's bundled co-editing server.
 *
 * A small WebSocket endpoint that ships with the app and runs inside the same
 * Node process as the web server, so it works on any host with nothing else to
 * install or pay for. It relays Yjs document updates and presence (awareness)
 * between the people looking at one record, sheet or dataset.
 *
 * What it is NOT: an authority. PostgreSQL stays the only place scientific
 * state lives. A room's document exists only while someone is connected; every
 * editor still saves its block through the ordinary notebook save path, so the
 * database always holds the content. A new session seeds its editors from the
 * database. Nothing here is written to disk.
 *
 * Access is decided by `authorize`, which the host wires to the app's own
 * session and permission checks (`/api/collaboration/ticket`). A viewer
 * connects read-only: the server drops any document change they send.
 *
 * Wire protocol (binary, lib0 encoded), one message per frame:
 *   0  sync       y-protocols sync (step 1, step 2, update)
 *   1  awareness  y-protocols awareness update
 *   2  seed       client -> server: claim the right to seed block `<id>` from
 *                 the database (add a trailing 0 to hand the claim back);
 *                 server -> client: `<id>` and 1 if granted else 0. Exactly one client wins per block, so two people opening
 *                 the same block at once cannot both paste the saved content.
 *   3  access     server -> client, once on connect: JSON naming the verified
 *                 person and whether they may edit. Presence must carry that
 *                 identity or the server closes the connection.
 *
 * Close codes the client treats as final (no reconnect): 4401 not signed in,
 * 4403 no access to the room, 4408 bad request, 4429 room is full.
 */
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

export const COLLAB_PATH = '/api/collaboration/ws'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_SEED = 2
export const MESSAGE_ACCESS = 3

export const CLOSE_UNAUTHENTICATED = 4401
export const CLOSE_FORBIDDEN = 4403
export const CLOSE_BAD_REQUEST = 4408
export const CLOSE_ROOM_FULL = 4429

const OPEN = 1

/** Rooms are `workspace:<uuid>:<record|sheet|dataset>:<uuid>`. */
const ROOM_ID =
  /^workspace:[0-9a-f-]{36}:(record|sheet|dataset):[0-9a-f-]{36}$/i

/**
 * @typedef {{
 *   ok: true,
 *   user: { id: string, name: string, avatar?: string | null },
 *   canWrite: boolean,
 * } | { ok: false, status: number }} Authorization
 */

/**
 * @param {{
 *   authorize: (request: import('node:http').IncomingMessage, room: string) => Promise<Authorization>,
 *   log?: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void,
 *   allowedOrigin?: (origin: string | undefined, request: import('node:http').IncomingMessage) => boolean,
 *   maxConnectionsPerRoom?: number,
 *   maxRoomBytes?: number,
 *   idleMs?: number,
 *   pingMs?: number,
 * }} options
 */
export function createCollabServer({
  authorize,
  log = () => {},
  allowedOrigin = sameOrigin,
  maxConnectionsPerRoom = 100,
  maxRoomBytes = 64 * 1024 * 1024,
  idleMs = 30_000,
  pingMs = 30_000,
}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
  })
  /** @type {Map<string, Room>} */
  const rooms = new Map()

  class Room {
    /** @param {string} id */
    constructor(id) {
      this.id = id
      this.doc = new Y.Doc()
      this.awareness = new awarenessProtocol.Awareness(this.doc)
      // The server itself has no presence.
      this.awareness.setLocalState(null)
      /** @type {Map<import('ws').WebSocket, Connection>} */
      this.conns = new Map()
      /** @type {Map<string, import('ws').WebSocket>} */
      this.pendingSeeds = new Map()
      this.bytes = 0
      /** @type {ReturnType<typeof setTimeout> | null} */
      this.idleTimer = null

      this.doc.on('update', (update, origin) => {
        this.bytes += update.length
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        const message = encoding.toUint8Array(encoder)
        for (const ws of this.conns.keys()) {
          if (ws !== origin) send(ws, message)
        }
        // Once the seeding client has written the block, its claim is spent.
        const seeded = this.doc.getMap('seeded')
        for (const blockId of [...this.pendingSeeds.keys()]) {
          if (seeded.has(blockId)) this.pendingSeeds.delete(blockId)
        }
        if (this.bytes > maxRoomBytes) {
          log('warn', 'collab room exceeded its size limit', { room: this.id })
          for (const ws of this.conns.keys()) ws.close(1009, 'room too large')
        }
      })

      this.awareness.on(
        'update',
        (
          /** @type {{added: number[], updated: number[], removed: number[]}} */ {
            added,
            updated,
            removed,
          },
          origin,
        ) => {
          const changed = added.concat(updated, removed)
          const conn = origin && this.conns.get(origin)
          if (conn) {
            for (const clientId of added) conn.clientIds.add(clientId)
            for (const clientId of removed) conn.clientIds.delete(clientId)
            // A connection may only speak for the signed-in user it belongs
            // to. Anything else is an attempt to appear as someone else.
            for (const clientId of added.concat(updated)) {
              const state = this.awareness.getStates().get(clientId)
              if (state?.user?.id !== conn.user.id) {
                log('warn', 'collab awareness identity mismatch', {
                  room: this.id,
                  userId: conn.user.id,
                })
                origin.close(CLOSE_FORBIDDEN, 'identity mismatch')
                return
              }
            }
          }
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
          )
          const message = encoding.toUint8Array(encoder)
          for (const ws of this.conns.keys()) send(ws, message)
        },
      )
    }

    destroy() {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.awareness.destroy()
      this.doc.destroy()
      rooms.delete(this.id)
    }
  }

  /**
   * @typedef {{
   *   user: { id: string, name: string, avatar?: string | null },
   *   canWrite: boolean,
   *   clientIds: Set<number>,
   *   alive: boolean,
   * }} Connection
   */

  /** @param {import('ws').WebSocket} ws @param {Uint8Array} message */
  function send(ws, message) {
    if (ws.readyState !== OPEN) return
    ws.send(message, (error) => {
      if (error) ws.terminate()
    })
  }

  /**
   * @param {Room} room
   * @param {import('ws').WebSocket} ws
   * @param {Connection} conn
   * @param {Uint8Array} data
   */
  function onMessage(room, ws, conn, data) {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      const syncType = decoding.readVarUint(decoder)
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncStep1(decoder, encoder, room.doc)
      } else if (conn.canWrite) {
        if (syncType === syncProtocol.messageYjsSyncStep2) {
          syncProtocol.readSyncStep2(decoder, room.doc, ws)
        } else if (syncType === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(decoder, room.doc, ws)
        }
      }
      // A read-only connection's document changes are dropped here: the
      // server, not the client, decides who may write.
      if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder))
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        room.awareness,
        decoding.readVarUint8Array(decoder),
        ws,
      )
    } else if (type === MESSAGE_SEED && conn.canWrite) {
      const blockId = decoding.readVarString(decoder)
      // A second field of 0 hands a claim back (the editor closed first).
      if (decoding.hasContent(decoder) && decoding.readVarUint(decoder) === 0) {
        if (room.pendingSeeds.get(blockId) === ws) {
          room.pendingSeeds.delete(blockId)
        }
        return
      }
      const taken =
        room.doc.getMap('seeded').has(blockId) ||
        (room.pendingSeeds.has(blockId) &&
          room.pendingSeeds.get(blockId) !== ws)
      if (!taken) room.pendingSeeds.set(blockId, ws)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SEED)
      encoding.writeVarString(encoder, blockId)
      encoding.writeVarUint(encoder, taken ? 0 : 1)
      send(ws, encoding.toUint8Array(encoder))
    }
  }

  /**
   * @param {Room} room
   * @param {import('ws').WebSocket} ws
   * @param {Connection} conn
   */
  function onOpen(room, ws, conn) {
    room.conns.set(ws, conn)
    if (room.idleTimer) {
      clearTimeout(room.idleTimer)
      room.idleTimer = null
    }
    ws.binaryType = 'nodebuffer'
    ws.on('message', (raw) => {
      try {
        const data = Array.isArray(raw)
          ? Buffer.concat(raw)
          : raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : raw
        onMessage(room, ws, conn, new Uint8Array(data))
      } catch (error) {
        log('warn', 'collab message rejected', {
          room: room.id,
          error: error instanceof Error ? error.message : String(error),
        })
        ws.close(CLOSE_BAD_REQUEST, 'bad message')
      }
    })
    ws.on('pong', () => {
      conn.alive = true
    })
    ws.on('close', () => {
      room.conns.delete(ws)
      awarenessProtocol.removeAwarenessStates(
        room.awareness,
        [...conn.clientIds],
        null,
      )
      for (const [blockId, owner] of room.pendingSeeds) {
        if (owner === ws) room.pendingSeeds.delete(blockId)
      }
      if (room.conns.size === 0 && !room.idleTimer) {
        // Keep the document briefly so a dropped connection or a page reload
        // rejoins the same session instead of re-seeding from the database.
        room.idleTimer = setTimeout(() => room.destroy(), idleMs)
        room.idleTimer.unref?.()
      }
    })

    // Greet: who they are, sync step 1, then everyone's current presence.
    const access = encoding.createEncoder()
    encoding.writeVarUint(access, MESSAGE_ACCESS)
    encoding.writeVarString(
      access,
      JSON.stringify({
        userId: conn.user.id,
        name: conn.user.name,
        avatar: conn.user.avatar ?? null,
        canWrite: conn.canWrite,
      }),
    )
    send(ws, encoding.toUint8Array(access))
    const sync = encoding.createEncoder()
    encoding.writeVarUint(sync, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(sync, room.doc)
    send(ws, encoding.toUint8Array(sync))
    const states = room.awareness.getStates()
    if (states.size > 0) {
      const aware = encoding.createEncoder()
      encoding.writeVarUint(aware, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        aware,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [
          ...states.keys(),
        ]),
      )
      send(ws, encoding.toUint8Array(aware))
    }
  }

  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const [ws, conn] of room.conns) {
        if (!conn.alive) {
          ws.terminate()
          continue
        }
        conn.alive = false
        ws.ping()
      }
    }
  }, pingMs)
  heartbeat.unref?.()

  /**
   * Handles an HTTP upgrade. Returns false when the request is not for this
   * server so the caller can leave it to someone else (the dev server's HMR).
   *
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:stream').Duplex} socket
   * @param {Buffer} head
   */
  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== COLLAB_PATH) return false

    const refuse = (
      /** @type {number} */ status,
      /** @type {string} */ text,
    ) => {
      socket.write(
        `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      )
      socket.destroy()
    }

    // Browsers attach cookies to cross-site WebSocket requests, so the origin
    // must be checked or any web page could join a room as the signed-in user.
    if (!allowedOrigin(request.headers.origin, request)) {
      refuse(403, 'Forbidden')
      return true
    }
    const roomId = url.searchParams.get('room') ?? ''
    if (!ROOM_ID.test(roomId)) {
      refuse(400, 'Bad Request')
      return true
    }

    authorize(request, roomId).then(
      (result) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          if (!result.ok) {
            ws.close(
              result.status === 401 ? CLOSE_UNAUTHENTICATED : CLOSE_FORBIDDEN,
              'access denied',
            )
            return
          }
          let room = rooms.get(roomId)
          if (!room) {
            room = new Room(roomId)
            rooms.set(roomId, room)
          }
          if (room.conns.size >= maxConnectionsPerRoom) {
            ws.close(CLOSE_ROOM_FULL, 'room full')
            return
          }
          onOpen(room, ws, {
            user: result.user,
            canWrite: result.canWrite,
            clientIds: new Set(),
            alive: true,
          })
          log('info', 'collab connected', {
            room: roomId,
            userId: result.user.id,
            canWrite: result.canWrite,
          })
        })
      },
      (error) => {
        log('error', 'collab authorize failed', {
          room: roomId,
          error: error instanceof Error ? error.message : String(error),
        })
        refuse(503, 'Service Unavailable')
      },
    )
    return true
  }

  return {
    handleUpgrade,
    /** Live counts for the diagnostics page. */
    stats() {
      let connections = 0
      for (const room of rooms.values()) connections += room.conns.size
      return { rooms: rooms.size, connections }
    },
    close() {
      clearInterval(heartbeat)
      for (const room of rooms.values()) {
        for (const ws of room.conns.keys()) ws.close(1001, 'server stopping')
        room.destroy()
      }
      wss.close()
    },
  }
}

/**
 * The upgrade must come from the page's own origin. A request with no Origin
 * header (a non-browser client) is allowed, because it cannot ride a user's
 * cookies without already holding them.
 *
 * @param {string | undefined} origin
 * @param {import('node:http').IncomingMessage} request
 */
export function sameOrigin(origin, request) {
  if (!origin) return true
  try {
    const forwardedHost = String(request.headers['x-forwarded-host'] ?? '')
      .split(',')[0]
      .trim()
    const host = forwardedHost || request.headers.host
    return new URL(origin).host === host
  } catch {
    return false
  }
}
