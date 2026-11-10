/**
 * Lots of a registry entry: batches made from the registry's lot model and
 * linked back to the entry they are a lot of.
 */
import type { z } from 'zod'

import type { DataClient } from './data-client'

export interface RegistryLot {
  id: string
  identifier: string
  title: string
  kind: string
  custom_fields: Record<string, z.core.util.JSONType> | null
  created_at: string
  archived: boolean
}

/** Makes a lot of an entry; the registry's lot model says what kind of record it is. */
export async function addRegistryLot<T>(
  client: DataClient,
  input: {
    entryId: string
    projectId?: string
    title?: string
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a caller's model-declared JSONB detail is unparsed by design; the RPC's record guard validates it against the lot model before writing.
    customFields?: Record<string, unknown>
  },
): Promise<T> {
  return client.rpc<T>('add_compound_lot', {
    p_compound_id: input.entryId,
    p_project_id: input.projectId ?? null,
    p_title: input.title ?? null,
    p_custom_fields: input.customFields ?? {},
  })
}
