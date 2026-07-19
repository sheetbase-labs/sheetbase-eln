// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { jwtVerify } from 'jose'

import { mintPostgrestToken } from './postgrest-token'

const SECRET = 'test-secret-with-at-least-thirty-two-characters-in-it'

async function decode(token: string) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET))
  return payload
}

describe('mintPostgrestToken', () => {
  it('mints a short-lived JWT with the minimal claim set', async () => {
    const token = await mintPostgrestToken(SECRET, {
      userId: 'user-1',
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
    })
    const claims = await decode(token)
    expect(claims.sub).toBe('user-1')
    expect(claims.workspace_id).toBe('ws-1')
    expect(claims.session_id).toBe('sess-1')
    expect(claims.role).toBe('authenticated')
    // No client_id when none was provided.
    expect(claims.client_id).toBeUndefined()
    expect(claims.iat).toBeTypeOf('number')
    expect(claims.exp).toBeTypeOf('number')
  })

  it('includes client_id when provided (LIVE-003)', async () => {
    const token = await mintPostgrestToken(SECRET, {
      userId: 'user-1',
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
      clientId: 'tab-abc',
    })
    const claims = await decode(token)
    expect(claims.client_id).toBe('tab-abc')
  })

  it('omits client_id when null or empty', async () => {
    const a = await decode(
      await mintPostgrestToken(SECRET, {
        userId: 'u',
        workspaceId: 'w',
        sessionId: 's',
        clientId: null,
      }),
    )
    expect(a.client_id).toBeUndefined()

    const b = await decode(
      await mintPostgrestToken(SECRET, {
        userId: 'u',
        workspaceId: 'w',
        sessionId: 's',
        clientId: '',
      }),
    )
    expect(b.client_id).toBeUndefined()
  })
})
