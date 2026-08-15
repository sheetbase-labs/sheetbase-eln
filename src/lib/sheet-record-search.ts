/**
 * CORE-04.3 Model-scoped Sheet Record search.
 *
 * Bounded, server-backed search for Record-reference cells. Results are
 * Model-scoped and RLS-filtered. Exact Record ID ranks first. This is not a
 * full registry load and does not create notebook `record_link` rows.
 */
import type { DataClient } from './data-client'
import { createDataClient } from './data-client'

export const SHEET_RECORD_SEARCH_LIMIT = 50

export interface SheetRecordSearchHit {
  id: string
  kind: string
  identifier: string
  title: string
  status: string
  archived: boolean
}

export function searchSheetRecords(
  input: {
    modelKey: string
    query: string
    limit?: number
    includeArchived?: boolean
  },
  client: DataClient = createDataClient(),
): Promise<SheetRecordSearchHit[]> {
  return client.rpc<SheetRecordSearchHit[]>('search_sheet_records', {
    p_model_key: input.modelKey,
    p_query: input.query,
    p_limit: Math.min(
      Math.max(input.limit ?? 25, 1),
      SHEET_RECORD_SEARCH_LIMIT,
    ),
    p_include_archived: input.includeArchived ?? false,
  })
}
