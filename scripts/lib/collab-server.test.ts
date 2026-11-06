// @vitest-environment node
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createCollabServer } from './collab-server.mjs'
import type { Authorization } from './collab-server.mjs'

const ROOM =
  'workspace:11111111-1111-4111-8111-111111111111:record:22222222-2222-4222-8222-222222222222'

const people: Record<string, Authorization> = {
  writer: { ok: true, user: { id: 'u-writer', name: 'Wren' }, canWrite: true },
  writer2: { ok: true, user: { id: 'u-writer2', name: 'Wes' }, canWrite: true },
  reader: { ok: true, user: { id: 'u-reader', name: 'Rae' }, canWrite: false },
  stranger: { ok: false, status: 403 },
  signedOut: { ok: false, status: 401 },
}

let server: Server
let collab: ReturnType<typeof createCollabServer>
let port: number

beforeEach(async () => {
  collab = createCollabServer({
    // The test "cookie" is just the name of the person.
    authorize: async (request) =>
      people[String(request.headers.cookie)] ?? { ok: false, status: 401 },
    idleMs: 50,
  })
  server = createServer()
  server.on('upgrade', (request, socket, head) => {
    if (!collab.handleUpgrade(request, socket, head)) socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  collab.close()
  await new Promise((resolve) => server.close(resolve))
})

class Client {
  doc = new Y.Doc()
  awareness = new awarenessProtocol.Awareness(this.doc)
  ws: WebSocket
  closed: Promise<number>
  seedReplies: Array<{ blockId: string; granted: boolean }> = []
  access: { userId: string; canWrite: boolean } | null = null
  synced: Promise<void>

  constructor(who: string, options: { room?: string; origin?: string } = {}) {
    this.ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/collaboration/ws?room=${encodeURIComponent(options.room ?? ROOM)}`,
      {
        headers: {
          cookie: who,
          ...(options.origin ? { origin: options.origin } : {}),
        },
      },
    )
    this.closed = new Promise((resolve) => this.ws.on('close', resolve))
    this.synced = new Promise((resolve) => {
      this.ws.on('message', (raw: Buffer) => {
        const decoder = decoding.createDecoder(new Uint8Array(raw))
        const type = decoding.readVarUint(decoder)
        if (type === 0) {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, 0)
          const syncType = syncProtocol.readSyncMessage(
            decoder,
            encoder,
            this.doc,
            this,
          )
          if (encoding.length(encoder) > 1)
            this.ws.send(encoding.toUint8Array(encoder))
          if (syncType === 1) resolve()
        } else if (type === 1) {
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this,
          )
        } else if (type === 2) {
          this.seedReplies.push({
            blockId: decoding.readVarString(decoder),
            granted: decoding.readVarUint(decoder) === 1,
          })
        } else if (type === 3) {
          this.access = JSON.parse(decoding.readVarString(decoder))
        }
      })
    })
    this.ws.on('open', () => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, 0)
      syncProtocol.writeSyncStep1(encoder, this.doc)
      this.ws.send(encoding.toUint8Array(encoder))
    })
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, 0)
      syncProtocol.writeUpdate(encoder, update)
      if (this.ws.readyState === WebSocket.OPEN)
        this.ws.send(encoding.toUint8Array(encoder))
    })
  }

  announce(userId: string) {
    this.awareness.setLocalState({
      user: { id: userId, name: 'x' },
      presence: {},
    })
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 1)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID,
      ]),
    )
    this.ws.send(encoding.toUint8Array(encoder))
  }

  claim(blockId: string) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 2)
    encoding.writeVarString(encoder, blockId)
    this.ws.send(encoding.toUint8Array(encoder))
  }

  close() {
    this.ws.close()
  }
}

async function until(check: () => boolean, ms = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('co-editing server', () => {
  it('relays document changes between writers', async () => {
    const a = new Client('writer')
    const b = new Client('writer2')
    await Promise.all([a.synced, b.synced])
    a.doc.getText('t').insert(0, 'hello')
    await until(() => b.doc.getText('t').toString() === 'hello')
    b.doc.getText('t').insert(5, ' world')
    await until(() => a.doc.getText('t').toString() === 'hello world')
    a.close()
    b.close()
  })

  it('tells each connection who it is and whether it can write', async () => {
    const reader = new Client('reader')
    await reader.synced
    await until(() => reader.access !== null)
    expect(reader.access).toMatchObject({ userId: 'u-reader', canWrite: false })
    reader.close()
  })

  it('drops document changes sent by a read-only connection', async () => {
    const writer = new Client('writer')
    const reader = new Client('reader')
    await Promise.all([writer.synced, reader.synced])
    reader.doc.getText('t').insert(0, 'vandalism')
    writer.doc.getText('t').insert(0, 'honest')
    await until(() => reader.doc.getText('t').toString().includes('honest'))
    expect(writer.doc.getText('t').toString()).toBe('honest')
    writer.close()
    reader.close()
  })

  it('shows presence to everyone and clears it when someone leaves', async () => {
    const a = new Client('writer')
    const b = new Client('writer2')
    await Promise.all([a.synced, b.synced])
    a.announce('u-writer')
    await until(() => b.awareness.getStates().has(a.doc.clientID))
    a.close()
    await until(() => !b.awareness.getStates().has(a.doc.clientID))
    b.close()
  })

  it('closes a connection that claims to be someone else', async () => {
    const a = new Client('writer')
    await a.synced
    a.announce('u-someone-else')
    expect(await a.closed).toBe(4403)
  })

  it('grants a block seed to exactly one editor', async () => {
    const a = new Client('writer')
    const b = new Client('writer2')
    await Promise.all([a.synced, b.synced])
    a.claim('block-1')
    b.claim('block-1')
    await until(() => a.seedReplies.length + b.seedReplies.length === 2)
    const granted = [...a.seedReplies, ...b.seedReplies].filter(
      (r) => r.granted,
    )
    expect(granted).toHaveLength(1)
    a.close()
    b.close()
  })

  it('frees a seed claim when its holder disconnects', async () => {
    const a = new Client('writer')
    const b = new Client('writer2')
    await Promise.all([a.synced, b.synced])
    a.claim('block-2')
    await until(() => a.seedReplies.length === 1)
    expect(a.seedReplies[0]?.granted).toBe(true)
    a.close()
    await until(() => collab.stats().connections === 1)
    b.claim('block-2')
    await until(() => b.seedReplies.length === 1)
    expect(b.seedReplies[0]?.granted).toBe(true)
    b.close()
  })

  it('refuses a seed once the block is already in the document', async () => {
    const a = new Client('writer')
    const b = new Client('writer2')
    await Promise.all([a.synced, b.synced])
    a.claim('block-3')
    await until(() => a.seedReplies.length === 1)
    a.doc.getMap('seeded').set('block-3', true)
    await until(() => b.doc.getMap('seeded').has('block-3'))
    b.claim('block-3')
    await until(() => b.seedReplies.length === 1)
    expect(b.seedReplies[0]?.granted).toBe(false)
    a.close()
    b.close()
  })

  it('closes people without access with a final code', async () => {
    expect(await new Client('stranger').closed).toBe(4403)
    expect(await new Client('signedOut').closed).toBe(4401)
  })

  it('rejects cross-site and malformed upgrades', async () => {
    const crossSite = new Client('writer', { origin: 'https://evil.example' })
    crossSite.ws.on('error', () => {})
    expect(await crossSite.closed).toBe(1006)
    const badRoom = new Client('writer', { room: 'workspace:nope' })
    badRoom.ws.on('error', () => {})
    expect(await badRoom.closed).toBe(1006)
  })

  it('keeps the document briefly so a reload rejoins the same session', async () => {
    const a = new Client('writer')
    await a.synced
    a.doc.getText('t').insert(0, 'kept')
    await until(() => collab.stats().rooms === 1)
    a.close()
    await until(() => collab.stats().connections === 0)
    const b = new Client('writer2')
    await b.synced
    await until(() => b.doc.getText('t').toString() === 'kept')
    b.close()
    await until(() => collab.stats().rooms === 0, 3000)
  })
})
