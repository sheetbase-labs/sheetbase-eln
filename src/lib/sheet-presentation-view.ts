/**
 * GRID-04 — saved working views for canonical Sheets.
 *
 * The whole presentation object (sorts, filters, freeze, hidden columns,
 * widths, order, density) is local working state. A saved view is one
 * presentation snapshot per Sheet Instance in localStorage, following the
 * Dataset Explorer's `DatasetViewSpec` pattern: persisted state is treated as
 * untrusted browser input and re-validated against the Sheet's active columns
 * before it can be restored, so stale or hand-edited storage cannot introduce
 * unknown columns, blow past the schema limits or smuggle in unexpected keys.
 *
 * Presentation is never scientific state: restoring a view changes only how
 * the grid is displayed, not the Dataset, the composed matrix semantics or
 * any analysis input.
 */
import type { SheetPresentation } from './sheet-instance'

export function sheetViewStorageKey(instanceId: string): string {
  return `sheetbase-sheet-view-v1:${instanceId}`
}

export interface StoredSheetView {
  savedAt: string
  presentation: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const PRESENTATION_DENSITIES = new Set(['compact', 'standard', 'comfortable'])

function boundedIds(value: unknown, columnIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !columnIds.has(item) || seen.has(item))
      continue
    seen.add(item)
    if (seen.size >= 512) break
  }
  return [...seen]
}

/**
 * Re-validate a persisted presentation against the Sheet's active columns and
 * the canonical limits. Anything unknown is dropped and out-of-range values
 * are clamped, so a restore can only ever produce a state the schema itself
 * would accept.
 */
export function sanitizeSheetPresentation(
  value: unknown,
  columnIds: ReadonlySet<string>,
): SheetPresentation | null {
  if (!isRecord(value)) return null
  const columnOrder = boundedIds(value.columnOrder, columnIds)
  const hiddenColumnIds = boundedIds(value.hiddenColumnIds, columnIds)
  const hidden = new Set(hiddenColumnIds)
  const columnWidths: Record<string, number> = {}
  if (isRecord(value.columnWidths)) {
    for (const [id, width] of Object.entries(value.columnWidths)) {
      if (!columnIds.has(id) || hidden.has(id)) continue
      if (typeof width !== 'number' || !Number.isFinite(width)) continue
      columnWidths[id] = Math.min(2_000, Math.max(40, Math.round(width)))
    }
  }
  const frozenRaw = value.frozenColumnCount
  const frozenColumnCount =
    typeof frozenRaw === 'number' &&
    Number.isInteger(frozenRaw) &&
    frozenRaw > 0
      ? Math.min(512, frozenRaw)
      : 0
  const filters: SheetPresentation['filters'] = []
  if (Array.isArray(value.filters)) {
    for (const item of value.filters) {
      if (filters.length >= 32) break
      if (!isRecord(item)) continue
      const columnId = item.columnId
      const operator = item.operator
      if (typeof columnId !== 'string' || !columnIds.has(columnId)) continue
      if (
        operator !== 'equals' &&
        operator !== 'not-equals' &&
        operator !== 'is-empty' &&
        operator !== 'is-not-empty'
      )
        continue
      const needsValue = operator === 'equals' || operator === 'not-equals'
      if (needsValue) {
        const filterValue = item.value
        if (
          filterValue !== null &&
          typeof filterValue !== 'string' &&
          typeof filterValue !== 'number' &&
          typeof filterValue !== 'boolean'
        )
          continue
        filters.push({ columnId, operator, value: filterValue })
      } else {
        filters.push({ columnId, operator })
      }
    }
  }
  const sorts: SheetPresentation['sorts'] = []
  if (Array.isArray(value.sorts)) {
    const seen = new Set<string>()
    for (const item of value.sorts) {
      if (sorts.length >= 8) break
      if (!isRecord(item)) continue
      const columnId = item.columnId
      const direction = item.direction
      if (typeof columnId !== 'string' || !columnIds.has(columnId)) continue
      if (direction !== 'asc' && direction !== 'desc') continue
      if (seen.has(columnId)) continue
      seen.add(columnId)
      sorts.push({ columnId, direction })
    }
  }
  return {
    columnOrder,
    hiddenColumnIds,
    columnWidths,
    frozenColumnCount,
    density:
      typeof value.density === 'string' &&
      PRESENTATION_DENSITIES.has(value.density)
        ? (value.density as SheetPresentation['density'])
        : 'standard',
    filters,
    sorts,
  }
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function saveSheetView(
  instanceId: string,
  presentation: SheetPresentation,
  storage?: Storage,
): void {
  const resolved = resolveStorage(storage)
  if (!resolved) return
  const stored: StoredSheetView = {
    savedAt: new Date().toISOString(),
    presentation,
  }
  try {
    resolved.setItem(sheetViewStorageKey(instanceId), JSON.stringify(stored))
  } catch {
    // Storage can be unavailable in private browsing or under a quota. The
    // current view still works; it simply cannot be saved for later.
  }
}

/** Raw persisted view (untrusted); sanitise before use. */
export function loadSheetView(instanceId: string, storage?: Storage): unknown {
  const resolved = resolveStorage(storage)
  if (!resolved) return null
  try {
    const raw = resolved.getItem(sheetViewStorageKey(instanceId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? (parsed.presentation ?? null) : null
  } catch {
    return null
  }
}

export function hasSavedSheetView(
  instanceId: string,
  storage?: Storage,
): boolean {
  return loadSheetView(instanceId, storage) !== null
}
