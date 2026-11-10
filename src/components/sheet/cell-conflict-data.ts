import type { DataClient } from '#/lib/data-client'
import type { SheetInstanceState } from '#/lib/sheet-instance'

export type CellConflictState = 'open' | 'resolved'

type CellValue = SheetInstanceState['localValues'][string][string]

/** Wire shape of api.sheet_cell_conflicts. Values follow the local cell contract. */
export interface CellConflictRow {
  id: string
  sheet_instance_id: string
  row_key: string
  field_id: string
  local_value: CellValue
  local_author_user_id: string
  local_at: string
  remote_value: CellValue
  remote_author_user_id: string | null
  remote_at: string | null
  state: CellConflictState
  resolved_value: CellValue
  resolved_by_user_id: string | null
  resolved_at: string | null
  reason: string | null
}

export const CONFLICT_REASON_MAX = 2000

export function fetchCellConflicts(
  client: DataClient,
  instanceId: string,
  options: { state?: CellConflictState; limit?: number } = {},
): Promise<CellConflictRow[]> {
  const state = options.state ? `&state=eq.${options.state}` : ''
  const limit = options.limit ?? 50

  return client.list<CellConflictRow>(
    'sheet_cell_conflicts',
    `?sheet_instance_id=eq.${instanceId}${state}&order=created_at.desc&limit=${limit}`,
  )
}

export function resolveCellConflict(
  client: DataClient,
  conflictId: string,
  value: CellValue,
  reason: string,
): Promise<CellConflictRow> {
  return client.rpc<CellConflictRow>('resolve_cell_conflict', {
    p_conflict_id: conflictId,
    p_value: value,
    p_reason: reason,
  })
}

/** Interpret entered text without changing finite numbers or booleans to strings. */
export function parseEnteredValue(text: string): string | number | boolean {
  const trimmed = text.trim()

  if (trimmed === '') return ''

  if (trimmed === 'true') return true

  if (trimmed === 'false') return false
  const asNumber = Number(trimmed)

  if (Number.isFinite(asNumber)) return asNumber

  return trimmed
}
