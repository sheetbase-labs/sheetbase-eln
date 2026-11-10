import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { z } from 'zod'
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import { Doc } from 'yjs'

import { createCollabServer } from '../../../scripts/lib/collab-server.mjs'
import { CollabProvider } from '#/lib/collaboration/provider'
import type { RoomPeer } from '#/lib/collaboration/room-hooks'

/** Disposable loopback transport; peer fixtures use the real awareness codec. */
export async function createPresenceTestRoom() {
  const collab = createCollabServer({
    // jsdom's page origin differs from this disposable loopback port.
    allowedOrigin: () => true,
    authorize: async () => ({
      ok: true,
      user: { id: 'local-user', name: 'Local Scientist' },
      canWrite: true,
    }),
  })

  const server = createServer()
  server.on('upgrade', (request, socket, head) => {
    collab.handleUpgrade(request, socket, head)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = z.object({ port: z.number() }).parse(server.address())

  const roomId =
    'workspace:11111111-1111-4111-8111-111111111111:record:22222222-2222-4222-8222-222222222222'

  const doc = new Doc()

  // Node's native WebSocket dispatches Node Events into jsdom's Event realm.
  // Bind the real ws transport only during construction, never a socket mock.
  const originalSocket = Object.getOwnPropertyDescriptor(
    globalThis,
    'WebSocket',
  )

  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: WebSocket,
  })
  let provider: CollabProvider

  try {
    provider = new CollabProvider(
      `ws://127.0.0.1:${address.port}/api/collaboration/ws?room=${encodeURIComponent(roomId)}`,
      doc,
    )
  } finally {
    if (originalSocket)
      Object.defineProperty(globalThis, 'WebSocket', originalSocket)
  }

  const remotes: Array<{ doc: Doc; awareness: Awareness }> = []

  return {
    provider,
    addPeers(peers: readonly RoomPeer[]) {
      for (const peer of peers) {
        const remoteDoc = new Doc()
        remoteDoc.clientID = peer.connectionId
        const awareness = new Awareness(remoteDoc)
        awareness.setLocalState({
          user: { id: peer.id, ...peer.info },
          presence: peer.presence,
        })
        remotes.push({ doc: remoteDoc, awareness })
        applyAwarenessUpdate(
          provider.awareness,
          encodeAwarenessUpdate(awareness, [remoteDoc.clientID]),
          provider,
        )
      }
    },
    async close() {
      provider.destroy()
      doc.destroy()

      for (const remote of remotes) {
        remote.awareness.destroy()
        remote.doc.destroy()
      }

      collab.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
