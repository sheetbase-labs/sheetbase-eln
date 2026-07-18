// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { SignJWT } from 'jose'

import {
  ExternalTokenError,
  hasScope,
  readBearerToken,
  requiredScope,
  verifyApiClientToken,
} from './external-token'
import type { ProxyPath } from './postgrest-path'

const SECRET = 'test-secret-with-32-characters-minimum!!'

async function mint(claims: Record<string, unknown>): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(new TextEncoder().encode(SECRET))
}

const tablePath: ProxyPath = { kind: 'table', resource: 'projects' }
const rpcPath: ProxyPath = { kind: 'rpc', resource: 'create_project' }

describe('readBearerToken', () => {
  it('extracts a bearer token', () => {
    const headers = new Headers({ authorization: 'Bearer abc123' })
    expect(readBearerToken(headers)).toBe('abc123')
  })

  it('is case-insensitive on the scheme', () => {
    const headers = new Headers({ Authorization: 'bearer xyz' })
    expect(readBearerToken(headers)).toBe('xyz')
  })

  it('returns null when the header is missing or malformed', () => {
    expect(readBearerToken(new Headers())).toBeNull()
    expect(readBearerToken(new Headers({ authorization: 'abc123' }))).toBeNull()
    expect(
      readBearerToken(new Headers({ authorization: 'Basic abc' })),
    ).toBeNull()
  })
})

describe('requiredScope', () => {
  it('requires projects:read for GET on a table', () => {
    expect(requiredScope('GET', tablePath)).toBe('projects:read')
  })

  it('requires projects:write for POST on a table', () => {
    expect(requiredScope('POST', tablePath)).toBe('projects:write')
  })

  it('requires projects:write for an RPC (create_project is a write)', () => {
    expect(requiredScope('POST', rpcPath)).toBe('projects:write')
  })
})

describe('hasScope', () => {
  it('returns true when the required scope is present', () => {
    expect(hasScope(['projects:read', 'projects:write'], 'projects:read')).toBe(
      true,
    )
  })

  it('returns false when the required scope is missing', () => {
    expect(hasScope(['projects:read'], 'projects:write')).toBe(false)
  })
})

describe('verifyApiClientToken', () => {
  it('returns claims for a valid api_client token', async () => {
    const token = await mint({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      role: 'api_client',
    })
    const claims = await verifyApiClientToken(token, SECRET)
    expect(claims).toEqual({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      role: 'api_client',
    })
  })

  it('rejects a token with the wrong role', async () => {
    const token = await mint({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      role: 'authenticated',
    })
    await expect(verifyApiClientToken(token, SECRET)).rejects.toBeInstanceOf(
      ExternalTokenError,
    )
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await mint({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      role: 'api_client',
    })
    await expect(
      verifyApiClientToken(token, 'other-secret-32-characters-minimum!!'),
    ).rejects.toBeInstanceOf(ExternalTokenError)
  })

  it('rejects a token with missing claims', async () => {
    const token = await mint({ role: 'api_client' })
    await expect(verifyApiClientToken(token, SECRET)).rejects.toBeInstanceOf(
      ExternalTokenError,
    )
  })
})
