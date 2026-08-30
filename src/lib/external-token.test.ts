// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { decodeJwt, SignJWT } from 'jose'

import { mintPersonalApiToken } from './api-credentials'
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

  it('maps Dataset and Sheet catalogue tables to Core-domain scopes', () => {
    expect(
      requiredScopes('GET', { kind: 'table', resource: 'datasets' }),
    ).toEqual(['datasets:read'])
    expect(
      requiredScopes('POST', { kind: 'table', resource: 'datasets' }),
    ).toEqual(['datasets:write'])
    expect(
      requiredScopes('GET', { kind: 'table', resource: 'sheet_instances' }),
    ).toEqual(['sheets:read'])
    expect(() =>
      requiredScopes('POST', { kind: 'table', resource: 'sheet_instances' }),
    ).toThrow(ExternalTokenError)
  })

  it('denies table writes that api_client cannot complete', () => {
    expect(
      requiredScopes('GET', { kind: 'table', resource: 'folders' }),
    ).toEqual(['projects:read'])
    expect(
      requiredScopes('GET', {
        kind: 'table',
        resource: 'record_field_definitions',
      }),
    ).toEqual(['projects:read'])
    for (const resource of ['folders', 'record_field_definitions'] as const) {
      expect(() => requiredScopes('POST', { kind: 'table', resource })).toThrow(
        ExternalTokenError,
      )
      expect(() =>
        requiredScopes('PATCH', { kind: 'table', resource }),
      ).toThrow(ExternalTokenError)
    }
  })

  it('denies scientific-table and SCI-010 resources as insufficient_scope', () => {
    const resource = `sheet_${'a'.repeat(26)}`
    const denied = [
      { method: 'GET', path: { kind: 'table' as const, resource } },
      { method: 'POST', path: { kind: 'table' as const, resource } },
      { method: 'PATCH', path: { kind: 'table' as const, resource } },
      {
        method: 'GET',
        path: { kind: 'table' as const, resource: 'scientific_tables' },
      },
      {
        method: 'POST',
        path: { kind: 'rpc' as const, resource: 'bind_legacy_sheet' },
      },
      {
        method: 'POST',
        path: { kind: 'rpc' as const, resource: 'query_dataset' },
      },
      {
        method: 'POST',
        path: { kind: 'rpc' as const, resource: 'scientific_table_metadata' },
      },
      {
        method: 'POST',
        path: { kind: 'rpc' as const, resource: 'apply_scientific_row_edits' },
      },
      {
        method: 'POST',
        path: { kind: 'rpc' as const, resource: 'add_scientific_column' },
      },
    ]
    for (const { method, path } of denied) {
      expect(() => requiredScopes(method, path)).toThrow(ExternalTokenError)
      try {
        requiredScopes(method, path)
      } catch (error) {
        expect(error).toBeInstanceOf(ExternalTokenError)
        expect((error as ExternalTokenError).code).toBe('insufficient_scope')
      }
    }
  })

  it('fails closed for unknown external resources', () => {
    expect(() =>
      requiredScopes('GET', { kind: 'table', resource: 'change_events' }),
    ).toThrow(ExternalTokenError)
  })

  it('maps Core Dataset/Sheet/Notebook RPCs to canonical scopes (API-07)', () => {
    const allowed: Array<[string, string[]]> = [
      ['query_dataset_rows', ['datasets:read']],
      ['query_dataset_version_rows', ['datasets:read']],
      ['validate_dataset_row_batch', ['datasets:write']],
      ['commit_dataset_row_batch', ['datasets:write']],
      ['snapshot_dataset', ['datasets:write']],
      ['archive_dataset', ['datasets:write']],
      ['restore_dataset', ['datasets:write']],
      ['query_sheet_instance_rows', ['sheets:read']],
      ['create_sheet_instance', ['sheets:write']],
      ['mutate_sheet_instance_local_state', ['sheets:write']],
      ['mutate_sheet_instance_calculations', ['sheets:write']],
      ['insert_sheet_instance_block', ['sheets:write']],
      ['preview_submission_digest', ['reviews:read']],
      ['instantiate_notebook_template_version', ['templates:write']],
      ['search', ['projects:read']],
      ['search_sheet_records', ['models:read']],
      ['update_record_custom_fields', ['models:write']],
    ]
    for (const [resource, scopes] of allowed) {
      expect(requiredScopes('POST', { kind: 'rpc', resource })).toEqual(scopes)
    }
  })

  it('rejects Core writes when only the matching read scope is present', () => {
    const writes = [
      ['commit_dataset_row_batch', 'datasets:write'],
      ['mutate_sheet_instance_local_state', 'sheets:write'],
      ['instantiate_notebook_template_version', 'templates:write'],
      ['update_record_custom_fields', 'models:write'],
    ] as const
    for (const [resource, required] of writes) {
      const scopes = requiredScopes('POST', { kind: 'rpc', resource })
      expect(scopes).toEqual([required])
      expect(
        hasScope(['datasets:read', 'sheets:read', 'reviews:read'], required),
      ).toBe(false)
    }
  })

  it('does not let datasets:* or sheets:write author governed schema', () => {
    const stewardship = [
      'create_dataset_schema_definition',
      'replace_dataset_schema_version_fields',
      'publish_dataset_schema_version',
      'create_next_dataset_schema_version',
      'retire_dataset_schema_definition',
      'create_sheet_definition',
      'create_sheet_definition_version',
      'extract_sheet_definition_draft',
    ]
    for (const resource of stewardship) {
      expect(() => requiredScopes('POST', { kind: 'rpc', resource })).toThrow(
        ExternalTokenError,
      )
    }
    expect(
      requiredScopes('GET', { kind: 'table', resource: 'datasets' }),
    ).toEqual(['datasets:read'])
    expect(
      requiredScopes('GET', {
        kind: 'table',
        resource: 'dataset_schema_definitions',
      }),
    ).toEqual(['schema:read'])
    expect(() =>
      requiredScopes('POST', {
        kind: 'table',
        resource: 'dataset_schema_definitions',
      }),
    ).toThrow(ExternalTokenError)
    expect(() =>
      requiredScopes('POST', { kind: 'table', resource: 'sheet_definitions' }),
    ).toThrow(ExternalTokenError)
  })

  it('keeps still-private RPCs fail-closed', () => {
    const privateRpcs = [
      'create_notebook_template',
      'publish_notebook_template_version',
      'finalize_file_upload',
      'create_comment',
      'sign_revision',
      'submit_record_revision',
      'run_revision_checks',
      'create_amendment',
      'export_audit_log',
      'change_member_role',
      'create_booking',
      'query_dataset',
      'discover_object_dependencies',
      'list_capabilities',
      'create_and_activate_model_field',
    ]
    for (const resource of privateRpcs) {
      expect(() => requiredScopes('POST', { kind: 'rpc', resource })).toThrow(
        ExternalTokenError,
      )
    }
  })

  it('maps webhook tables and RPCs to canonical scopes', () => {
    expect(
      requiredScopes('GET', {
        kind: 'table',
        resource: 'webhook_subscriptions',
      }),
    ).toEqual(['webhooks:read'])
    expect(
      requiredScopes('GET', { kind: 'table', resource: 'webhook_deliveries' }),
    ).toEqual(['webhooks:read'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'create_webhook_subscription',
      }),
    ).toEqual(['webhooks:write'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'list_webhook_deliveries',
      }),
    ).toEqual(['webhooks:read'])
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'replay_webhook_delivery',
      }),
    ).toEqual(['webhooks:write'])
  })

  it('lets agents submit and inspect proposals without exposing decisions', () => {
    expect(
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'propose_agent_operation',
      }),
    ).toEqual(['agent_operations:write'])
    expect(
      requiredScopes('GET', {
        kind: 'table',
        resource: 'agent_operation_proposals',
      }),
    ).toEqual(['agent_operations:read'])
    expect(() =>
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'decide_agent_operation',
      }),
    ).toThrow(ExternalTokenError)
    expect(() =>
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'execute_agent_operation',
      }),
    ).toThrow(ExternalTokenError)
  })

  it('lets agents submit, inspect, advance, report, and cancel bounded workflows', () => {
    for (const resource of [
      'create_agent_workflow',
      'advance_agent_workflow',
      'report_agent_workflow_usage',
      'cancel_agent_workflow',
    ]) {
      expect(requiredScopes('POST', { kind: 'rpc', resource })).toEqual([
        'agent_operations:write',
      ])
    }
    for (const resource of [
      'agent_workflows',
      'agent_workflow_steps',
      'agent_workflow_events',
    ]) {
      expect(requiredScopes('GET', { kind: 'table', resource })).toEqual([
        'agent_operations:read',
      ])
    }
    expect(() =>
      requiredScopes('POST', {
        kind: 'rpc',
        resource: 'resume_agent_workflow',
      }),
    ).toThrow(ExternalTokenError)
  })

  it('does not grant scientific:* scopes access to vestigial metadata tables', () => {
    expect(() =>
      requiredScopes('GET', {
        kind: 'table',
        resource: 'formula_results',
      }),
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

  it('accepts a well-formed personal token and returns member claims', async () => {
    const token = await mint({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      sub: 'user-1',
      kind: 'personal',
      role: 'authenticated',
    })
    const claims = await verifyApiClientToken(token, SECRET)
    expect(claims).toEqual({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      sub: 'user-1',
      kind: 'personal',
      role: 'authenticated',
    })
  })

  it('rejects an authenticated token without the personal kind marker', async () => {
    // Browser-session JWT shape: role authenticated with a sub but no kind.
    const token = await mint({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      sub: 'user-1',
      role: 'authenticated',
    })
    await expect(verifyApiClientToken(token, SECRET)).rejects.toBeInstanceOf(
      ExternalTokenError,
    )
  })

  it('rejects a personal-kind token without a string sub', async () => {
    for (const sub of [undefined, 42]) {
      const claims: Record<string, unknown> = {
        workspace_id: 'ws-1',
        credential_id: 'cred-1',
        scopes: ['projects:read'],
        kind: 'personal',
        role: 'authenticated',
      }
      if (sub !== undefined) claims.sub = sub
      const token = await mint(claims)
      await expect(verifyApiClientToken(token, SECRET)).rejects.toBeInstanceOf(
        ExternalTokenError,
      )
    }
  })
})

describe('mintPersonalApiToken', () => {
  const input = {
    workspaceId: 'ws-1',
    credentialId: 'cred-1',
    userId: 'user-1',
    scopes: ['projects:read'],
  } satisfies Parameters<typeof mintPersonalApiToken>[1]

  it('round-trips personal claims through verifyApiClientToken', async () => {
    const token = await mintPersonalApiToken(SECRET, input)
    expect(await verifyApiClientToken(token, SECRET)).toEqual({
      workspace_id: 'ws-1',
      credential_id: 'cred-1',
      scopes: ['projects:read'],
      sub: 'user-1',
      kind: 'personal',
      role: 'authenticated',
    })
  })

  it('defaults to a 300 second TTL and honours ttlSeconds', async () => {
    const defaults = decodeJwt(await mintPersonalApiToken(SECRET, input))
    expect((defaults.exp as number) - (defaults.iat as number)).toBe(300)

    const custom = decodeJwt(
      await mintPersonalApiToken(SECRET, { ...input, ttlSeconds: 60 }),
    )
    expect((custom.exp as number) - (custom.iat as number)).toBe(60)
  })

  it('carries no session_id so attestation-gated RPCs stay unreachable', async () => {
    const claims = decodeJwt(await mintPersonalApiToken(SECRET, input))
    expect(claims).not.toHaveProperty('session_id')
  })
})
