import { z } from 'zod'

import type { DataClient } from './data-client'

/** A controlled version uses the immutable revisions.id as its identity. */
export const protocolVersionSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  protocol_record_id: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'in_review', 'effective', 'superseded', 'retired']),
  effective_at: z.iso.datetime({ offset: true }).nullable(),
  review_due_at: z.iso.datetime({ offset: true }).nullable(),
  change_summary: z.string(),
  created_by_user_id: z.string(),
  created_at: z.iso.datetime({ offset: true }),
})

export type ProtocolVersion = z.infer<typeof protocolVersionSchema>

export const protocolAcknowledgementSchema = z.object({
  protocol_version_id: z.uuid(),
  user_id: z.string(),
  acknowledged_at: z.iso.datetime({ offset: true }),
})

export type ProtocolAcknowledgement = z.infer<
  typeof protocolAcknowledgementSchema
>

export const PROTOCOL_REVISION_KIND = 'protocol_revision'

export async function fetchProtocolVersions(
  client: DataClient,
  protocolRecordId: string,
): Promise<ProtocolVersion[]> {
  const id = z.uuid().parse(protocolRecordId)
  const rows = await client.list<unknown>(
    'protocol_versions',
    `?protocol_record_id=eq.${id}&order=version.desc`,
  )
  return z.array(protocolVersionSchema).parse(rows)
}

export async function fetchProtocolAcknowledgements(
  client: DataClient,
  protocolVersionId: string,
): Promise<ProtocolAcknowledgement[]> {
  const id = z.uuid().parse(protocolVersionId)
  const rows = await client.list<unknown>(
    'protocol_acknowledgements',
    `?protocol_version_id=eq.${id}&order=acknowledged_at.asc,user_id.asc`,
  )
  return z.array(protocolAcknowledgementSchema).parse(rows)
}

/** The server stamps the human actor and time; no client-supplied user/date. */
export async function acknowledgeProtocolVersion(
  client: DataClient,
  protocolVersionId: string,
): Promise<ProtocolAcknowledgement> {
  const row = await client.rpc<unknown>('acknowledge_protocol_version', {
    // The database function takes p_version_id (drizzle/0328), not
    // p_protocol_version_id: naming it wrong makes PostgREST answer 404.
    p_version_id: z.uuid().parse(protocolVersionId),
  })
  return protocolAcknowledgementSchema.parse(row)
}

/**
 * LAB-07 / GOV-01 — whether the acting identity may acknowledge at all.
 * `api.acknowledge_protocol_version` gates on `api.is_workspace_writer`
 * (drizzle/0335), the same capability the protocol start guard enforces. The
 * surface asks that exact question so it never offers a control the server
 * would refuse; the RPC's disclosure-avoiding refusal wording is left intact
 * for the paths that still reach it.
 */
export async function fetchProtocolAcknowledgeWriter(
  client: DataClient,
  workspaceId: string,
): Promise<boolean> {
  const writer = await client.rpc('is_workspace_writer', {
    p_workspace_id: z.uuid().parse(workspaceId),
  })
  return z.boolean().parse(writer)
}

export async function createProtocolVersion(
  client: DataClient,
  input: {
    protocolRecordId: string
    changeSummary: string
    reviewDueAt: string | null
  },
): Promise<ProtocolVersion> {
  const row = await client.rpc<unknown>('create_protocol_version', {
    p_protocol_record_id: z.uuid().parse(input.protocolRecordId),
    p_change_summary: input.changeSummary,
    p_review_due_at: input.reviewDueAt,
  })
  return protocolVersionSchema.parse(row)
}

/** Approval is separate and uses the existing approval_requests RPCs. */
export async function setProtocolVersionStatus(
  client: DataClient,
  input: {
    protocolVersionId: string
    status: 'in_review' | 'effective' | 'retired'
    reason: string
    effectiveAt?: string
  },
): Promise<ProtocolVersion> {
  const row = await client.rpc<unknown>('set_protocol_version_status', {
    p_protocol_version_id: z.uuid().parse(input.protocolVersionId),
    p_status: input.status,
    p_reason: input.reason,
    p_effective_at: input.effectiveAt ?? null,
  })
  return protocolVersionSchema.parse(row)
}
