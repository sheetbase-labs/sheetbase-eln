/**
 * API-005 follow-up: the external bearer-token path. An external client
 * exchanges a credential at POST /api/token for a short-lived JWT (role
 * `api_client`, carrying workspace_id, credential_id and scopes). It then
 * sends that JWT as `Authorization: Bearer ...` to the same-origin
 * /api/db boundary.
 *
 * This module verifies the token, checks the credential has not been revoked
 * since it was minted (revocation takes effect immediately, not at the next
 * exchange), and enforces exact resource capabilities against the HTTP
 * method. The proxy calls `resolveExternalToken` and
 * forwards to PostgREST only when it returns a workspace id; PostgREST then
 * applies the api_client RLS policies for workspace isolation.
 */
import { jwtVerify } from 'jose'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import type * as schema from '#/db/schema'
import { apiCredentials } from '#/db/schema'
import type { ProxyPath } from '#/lib/postgrest-path'
import type { Scope } from '#/lib/api-credentials'

export type Db = NodePgDatabase<typeof schema>

export interface ApiClientClaims {
  workspace_id: string
  credential_id: string
  scopes: Scope[]
  role: 'api_client'
}

export type ExternalTokenErrorCode =
  'invalid_token' | 'revoked' | 'insufficient_scope'

export class ExternalTokenError extends Error {
  readonly code: ExternalTokenErrorCode
  constructor(code: ExternalTokenErrorCode, message: string) {
    super(message)
    this.name = 'ExternalTokenError'
    this.code = code
  }
}

/** Verifies the JWT signature and shape; returns the claims or throws. */
export async function verifyApiClientToken(
  token: string,
  secret: string,
): Promise<ApiClientClaims> {
  let payload: unknown
  try {
    const { payload: p } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    )
    payload = p
  } catch {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as { role?: unknown }).role !== 'api_client'
  ) {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  const p = payload as Record<string, unknown>
  const workspaceId = p.workspace_id
  const credentialId = p.credential_id
  const scopes = p.scopes

  if (
    typeof workspaceId !== 'string' ||
    typeof credentialId !== 'string' ||
    !Array.isArray(scopes) ||
    !scopes.every((s) => typeof s === 'string')
  ) {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  return {
    workspace_id: workspaceId,
    credential_id: credentialId,
    scopes: scopes as Scope[],
    role: 'api_client',
  }
}

const GENERATED_SHEET = /^sheet_[a-z2-7]{26}$/
const SCIENTIFIC_METADATA = new Set([
  'scientific_tables',
  'scientific_columns',
  'scientific_category_options',
  'formula_definitions',
  'formula_dependencies',
  'formula_results',
])
const SCIENTIFIC_SCHEMA_RPCS = new Set([
  'create_scientific_table',
  'update_scientific_table_display',
  'add_scientific_column',
  'update_scientific_column_display',
  'retire_scientific_column',
  'convert_scientific_column',
])
const PROJECT_DOMAIN_RESOURCES = new Set([
  'projects',
  'folders',
  'records',
  'blocks',
  'record_links',
  'revisions',
])
const PROJECT_DOMAIN_RPCS = new Set([
  'create_project',
  'create_record',
  'create_record_with_blocks',
  'update_block_payload',
  'move_block',
  'archive_record',
  'restore_record',
  'create_record_link',
  'insert_block',
  'delete_block',
])

/**
 * Maps an operation to every capability it needs. Unknown resources fail
 * closed: adding a PostgREST relation never silently exposes it to existing
 * credentials. Canonical row mutations need read as well as write because
 * PostgREST applies SELECT RLS while filtering and returning changed rows.
 */
export function requiredScopes(method: string, path: ProxyPath): Scope[] {
  if (path.kind === 'rpc') {
    if (PROJECT_DOMAIN_RPCS.has(path.resource)) return ['projects:write']
    if (path.resource === 'scientific_table_metadata') {
      return ['scientific:read']
    }
    if (
      path.resource === 'apply_scientific_row_edits' ||
      path.resource === 'apply_scientific_row_changes'
    ) {
      return ['scientific:read', 'scientific:write']
    }
    if (SCIENTIFIC_SCHEMA_RPCS.has(path.resource)) {
      return ['scientific:schema']
    }
    throw new ExternalTokenError(
      'insufficient_scope',
      'External credentials cannot access this resource.',
    )
  }

  if (PROJECT_DOMAIN_RESOURCES.has(path.resource)) {
    return [
      method === 'GET' || method === 'HEAD'
        ? 'projects:read'
        : 'projects:write',
    ]
  }
  if (
    SCIENTIFIC_METADATA.has(path.resource) ||
    GENERATED_SHEET.test(path.resource)
  ) {
    if (method === 'GET' || method === 'HEAD') return ['scientific:read']
    if (method === 'POST') return ['scientific:write']
    return ['scientific:read', 'scientific:write']
  }
  throw new ExternalTokenError(
    'insufficient_scope',
    'External credentials cannot access this resource.',
  )
}

/** True if the credential's scopes cover the required scope. */
export function hasScope(scopes: Scope[], required: Scope): boolean {
  return scopes.includes(required)
}

/**
 * Verifies the token, checks revocation at use time (so a revoked credential
 * fails immediately even with a still-unexpired token) and enforces scope.
 * Returns the workspace id the proxy should forward with. Throws
 * ExternalTokenError on any failure.
 */
export async function resolveExternalToken(
  db: Db,
  token: string,
  secret: string,
  method: string,
  path: ProxyPath,
): Promise<{ workspaceId: string }> {
  const claims = await verifyApiClientToken(token, secret)

  const row = await db.query.apiCredentials.findFirst({
    where: eq(apiCredentials.id, claims.credential_id),
  })

  if (!row || row.revokedAt) {
    throw new ExternalTokenError('revoked', 'Credential has been revoked.')
  }

  // The token is authoritative for workspace_id (the exchange minted it after
  // verifying the credential), but double-check it matches the credential's
  // workspace to defend against a misconfigured or tampered claim.
  if (row.workspaceId !== claims.workspace_id) {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  const required = requiredScopes(method, path)
  for (const scope of required) {
    if (!hasScope(claims.scopes, scope)) {
      throw new ExternalTokenError(
        'insufficient_scope',
        `Credential lacks scope: ${scope}`,
      )
    }
  }

  return { workspaceId: claims.workspace_id }
}

/** Extracts a bearer token from an Authorization header, or null. */
export function readBearerToken(headers: Headers): string | null {
  const header = headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
