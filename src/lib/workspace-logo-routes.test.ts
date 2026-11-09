import { describe, expect, it, vi } from 'vitest'

import type { ObjectStorage } from '#/lib/file-storage'

import {
  LOGO_MAX_BYTES,
  handleLogoDownload,
  handleLogoWrite,
  logoStorageKey,
  sniffLogoType,
} from './workspace-logo-routes'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
)

// The request helpers reach for the database at import; the route logic under
// test only needs to know whether there is a session.
vi.mock('#/lib/request-auth', () => ({
  resolveSessionAuth: (_headers: Headers, deps: { signedIn: boolean }) =>
    Promise.resolve(
      deps.signedIn
        ? {
            ok: true,
            context: {
              userId: 'u1',
              workspaceId: 'w1',
              sessionId: 's1',
              token: 'token',
            },
          }
        : {
            ok: false,
            status: 401,
            code: 'unauthenticated',
            message: 'Sign in.',
          },
    ),
  postgrestRpc: () => Promise.resolve({ status: 200, body: null }),
  requestErrorResponse: (status: number, code: string, message: string) =>
    new Response(JSON.stringify({ code, message }), { status }),
}))

vi.mock('#/lib/logger', () => ({
  logger: { warn: () => undefined, info: () => undefined },
}))

const signedIn = { signedIn: true } as never
const signedOut = { signedIn: false } as never

const storage = {
  head: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
} as unknown as ObjectStorage

const put = (body: Uint8Array) =>
  new Request('http://app/api/workspace-logo', {
    method: 'PUT',
    body: body as BodyInit,
  })

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
