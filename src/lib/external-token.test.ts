// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { SignJWT } from 'jose'

import {
  ExternalTokenError,
  hasScope,
  readBearerToken,
  requiredScopes,
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

describe('requiredScopes', () => {
  it('requires projects:read for GET on a table', () => {
    expect(requiredScopes('GET', tablePath)).toEqual(['projects:read'])
  })

  it('requires projects:write for POST on a table', () => {
    expect(requiredScopes('POST', tablePath)).toEqual(['projects:write'])
  })

  it('requires projects:write for an RPC (create_project is a write)', () => {
    expect(requiredScopes('POST', rpcPath)).toEqual(['projects:write'])
  })

  it('classifies scientific metadata, rows, bulk edits and schema RPCs', () => {
    const resource = `sheet_${'a'.repeat(26)}`
    expect(requiredScopes('GET', { kind: 'table', resource })).toEqual([
      'scientific:read',
    ])
    expect(requiredScopes('POST', { kind: 'table', resource })).toEqual([
      'scientific:write',
    ])
    expect(requiredScopes('PATCH', { kind: 'table', resource })).toEqual([
      'scientific:read',
      'scientific:write',
    ])
    for (const metadata of [
      'formula_definitions',
      'formula_dependencies',
      'formula_results',
    ])
      expect(
        requiredScopes('GET', { kind: 'table', resource: metadata }),
      ).toEqual(['scientific:read'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'scientific_table_metadata',
      }),
    ).toEqual(['scientific:read'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'apply_scientific_row_edits',
      }),
    ).toEqual(['scientific:read', 'scientific:write'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'apply_scientific_row_changes',
      }),
    ).toEqual(['scientific:read', 'scientific:write'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'bind_legacy_sheet',
      }),
    ).toEqual(['scientific:schema'])
    expect(() =>
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'add_scientific_column',
      }),
    ).toThrow(ExternalTokenError)
    expect(() =>
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'create_dataset_schema',
      }),
    ).toThrow(ExternalTokenError)
    expect(() =>
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'update_scientific_table_display',
      }),
    ).toThrow(ExternalTokenError)
  })

  it('fails closed for unknown external resources', () => {
    expect(() =>
      requiredScopes('GET', { kind: 'table', resource: 'change_events' }),
    ).toThrow(ExternalTokenError)
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
