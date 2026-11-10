// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ObjectStorage } from '#/lib/file-storage'
import type { SessionAuthDeps } from '#/lib/request-auth'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
  process.env.POSTGREST_URL = 'http://postgrest.test'
})

const {
  AVATAR_MAX_BYTES,
  avatarStorageKey,
  handleAvatarDownload,
  handleMyAvatar,
  sniffAvatarType,
} = await import('./avatar-routes')

const rpcArgs = z.record(z.string(), z.json())

interface RpcCall {
  name: string
  args: z.infer<typeof rpcArgs>
  token: string | null
}

/** What the RPC answers next: a status and the response body PostgREST sends. */
interface RpcReply {
  status: number
  body: z.infer<ReturnType<typeof z.json>>
}

const rpcCalls: RpcCall[] = []
let rpcReply: RpcReply = { status: 200, body: null }

/** PostgREST, as the avatar RPCs reach it: the compiled transport, not a stub. */
const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname } = new URL(request.url)

  if (request.method === 'POST' && pathname.startsWith('/rpc/')) {
    rpcCalls.push({
      name: pathname.slice('/rpc/'.length),
      args: rpcArgs.parse(await request.json()),
      token:
        request.headers.get('authorization')?.replace(/^Bearer /, '') ?? null,
    })

    return Response.json(rpcReply.body, { status: rpcReply.status })
  }

  throw new Error(`Unexpected request: ${request.method} ${pathname}`)
}

vi.stubGlobal('fetch', fixtureFetch)

const ME = 'user-1'

const signedIn: SessionAuthDeps = {
  getSession: async () => ({ user: { id: ME }, session: { id: 'session-1' } }),
  getWorkspaceForUser: async () => ({ id: 'workspace-1' }),
  mintToken: async () => 'token',
}

const signedOut: SessionAuthDeps = {
  ...signedIn,
  getSession: async () => null,
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')

function memoryStorage() {
  const objects = new Map<string, Uint8Array>()

  const storage: ObjectStorage = {
    async putStream(key, body) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      objects.set(key, bytes)

      return { byteSize: BigInt(bytes.byteLength), checksum: '0'.repeat(64) }
    },
    async getStream(key) {
      const bytes = objects.get(key) ?? new Uint8Array()

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })

      return { stream, byteSize: bytes.byteLength }
    },
    async head(key) {
      const bytes = objects.get(key)

      return bytes ? { byteSize: bytes.byteLength } : null
    },
    async delete(key) {
      objects.delete(key)
    },
  }

  return { storage, objects }
}

function put(body: BodyInit) {
  return new Request('http://x/api/avatars/me', { method: 'PUT', body })
}

beforeEach(() => {
  rpcCalls.length = 0
  rpcReply = { status: 200, body: null }
})

describe('sniffAvatarType', () => {
  it('reads PNG, JPEG and WebP from their leading bytes', () => {
    expect(sniffAvatarType(PNG)).toBe('image/png')
    expect(sniffAvatarType(JPEG)).toBe('image/jpeg')
    expect(sniffAvatarType(WEBP)).toBe('image/webp')
  })

  it('refuses anything else, whatever it claims to be', () => {
    expect(sniffAvatarType(new TextEncoder().encode('<svg></svg>'))).toBeNull()
    expect(sniffAvatarType(new Uint8Array())).toBeNull()
  })
})

describe('avatarStorageKey', () => {
  it('names the owner, so a photo row can only point at its own photo', () => {
    expect(avatarStorageKey(ME)).toMatch(/^avatars\/user-1\/[0-9a-f]{32}$/)
  })
})

describe('handleMyAvatar', () => {
  it('needs a signed-in user', async () => {
    const { storage } = memoryStorage()
    const response = await handleMyAvatar(put(PNG), signedOut, storage)
    expect(response.status).toBe(401)
  })

  it('stores the photo, saves its key and removes the one it replaces', async () => {
    const { storage, objects } = memoryStorage()
    objects.set('avatars/user-1/old', PNG)
    rpcReply = { status: 200, body: 'avatars/user-1/old' }

    const response = await handleMyAvatar(put(WEBP), signedIn, storage)

    expect(response.status).toBe(200)

    const [call] = rpcCalls

    expect(call.name).toBe('set_my_photo')
    expect(call.args['p_media_type']).toBe('image/webp')
    expect([...objects.keys()]).toEqual([call.args['p_storage_key']])
  })

  it('refuses a file that is not an image', async () => {
    const { storage, objects } = memoryStorage()
    const response = await handleMyAvatar(put('<svg/>'), signedIn, storage)
    expect(response.status).toBe(415)
    expect(objects.size).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  it('refuses a photo over the cap', async () => {
    const { storage } = memoryStorage()
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1)
    big.set(PNG)
    const response = await handleMyAvatar(put(big), signedIn, storage)
    expect(response.status).toBe(413)
  })

  it('drops the new bytes when the database refuses the change', async () => {
    const { storage, objects } = memoryStorage()
    rpcReply = { status: 403, body: { message: 'no' } }
    const response = await handleMyAvatar(put(PNG), signedIn, storage)
    expect(response.status).toBe(403)
    expect(objects.size).toBe(0)
  })

  it('removes the photo on DELETE', async () => {
    const { storage, objects } = memoryStorage()
    objects.set('avatars/user-1/old', PNG)
    rpcReply = { status: 200, body: 'avatars/user-1/old' }

    const response = await handleMyAvatar(
      new Request('http://x/api/avatars/me', { method: 'DELETE' }),
      signedIn,
      storage,
    )

    expect(response.status).toBe(204)
    expect(rpcCalls).toEqual([
      { name: 'clear_my_photo', args: {}, token: 'token' },
    ])
    expect(objects.size).toBe(0)
  })
})

describe('handleAvatarDownload', () => {
  it('serves a photo the caller may see, as an image that is never sniffed', async () => {
    const { storage, objects } = memoryStorage()
    objects.set('avatars/user-2/abc', JPEG)
    rpcReply = {
      status: 200,
      body: [{ storage_key: 'avatars/user-2/abc', media_type: 'image/jpeg' }],
    }

    const response = await handleAvatarDownload(
      new Request('http://x/api/avatars/user-2'),
      'user-2',
      signedIn,
      storage,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)
  })

  it('answers 404 for someone without a photo or outside the workspace', async () => {
    const { storage } = memoryStorage()
    rpcReply = { status: 200, body: [] }

    const response = await handleAvatarDownload(
      new Request('http://x/api/avatars/user-9'),
      'user-9',
      signedIn,
      storage,
    )

    expect(response.status).toBe(404)
  })
})
