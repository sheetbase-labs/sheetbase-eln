import { z } from 'zod'

import type { DataClient } from './data-client'

/**
 * A deviation from a pinned protocol step. The row itself is written by the
 * database when the step's text is rewritten; a person adds the reason through
 * `record_protocol_deviation_reason`.
 */
export const protocolDeviationSchema = z.object({
  id: z.uuid(),
  record_id: z.uuid(),
  block_id: z.uuid(),
  protocol_version_id: z.uuid().nullable(),
  frozen_text: z.string(),
  recorded_text: z.string(),
  reason: z.string().nullable(),
  reason_by_user_id: z.string().nullable(),
  reason_at: z.string().nullable(),
  created_by_user_id: z.string().nullable(),
  created_at: z.string(),
})

export type ProtocolDeviation = z.infer<typeof protocolDeviationSchema>

const SELECT =
  'id,record_id,block_id,protocol_version_id,frozen_text,recorded_text,reason,reason_by_user_id,reason_at,created_by_user_id,created_at'

/** Deviations of one step, newest first. */
export async function fetchStepDeviations(
  client: DataClient,
  blockId: string,
): Promise<ProtocolDeviation[]> {
  const rows = await client.list<unknown>(
    'protocol_deviations',
    `?block_id=eq.${z.uuid().parse(blockId)}&select=${SELECT}&order=created_at.desc,id.desc`,
  )
  return z.array(protocolDeviationSchema).parse(rows)
}

export const DEVIATION_REASON_MAX = 2000

/** Trimmed reason within 1..2000, or null when it would be refused. */
export function normaliseDeviationReason(value: string): string | null {
  const reason = value.trim()
  return reason.length >= 1 && reason.length <= DEVIATION_REASON_MAX
    ? reason
    : null
}

export async function recordDeviationReason(
  client: DataClient,
  deviationId: string,
  reason: string,
): Promise<ProtocolDeviation> {
  const clean = normaliseDeviationReason(reason)
  if (!clean) throw new Error('Say why the step was done differently.')
  const row = await client.rpc<unknown>('record_protocol_deviation_reason', {
    p_deviation_id: z.uuid().parse(deviationId),
    p_reason: clean,
  })
  return protocolDeviationSchema.parse(row)
}

/** A step copied from a protocol keeps the ids that tie it to the frozen text. */
export function isPinnedProtocolStep(payload: Record<string, unknown>) {
  return (
    typeof payload.sourceProtocolRevisionId === 'string' &&
    typeof payload.sourceStepBlockId === 'string'
  )
}
