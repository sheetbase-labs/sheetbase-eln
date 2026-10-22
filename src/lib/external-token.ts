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
 * API-07: Core Dataset / Sheet Instance RPCs the product UI already uses
 * are mapped to canonical scopes. Submit, sign, amend and revision checks
 * stay human-session-only. Unknown paths stay fail-closed.
 */
import { jwtVerify } from 'jose'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'

import type * as schema from '#/db/schema'
import { apiCredentials, workspaceMemberships } from '#/db/schema'
import type { ProxyPath } from '#/lib/postgrest-path'
import type { Scope } from '#/lib/api-credentials'

export type Db = NodePgDatabase<typeof schema>

/**
 * A service credential JWT: role `api_client`, no `sub`. RLS keys on the
 * workspace claim; attribution lands on *_credential_id columns.
 */
export interface ApiClientClaims {
  workspace_id: string
  credential_id: string
  scopes: Scope[]
  role: 'api_client'
}

/**
 * A personal token JWT: role `authenticated` with the creating member's real
 * `sub`, so it inherits member RLS (including GOV-01 viewer read-only) and
 * human attribution, under the same fail-closed allowlist and canonical
 * scopes. Has no `session_id`, so attestation RPCs that require a live human
 * session stay unusable.
 */
export interface PersonalClientClaims {
  workspace_id: string
  credential_id: string
  scopes: Scope[]
  sub: string
  kind: 'personal'
  role: 'authenticated'
}

export type ExternalClaims = ApiClientClaims | PersonalClientClaims

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
): Promise<ExternalClaims> {
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

  if (typeof payload !== 'object' || payload === null) {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  const p = payload as Record<string, unknown>
  const workspaceId = p.workspace_id
  const credentialId = p.credential_id
  const scopes = p.scopes
  const role = p.role

  if (
    typeof workspaceId !== 'string' ||
    typeof credentialId !== 'string' ||
    !Array.isArray(scopes) ||
    !scopes.every((s) => typeof s === 'string')
  ) {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  const base = {
    workspace_id: workspaceId,
    credential_id: credentialId,
    scopes: scopes as Scope[],
  }

  // Service credential: role api_client, no user identity.
  if (role === 'api_client') {
    return { ...base, role: 'api_client' }
  }

  // Personal token: role authenticated with the creator's sub and a kind
  // marker, so the proxy can tell it from a browser-session JWT.
  if (
    role === 'authenticated' &&
    p.kind === 'personal' &&
    typeof p.sub === 'string'
  ) {
    return { ...base, sub: p.sub, kind: 'personal', role: 'authenticated' }
  }

  throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
}

export interface TableAccess {
  read: Scope
  write?: Scope
}

/**
 * Table GET/HEAD → read scope. POST/PATCH/DELETE → write scope when the
 * table has one; otherwise fail closed. Schema catalogues are read-only on
 * the table path: authoring goes through RPCs that API-07 still denies.
 */
export const EXTERNAL_TABLE_ACCESS: Record<string, TableAccess> = {
  projects: { read: 'projects:read', write: 'projects:write' },
  folders: { read: 'projects:read' },
  records: { read: 'projects:read', write: 'projects:write' },
  blocks: { read: 'projects:read', write: 'projects:write' },
  record_links: { read: 'projects:read', write: 'projects:write' },
  revisions: { read: 'projects:read' },
  record_field_definitions: { read: 'projects:read' },
  // MDL-01: workspace-defined model identity (ADR-0051) is GET-only for API
  // keys; authoring is owner/session (`schema.edit`), never `api_client`.
  record_models: { read: 'projects:read' },
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
  webhook_subscriptions: { read: 'webhooks:read' },
  webhook_deliveries: { read: 'webhooks:read' },
  agent_operation_proposals: { read: 'agent_operations:read' },
  agent_operation_events: { read: 'agent_operations:read' },
  agent_workflows: { read: 'agent_operations:read' },
  agent_workflow_steps: { read: 'agent_operations:read' },
  agent_workflow_events: { read: 'agent_operations:read' },
  // Pipelines are readable by API keys: what a definition is, which versions
  // exist, and what every run did. Run logs can hold what a step printed.
  pipeline_definitions: { read: 'pipelines:read' },
  pipeline_definition_versions: { read: 'pipelines:read' },
  pipeline_runs: { read: 'pipelines:read' },
  pipeline_run_logs: { read: 'pipelines:read' },
  pipeline_run_outputs: { read: 'pipelines:read' },
}

/**
 * Product UI RPCs mapped to canonical scopes. Remainder of `api.*` stays
 * fail-closed. `sheets:write` never includes Sheet Definition authoring.
 * `datasets:*` never includes Dataset Schema Version authoring.
 */
export const EXTERNAL_RPC_SCOPES: Record<string, Scope[]> = {
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

  instantiate_notebook_template_version: ['templates:write'],
  preview_notebook_template_upgrade: ['templates:read'],
  apply_notebook_template_upgrade: ['templates:write'],

  create_webhook_subscription: ['webhooks:write'],
  update_webhook_subscription: ['webhooks:write'],
  delete_webhook_subscription: ['webhooks:write'],
  rotate_webhook_secret: ['webhooks:write'],
  list_webhook_deliveries: ['webhooks:read'],
  replay_webhook_delivery: ['webhooks:write'],
  replay_webhook_deliveries: ['webhooks:write'],
  get_webhook_endpoint_health: ['webhooks:read'],

  propose_agent_operation: ['agent_operations:write'],
  create_agent_workflow: ['agent_operations:write'],
  advance_agent_workflow: ['agent_operations:write'],
  report_agent_workflow_usage: ['agent_operations:write'],
  cancel_agent_workflow: ['agent_operations:write'],

  // Draft authoring only. A draft is the author's working copy; publishing a
  // version and starting a run remain human actions in the product.
  create_pipeline_definition_version: ['pipelines:write'],
  update_pipeline_definition_version_draft: ['pipelines:write'],
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
    if (!Object.hasOwn(EXTERNAL_RPC_SCOPES, path.resource)) denyUnknown()
    return EXTERNAL_RPC_SCOPES[path.resource]
  }

  if (!Object.hasOwn(EXTERNAL_TABLE_ACCESS, path.resource)) denyUnknown()
  const access = EXTERNAL_TABLE_ACCESS[path.resource]
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
  const claims = await verifyExternalCredential(db, token, secret)

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

/**
 * Verifies the bearer token and that its credential is still live (not
 * revoked or expired, and for personal tokens the creator still an active
 * member). Scope enforcement is left to the caller: the /api/db proxy maps a
 * method + path to scopes, byte routes such as instrument pickup name theirs.
 */
export async function verifyExternalCredential(
  db: Db,
  token: string,
  secret: string,
): Promise<ExternalClaims> {
  const claims = await verifyApiClientToken(token, secret)

  const row = await db.query.apiCredentials.findFirst({
    where: eq(apiCredentials.id, claims.credential_id),
  })

  if (!row || row.revokedAt) {
    throw new ExternalTokenError('revoked', 'Credential has been revoked.')
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new ExternalTokenError('revoked', 'Credential has expired.')
  }

  // The token is authoritative for workspace_id (the exchange minted it after
  // verifying the credential), but double-check it matches the credential's
  // workspace to defend against a misconfigured or tampered claim.
  if (row.workspaceId !== claims.workspace_id) {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  // `kind` is NOT NULL DEFAULT 'service' (drizzle/0123_api_02_personal_tokens.sql);
  // the cast narrows the text column to the checked union.
  const kind = row.kind as 'service' | 'personal'

  // A personal token must present the creator's identity to the PostgREST
  // request role and remain usable only while that membership is active.
  // This mirrors the exchange-time check, so revoking a membership stops the
  // token at use time even against a still-unexpired JWT.
  if (kind === 'personal') {
    if (claims.role !== 'authenticated' || claims.sub !== row.createdByUserId) {
      throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
    }
    const membership = await db.query.workspaceMemberships.findFirst({
      where: and(
        eq(workspaceMemberships.userId, row.createdByUserId),
        eq(workspaceMemberships.workspaceId, row.workspaceId),
      ),
    })
    if (!membership || membership.suspendedAt) {
      throw new ExternalTokenError(
        'revoked',
        'Credential is not currently usable.',
      )
    }
  } else if (claims.role !== 'api_client') {
    throw new ExternalTokenError('invalid_token', 'Invalid bearer token.')
  }

  return claims
}

/** Extracts a bearer token from an Authorization header, or null. */
export function readBearerToken(headers: Headers): string | null {
  const header = headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
