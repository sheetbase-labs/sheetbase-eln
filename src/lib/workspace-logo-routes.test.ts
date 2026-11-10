// @vitest-environment node
/**
 * The lab logo's byte routes: what they sniff from the bytes, what key they
 * store under, and which requests they refuse.
 *
 * The routes and the auth/error helpers are the real ones. Only the two seams
 * the routes already take are supplied: the session deps and the object store.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ObjectStorage } from '#/lib/file-storage'
import type { SessionAuthDeps } from '#/lib/request-auth'

import {
  LOGO_MAX_BYTES,
  handleLogoDownload,
  handleLogoWrite,
  logoStorageKey,
  sniffLogoType,
} from './workspace-logo-routes'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
)

/** A signed-in session in workspace `w1`, or nobody signed in. */
function authDeps(signedIn: boolean): SessionAuthDeps {
  return {
    getSession: async () =>
      signedIn ? { user: { id: 'u1' }, session: { id: 's1' } } : null,
    getWorkspaceForUser: async () => ({ id: 'w1' }),
    mintToken: async () => 'token',
  }
}

const signedIn = authDeps(true)
const signedOut = authDeps(false)

/** An in-memory object store: the routes' storage seam, with real behaviour. */
function memoryStorage(): ObjectStorage {
  const objects = new Map<string, Uint8Array>()

  return {
    putStream: async (storageKey, body) => {
      const reader = body.getReader()
      const parts: Uint8Array[] = []
      let byteSize = 0

      for (;;) {
        const { done, value } = await reader.read()

        if (done) break
        parts.push(value)
        byteSize += value.byteLength
      }

      const joined = new Uint8Array(byteSize)
      let offset = 0

      for (const part of parts) {
        joined.set(part, offset)
        offset += part.byteLength
      }

      objects.set(storageKey, joined)

      return { byteSize: BigInt(byteSize), checksum: '' }
    },
    getStream: async (storageKey) => {
      const bytes = objects.get(storageKey)

      if (!bytes) throw new Error(`No object at ${storageKey}.`)

      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
        byteSize: bytes.byteLength,
      }
    },
    head: async (storageKey) => {
      const bytes = objects.get(storageKey)

      return bytes ? { byteSize: bytes.byteLength } : null
    },
    delete: async (storageKey) => {
      objects.delete(storageKey)
    },
  }
}

const storage = memoryStorage()

function put(body: Uint8Array) {
  return new Request('http://app/api/workspace-logo', {
    method: 'PUT',
    body: body.slice(),
  })
}

describe('sniffLogoType', () => {
  it('reads PNG and JPEG from the bytes', () => {
    expect(sniffLogoType(PNG)).toBe('image/png')
    expect(sniffLogoType(JPEG)).toBe('image/jpeg')
  })
  it('refuses the rest, because a PDF cannot embed them', () => {
    expect(sniffLogoType(WEBP)).toBeNull()
    expect(sniffLogoType(SVG)).toBeNull()
    expect(sniffLogoType(new Uint8Array())).toBeNull()
  })
})

describe('logoStorageKey', () => {
  it('names the workspace so a row can only point at its own logo', () => {
    expect(logoStorageKey('w1')).toMatch(/^logos\/w1\/[0-9a-f]{32}$/)
  })
})

describe('handleLogoWrite', () => {
  it('needs a session', async () => {
    const response = await handleLogoWrite(put(PNG), signedOut, storage)
    expect(response.status).toBe(401)
  })
  it('refuses another method', async () => {
    const response = await handleLogoWrite(
      new Request('http://app/api/workspace-logo', { method: 'POST' }),
      signedIn,
      storage,
    )

    expect(response.status).toBe(405)
  })
  it('refuses a file that is not PNG or JPEG', async () => {
    const response = await handleLogoWrite(put(SVG), signedIn, storage)
    expect(response.status).toBe(415)
  })
  it('refuses a file that is too large', async () => {
    const big = new Uint8Array(LOGO_MAX_BYTES + 1)
    big.set(PNG)
    const response = await handleLogoWrite(put(big), signedIn, storage)
    expect(response.status).toBe(413)
  })
})

describe('handleLogoDownload', () => {
  it('answers 404 when there is no logo to show', async () => {
    const response = await handleLogoDownload(
      new Request('http://app/api/workspace-logo'),
      signedOut,
      storage,
      () => Promise.resolve(null),
    )

    expect(response.status).toBe(404)
  })
})
