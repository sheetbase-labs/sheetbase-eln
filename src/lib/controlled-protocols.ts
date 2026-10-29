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
  change_summary: z
    .string()
    .nullable()
    .transform((value) => value ?? ''),
  created_by_user_id: z.string(),
  created_at: z.iso.datetime({ offset: true }),
})

export type ProtocolVersion = z.infer<typeof protocolVersionSchema>

export const protocolAcknowledgementSchema = z.object({
  protocol_version_id: z.uuid(),
  user_id: z.string(),
  acknowledged_at: z.iso.datetime({ offset: true }),
  /** Set when someone else recorded the training, e.g. given in person. */
  recorded_by_user_id: z.string().nullish(),
  notes: z.string().nullish(),
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
    // The database function takes p_version_id (former migration 0328), not
    // p_protocol_version_id: naming it wrong makes PostgREST answer 404.
    p_version_id: z.uuid().parse(protocolVersionId),
  })
  return protocolAcknowledgementSchema.parse(row)
}

/**
 * LAB-07 / GOV-01 — whether the acting identity may acknowledge at all.
 * `api.acknowledge_protocol_version` gates on `api.is_workspace_writer`
 * (former migration 0335), the same capability the protocol start guard enforces. The
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
    reason?: string | null
  },
): Promise<ProtocolVersion> {
  const row = await client.rpc<unknown>('create_protocol_version', {
    p_protocol_record_id: z.uuid().parse(input.protocolRecordId),
    p_change_summary: input.changeSummary,
    p_reason: input.reason ?? null,
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

/** Where one person stands on a protocol, read from their acknowledgements. */
export const protocolTrainingStatusSchema = z.object({
  protocol_record_id: z.uuid(),
  user_id: z.string(),
  status: z.enum([
    'no_effective_version',
    'trained',
    'out_of_date',
    'required',
  ]),
  current_version_id: z.uuid().nullable(),
  current_version: z.number().nullable(),
  trained_version: z.number().nullable(),
  trained_at: z.string().nullable(),
  recorded_by_user_id: z.string().nullable(),
  due_at: z.string().nullable(),
  notes: z.string().nullable(),
  overdue: z.boolean().nullable(),
})

export type ProtocolTrainingStatus = z.infer<
  typeof protocolTrainingStatusSchema
>

export const protocolTrainingKey = (protocolRecordId: string) =>
  ['ui-port', 'protocol-training', protocolRecordId] as const

export async function fetchProtocolTrainingStatus(
  client: DataClient,
  protocolRecordId: string,
): Promise<ProtocolTrainingStatus[]> {
  const id = z.uuid().parse(protocolRecordId)
  const rows = await client.list<unknown>(
    'protocol_training_status',
    `?protocol_record_id=eq.${id}&order=user_id.asc`,
  )
  return z.array(protocolTrainingStatusSchema).parse(rows)
}

/** Put a member on the protocol's roster, optionally by a date. */
export async function assignProtocolTraining(
  client: DataClient,
  input: {
    protocolRecordId: string
    userId: string
    dueAt?: string | null
    notes?: string
  },
): Promise<void> {
  await client.rpc('assign_protocol_training', {
    p_protocol_record_id: z.uuid().parse(input.protocolRecordId),
    p_user_id: input.userId,
    p_due_at: input.dueAt || null,
    p_notes: input.notes?.trim() || null,
  })
}

export async function unassignProtocolTraining(
  client: DataClient,
  input: { protocolRecordId: string; userId: string },
): Promise<void> {
  await client.rpc('unassign_protocol_training', {
    p_protocol_record_id: z.uuid().parse(input.protocolRecordId),
    p_user_id: input.userId,
  })
}

/** Training given in person: the acknowledgement is theirs, the trainer is named. */
export async function recordProtocolTrained(
  client: DataClient,
  input: { versionId: string; userId: string; notes?: string },
): Promise<void> {
  await client.rpc('record_protocol_trained', {
    p_version_id: z.uuid().parse(input.versionId),
    p_user_id: input.userId,
    p_notes: input.notes?.trim() || null,
  })
}
