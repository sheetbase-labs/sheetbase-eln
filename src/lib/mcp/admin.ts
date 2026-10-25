import { z } from 'zod'

import type { AiContextActor } from '../ai-context'
import type { DataClient } from '../data-client'

/**
 * MCP administration read surface.
 *
 * Every call is a personal-token read: a service credential is refused, the
 * caller must hold `admin:read`, and the caller's current workspace role must
 * be owner, admin or steward. PostgreSQL RLS still bounds each table; this is
 * an additional gate, not a replacement for RLS.
 *
 * Reads are deliberately bounded and metadata-only where the underlying row
 * may carry sensitive content (no file text, no pipeline parameters/results,
 * no credential hashes).
 */

export const ADMIN_READ_TOOL_NAME = 'sheetbase.admin.read'

export const ADMIN_RESOURCES = [
  'workspace',
  'members',
  'credentials',
  'connectors',
  'pipeline_runs',
  'files',
  'comments',
  'audit',
  'usage',
] as const

export type AdminResource = (typeof ADMIN_RESOURCES)[number]

export const adminReadSchema = z
  .object({
    resource: z.enum(ADMIN_RESOURCES),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(10_000).default(0),
    /** Required only for `comments`; scopes the read to one record. */
    recordId: z.string().uuid().optional(),
  })
  .strict()

export type AdminReadInput = z.infer<typeof adminReadSchema>

export interface AdminReadContext {
  workspaceId: string
  actor: AiContextActor
  client: DataClient
}

interface MemberRow {
  user_id: string
  name: string
  role: string
  client_id: string | null
  client_name: string | null
}

const ADMIN_ROLES = new Set(['owner', 'admin', 'steward'])

export function adminReadTool() {
  return {
    name: ADMIN_READ_TOOL_NAME,
    description:
      'Read workspace administration metadata: workspace settings and counts, members, credential metadata (owner only), connectors, recent pipeline runs, file metadata, comments, audit events and usage counts. Personal token only; the workspace MCP administration-read flag, and an owner, admin or steward role, are required.',
    inputSchema: z.toJSONSchema(adminReadSchema, { io: 'input' }),
    annotations: {
      title: 'Read workspace administration',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }
}

function pageQuery(input: AdminReadInput): string {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit)))
  const offset = Math.max(0, Math.floor(input.offset))
  return `&order=created_at.desc&limit=${limit}&offset=${offset}`
}

async function workspaceCounts(
  client: DataClient,
  memberCount: number,
): Promise<Record<string, number>> {
  const [records, datasets, files, connectors, pipelineRuns] =
    await Promise.all([
      client.count('records', '?deleted_at=is.null&archived_at=is.null'),
      client.count('datasets', '?archived_at=is.null'),
      client.count('file_objects', '?deleted_at=is.null'),
      client.count('connectors'),
      client.count('pipeline_runs'),
    ])
  return {
    members: memberCount,
    records,
    datasets,
    files,
    connectors,
    pipelineRuns,
  }
}

export async function readAdminResource(
  input: AdminReadInput,
  context: AdminReadContext,
): Promise<Record<string, unknown>> {
  if (context.actor.kind !== 'user') {
    throw new Error('Administration reads require a personal token.')
  }

  // The RPC is member-readable and returns the caller's workspace members.
  // Finding the caller by id is the role check; a member without a row is
  // treated as not a member.
  const members = await context.client.rpc<MemberRow[]>(
    'workspace_members_list',
    {},
  )
  const me = members.find((member) => member.user_id === context.actor.id)
  if (!me || !ADMIN_ROLES.has(me.role)) {
    throw new Error('Workspace owner, admin or steward role required.')
  }

  switch (input.resource) {
    case 'workspace': {
      const settings = await context.client.list<Record<string, unknown>>(
        'workspace_settings',
        `?select=workspace_id,registration_mode,review_workflow_enabled,audit_retention_days,site,timezone,date_format,number_format,publication_approval_required,require_change_reason,lock_on_sign,allow_offline_editing,ai_enabled,ai_provider_profile,ai_model,ai_cloud_egress_enabled,ai_max_tokens_per_call,ai_max_cost_microusd_per_call,ai_feature_flags,updated_at&workspace_id=eq.${encodeURIComponent(context.workspaceId)}&limit=1`,
      )
      return {
        resource: input.resource,
        settings: settings[0] ?? null,
        counts: await workspaceCounts(context.client, members.length),
      }
    }
    case 'members':
      return { resource: input.resource, items: members }
    case 'credentials': {
      if (me.role !== 'owner') {
        throw new Error('Only a workspace owner can read credential metadata.')
      }
      const items = await context.client.rpc<unknown[]>(
        'agent_admin_credentials',
        {},
      )
      return { resource: input.resource, items }
    }
    case 'connectors': {
      const items = await context.client.list<Record<string, unknown>>(
        'connectors',
        `?select=id,key,name,connector_type,direction,status,parser_id,created_at,updated_at${pageQuery(input)}`,
      )
      return { resource: input.resource, items }
    }
    case 'pipeline_runs': {
      const items = await context.client.list<Record<string, unknown>>(
        'pipeline_runs',
        `?select=id,definition_version_id,schedule_id,trigger_kind,status,attempt,error_code,error_message,started_at,finished_at,created_at${pageQuery(input)}`,
      )
      return { resource: input.resource, items }
    }
    case 'files': {
      const items = await context.client.list<Record<string, unknown>>(
        'file_objects',
        `?select=id,record_id,display_name,media_type,byte_size,status,created_at,deleted_at${pageQuery(input)}`,
      )
      return { resource: input.resource, items }
    }
    case 'comments': {
      if (!input.recordId) {
        throw new Error('comments reads require recordId.')
      }
      const items = await context.client.list<Record<string, unknown>>(
        'comments',
        `?select=id,record_id,sheet_instance_id,root_id,parent_id,target_kind,state,author_user_id,body,created_at,updated_at&record_id=eq.${encodeURIComponent(input.recordId)}${pageQuery(input)}`,
      )
      return { resource: input.resource, recordId: input.recordId, items }
    }
    case 'audit': {
      const items = await context.client.list<Record<string, unknown>>(
        'change_events',
        `?select=id,sequence,entity_type,entity_uuid,operation,record_id,project_id,actor_user_id,actor_credential_id,created_at${pageQuery(input)}`,
      )
      return { resource: input.resource, items }
    }
    case 'usage':
      return {
        resource: input.resource,
        counts: await workspaceCounts(context.client, members.length),
      }
  }
}
