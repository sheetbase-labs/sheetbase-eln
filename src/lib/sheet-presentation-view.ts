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
import { z } from 'zod'

import type { SheetPresentation } from './sheet-instance'

const jsonValue = z.json()

/** A value as browser storage hands it over: plain JSON, checked field by field. */
export type StoredJson = z.output<typeof jsonValue>

const storedPresentation = z.record(z.string(), jsonValue)

const PRESENTATION_DENSITIES = ['compact', 'standard', 'comfortable'] as const

const filterSchema = z.object({
  columnId: z.string(),
  operator: z.enum(['equals', 'not-equals', 'is-empty', 'is-not-empty']),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
})

const sortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(['asc', 'desc']),
})

export function sheetViewStorageKey(instanceId: string): string {
  return `sheetbase-sheet-view-v1:${instanceId}`
}

export interface StoredSheetView {
  savedAt: string
  presentation: StoredJson
}

function boundedIds(
  value: StoredJson | undefined,
  columnIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()

  for (const item of z.array(z.string()).catch([]).parse(value)) {
    if (!columnIds.has(item) || seen.has(item)) continue
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
  value: StoredJson | null,
  columnIds: ReadonlySet<string>,
): SheetPresentation | null {
  const stored = storedPresentation.safeParse(value)

  if (!stored.success) return null

  const fields = stored.data
  const columnOrder = boundedIds(fields.columnOrder, columnIds)
  const hiddenColumnIds = boundedIds(fields.hiddenColumnIds, columnIds)
  const hidden = new Set(hiddenColumnIds)
  const columnWidths: Record<string, number> = {}

  const widths = z
    .record(z.string(), z.number())
    .catch({})
    .parse(fields.columnWidths)

  for (const [id, width] of Object.entries(widths)) {
    if (!columnIds.has(id) || hidden.has(id) || !Number.isFinite(width))
      continue
    columnWidths[id] = Math.min(2_000, Math.max(40, Math.round(width)))
  }

  const frozenColumnCount = Math.min(
    512,
    z.number().int().positive().catch(0).parse(fields.frozenColumnCount),
  )

  const filters: SheetPresentation['filters'] = []

  for (const item of z.array(jsonValue).catch([]).parse(fields.filters)) {
    if (filters.length >= 32) break
    const parsed = filterSchema.safeParse(item)

    if (!parsed.success) continue
    const { columnId, operator, value: filterValue } = parsed.data

    if (!columnIds.has(columnId)) continue

    const needsValue = operator === 'equals' || operator === 'not-equals'

    if (needsValue) {
      if (filterValue === undefined) continue
      filters.push({ columnId, operator, value: filterValue })
    } else {
      filters.push({ columnId, operator })
    }
  }

  const sorts: SheetPresentation['sorts'] = []
  const seenSorts = new Set<string>()

  for (const item of z.array(jsonValue).catch([]).parse(fields.sorts)) {
    if (sorts.length >= 8) break
    const parsed = sortSchema.safeParse(item)

    if (!parsed.success) continue
    const { columnId, direction } = parsed.data

    if (!columnIds.has(columnId) || seenSorts.has(columnId)) continue
    seenSorts.add(columnId)
    sorts.push({ columnId, direction })
  }

  return {
    columnOrder,
    hiddenColumnIds,
    columnWidths,
    frozenColumnCount,
    density: z
      .enum(PRESENTATION_DENSITIES)
      .catch('standard')
      .parse(fields.density),
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
export function loadSheetView(
  instanceId: string,
  storage?: Storage,
): StoredJson | null {
  const resolved = resolveStorage(storage)

  if (!resolved) return null

  try {
    const raw = resolved.getItem(sheetViewStorageKey(instanceId))

    if (raw === null) return null

    const stored = z
      .object({ presentation: jsonValue.optional() })
      .safeParse(JSON.parse(raw))

    return stored.success ? (stored.data.presentation ?? null) : null
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
