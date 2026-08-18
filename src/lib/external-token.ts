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
 *
 * API-07: Core Dataset / Sheet Instance / Notebook RPCs the product UI
 * already uses are mapped to canonical scopes. Unknown paths stay fail-closed.
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

interface TableAccess {
  read: Scope
  write?: Scope
}

/**
 * Table GET/HEAD → read scope. POST/PATCH/DELETE → write scope when the
 * table has one; otherwise fail closed. Schema catalogues are read-only on
 * the table path: authoring goes through RPCs that API-07 still denies.
 */
const TABLE_ACCESS: Record<string, TableAccess> = {
  projects: { read: 'projects:read', write: 'projects:write' },
  folders: { read: 'projects:read', write: 'projects:write' },
  records: { read: 'projects:read', write: 'projects:write' },
  blocks: { read: 'projects:read', write: 'projects:write' },
  record_links: { read: 'projects:read', write: 'projects:write' },
  revisions: { read: 'projects:read' },
  record_field_definitions: { read: 'projects:read', write: 'projects:write' },
  datasets: { read: 'datasets:read', write: 'datasets:write' },
  dataset_versions: { read: 'datasets:read' },
  sheet_instances: { read: 'sheets:read' },
  dataset_schema_definitions: { read: 'schema:read' },
  dataset_schema_versions: { read: 'schema:read' },
  dataset_schema_version_fields: { read: 'schema:read' },
  sheet_definitions: { read: 'schema:read' },
  sheet_definition_versions: { read: 'schema:read' },
  notebook_templates: { read: 'templates:read' },
  notebook_template_versions: { read: 'templates:read' },
}

/**
 * Product UI RPCs mapped to canonical scopes. Remainder of `api.*` stays
 * fail-closed. `sheets:write` never includes Sheet Definition authoring.
 * `datasets:*` never includes Dataset Schema Version authoring.
 */
const RPC_SCOPES: Record<string, Scope[]> = {
  create_project: ['projects:write'],
  create_record: ['projects:write'],
  create_record_with_blocks: ['projects:write'],
  update_block_payload: ['projects:write'],
  move_block: ['projects:write'],
  archive_record: ['projects:write'],
  restore_record: ['projects:write'],
  create_record_link: ['projects:write'],
  insert_block: ['projects:write'],
  delete_block: ['projects:write'],
  transition_record_status: ['projects:write'],
  instantiate_template: ['projects:write'],

  query_dataset_rows: ['datasets:read'],
  query_dataset_version_rows: ['datasets:read'],
  validate_dataset_row_batch: ['datasets:write'],
  commit_dataset_row_batch: ['datasets:write'],
  snapshot_dataset: ['datasets:write'],
  archive_dataset: ['datasets:write'],
  restore_dataset: ['datasets:write'],

  query_sheet_instance_rows: ['sheets:read'],
  read_sheet_instance_calculation_results: ['sheets:read'],
  resolve_sheet_instance_row_identity: ['sheets:read'],
  preview_sheet_instance_composition_adoption: ['sheets:read'],
  preview_sheet_materialization: ['sheets:read'],
  preview_sheet_instance_definition_upgrade: ['sheets:read'],
  create_sheet_instance: ['sheets:write'],
  create_sheet_instance_from_definition: ['sheets:write'],
  update_sheet_instance: ['sheets:write'],
  archive_sheet_instance: ['sheets:write'],
  restore_sheet_instance: ['sheets:write'],
  duplicate_sheet_instance: ['sheets:write'],
  mutate_sheet_instance_local_state: ['sheets:write'],
  mutate_sheet_instance_calculations: ['sheets:write'],
  insert_sheet_instance_block: ['sheets:write'],
  duplicate_sheet_instance_block: ['sheets:write'],
  apply_sheet_instance_composition_adoption: ['sheets:write'],
  materialize_sheet_instance: ['sheets:write'],
  apply_sheet_instance_definition_upgrade: ['sheets:write'],
  validate_sheet_record_batch: ['sheets:write'],

  search: ['projects:read'],
  search_sheet_records: ['models:read'],
  update_record_custom_fields: ['models:write'],
  create_and_link_sheet_record: ['models:write'],
  commit_sheet_record_batch: ['models:write'],

  preview_submission_digest: ['reviews:read'],
  run_revision_checks: ['reviews:read'],
  submit_record_revision: ['reviews:write'],

  instantiate_notebook_template_version: ['templates:write'],
  preview_notebook_template_upgrade: ['templates:read'],
  apply_notebook_template_upgrade: ['templates:write'],
}

const READ_METHODS = new Set(['GET', 'HEAD'])

function denyUnknown(): never {
  throw new ExternalTokenError(
    'insufficient_scope',
    'External credentials cannot access this resource.',
  )
}

/**
 * Maps an operation to every capability it needs. Unknown resources fail
 * closed: adding a PostgREST relation never silently exposes it to existing
 * credentials. Canonical row mutations need read as well as write because
 * PostgREST applies SELECT RLS while filtering and returning changed rows.
 */
export function requiredScopes(method: string, path: ProxyPath): Scope[] {
  if (path.kind === 'rpc') {
    if (!Object.hasOwn(RPC_SCOPES, path.resource)) denyUnknown()
    return RPC_SCOPES[path.resource]
  }

  if (!Object.hasOwn(TABLE_ACCESS, path.resource)) denyUnknown()
  const access = TABLE_ACCESS[path.resource]
  if (READ_METHODS.has(method)) return [access.read]
  if (!access.write) denyUnknown()
  return [access.write]
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
