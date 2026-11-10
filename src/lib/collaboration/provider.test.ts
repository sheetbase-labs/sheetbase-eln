// @vitest-environment node
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createCollabServer } from '../../../scripts/lib/collab-server.mjs'
import type { Authorization } from '../../../scripts/lib/collab-server.mjs'
import { CollabProvider, colorForUser } from './provider'

const ROOM =
  'workspace:11111111-1111-4111-8111-111111111111:record:22222222-2222-4222-8222-222222222222'

const people = new Map<string, Authorization>([
  ['ada', { ok: true, user: { id: 'u-ada', name: 'Ada' }, canWrite: true }],
  ['bo', { ok: true, user: { id: 'u-bo', name: 'Bo' }, canWrite: true }],
  ['vic', { ok: true, user: { id: 'u-vic', name: 'Vic' }, canWrite: false }],
])

let server: Server
let collab: ReturnType<typeof createCollabServer>
let port: number
const open: CollabProvider[] = []

// The provider speaks to a real server; the "cookie" names the person.
class PersonSocket extends WebSocket {
  static who = 'ada'
  constructor(url: string) {
    // SAFETY: Node's WebSocket takes undici ClientOptions (including `headers`) as its second argument; the DOM declaration only names subprotocols.
    super(url, { headers: { cookie: PersonSocket.who } } as never)
  }
}

function join(who: string): CollabProvider {
  PersonSocket.who = who
  const original = globalThis.WebSocket

  // SAFETY: PersonSocket extends WebSocket and only adds the cookie header its constructor sends, so it satisfies the global constructor's contract for the one-argument call the provider makes.
  globalThis.WebSocket = PersonSocket as typeof WebSocket

  const provider = new CollabProvider(
    `ws://127.0.0.1:${port}/api/collaboration/ws?room=${encodeURIComponent(ROOM)}`,
  )

  globalThis.WebSocket = original
  open.push(provider)

  return provider
}

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now()

  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeEach(async () => {
  collab = createCollabServer({
    authorize: async (request) =>
      people.get(String(request.headers.cookie)) ?? { ok: false, status: 401 },
  })
  server = createServer()
  server.on('upgrade', (request, socket, head) => {
    collab.handleUpgrade(request, socket, head)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: the listen callback resolves only after a bound TCP socket exists, and a TCP server's address is its AddressInfo.
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  for (const provider of open.splice(0)) provider.destroy()
  collab.close()
  await new Promise((resolve) => server.close(resolve))
})

describe('CollabProvider', () => {
  it('learns who the person is and whether they can write', async () => {
    const vic = join('vic')
    await until(() => vic.synced && vic.identity !== null)
    expect(vic.status).toBe('connected')
    expect(vic.canWrite).toBe(false)
    expect(vic.identity).toMatchObject({ id: 'u-vic', name: 'Vic' })
  })

  it('shares text and presence between two people', async () => {
    const ada = join('ada')
    const bo = join('bo')
    await until(
      () => ada.synced && bo.synced && !!ada.identity && !!bo.identity,
    )
    ada.doc.getText('t').insert(0, 'shared')
    await until(() => bo.doc.getText('t').toJSON() === 'shared')
    ada.setPresence({ activeBlockId: 'b1', mode: 'editing' })
    await until(() =>
      [...bo.awareness.getStates().values()].some(
        (state) => state.presence?.activeBlockId === 'b1',
      ),
    )
  })

  it('lets exactly one of two people seed a block', async () => {
    const ada = join('ada')
    const bo = join('bo')
    await until(() => ada.synced && bo.synced && ada.canWrite && bo.canWrite)
    const [a, b] = await Promise.all([ada.claimSeed('b1'), bo.claimSeed('b1')])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('does not let a read-only person claim a seed', async () => {
    const vic = join('vic')
    await until(() => vic.synced)
    expect(await vic.claimSeed('b1')).toBe(false)
  })

  it('stops retrying once access is refused', async () => {
    const nobody = join('nobody')
    await until(() => nobody.status === 'denied')
    expect(nobody.synced).toBe(false)
  })

  it('gives a person the same colour every time', () => {
    expect(colorForUser('u-ada')).toBe(colorForUser('u-ada'))
    expect(colorForUser('u-ada')).not.toBe(colorForUser('u-bo'))
    expect(colorForUser('u-ada')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
