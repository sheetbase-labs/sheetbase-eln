import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { rowIdentityKey } from './row-identity'
import { projectBoundColumns } from './sheet-bound-columns'
import {
  parseSheetDefinitionConfiguration,
  sheetDefinitionUuidSchema as uuid,
} from './sheet-definition'
import type { SheetDefinitionConfiguration } from './sheet-definition'

const datasetSourceSchema = z
  .object({
    sourceKind: z.literal('dataset'),
    bindingId: uuid,
    datasetId: uuid,
    datasetRevision: z.number().int().positive(),
    rowId: uuid.nullable(),
    revision: z.number().int().nullable(),
    matched: z.boolean(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()

const recordSourceSchema = z
  .object({
    sourceKind: z.literal('record'),
    bindingId: uuid,
    recordId: uuid,
    metadataVersion: z.number().int().positive(),
    fieldNames: z.record(z.string(), z.string()),
    matched: z.literal(true),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()

const sourceSchema = z.discriminatedUnion('sourceKind', [
  datasetSourceSchema,
  recordSourceSchema,
])

export const composedSheetWireSchema = z
  .object({
    instanceId: uuid,
    definitionVersionId: uuid.optional(),
    definitionConfiguration: z.unknown().optional(),
    revision: z.number().int().positive(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(200),
    hasMore: z.boolean(),
    localFieldIds: z.array(uuid).max(256),
    identity: z
      .object({
        kind: z.enum(['source', 'composite', 'local']),
        columnIds: z.array(uuid).min(1).max(8),
        logicalTypes: z
          .array(
            z.enum([
              'text',
              'integer',
              'decimal',
              'boolean',
              'date',
              'timestamp',
              'category',
              'reference',
            ]),
          )
          .min(1)
          .max(8),
      })
      .strict(),
    rows: z.array(
      z
        .object({
          identityValues: z.array(z.unknown()).min(1).max(8),
          sources: z.array(sourceSchema).min(1).max(17),
        })
        .strict(),
    ),
  })
  .strict()

export type ComposedSheetRow = z.infer<
  typeof composedSheetWireSchema
>['rows'][number] & {
  rowKey: string
  compositionOffset?: number
}

export interface ComposedSheetSnapshot extends Omit<
  z.infer<typeof composedSheetWireSchema>,
  'definitionConfiguration' | 'rows'
> {
  definitionConfiguration?: SheetDefinitionConfiguration
  rows: ComposedSheetRow[]
  boundProjection?: ReturnType<typeof projectBoundColumns>
}

/**
 * Bounded server-authoritative composition with the pinned Definition's bound
 * column projection. Source rows remain available for existing CORE-03.6
 * consumers; the `boundProjection` adds canonical display metadata and value
 * provenance without adding a write path.
 */
export async function fetchComposedSheetRows(
  instanceId: string,
  options: { limit?: number; offset?: number } = {},
  client: DataClient = createDataClient(),
): Promise<ComposedSheetSnapshot> {
  const result = composedSheetWireSchema.parse(
    await client.rpc<unknown>('query_sheet_instance_rows', {
      p_instance_id: instanceId,
      p_limit: options.limit ?? 50,
      p_offset: options.offset ?? 0,
    }),
  )
  // All output rows use the Instance's immutable resolved identity spec. The
  // RPC returns only typed values; hashing remains exactly CORE-03.5's shared
  // implementation rather than duplicating its encoding in SQL.
  const rowKey = (
    row: z.infer<typeof composedSheetWireSchema>['rows'][number],
  ) => rowIdentityKey(result.identity, row.identityValues)
  const rows = result.rows.map((row) => ({
    ...row,
    rowKey: rowKey(row),
    compositionOffset: result.offset,
  }))
  const configuration = result.definitionConfiguration
    ? parseSheetDefinitionConfiguration(result.definitionConfiguration)
    : undefined
  const { definitionConfiguration: _, ...authoritative } = result
  return {
    ...authoritative,
    ...(configuration ? { definitionConfiguration: configuration } : {}),
    rows,
    ...(result.definitionVersionId && configuration
      ? {
          boundProjection: projectBoundColumns({
            definitionVersionId: result.definitionVersionId,
            configuration,
            rows,
          }),
        }
      : {}),
  }
}
/** GRID-05 — one server composition window. The server clamps a single
 * `query_sheet_instance_rows` window to this many rows; larger Sheets page
 * with offset/limit and merge windows (see `mergeComposedSheetSnapshots`). */
export const COMPOSED_SHEET_PAGE_SIZE = 200

/**
 * GRID-05 — merged pages must share one authoritative revision. Offset
 * paging is only stable within a single revision: a concurrent Dataset or
 * Record change that moves the Instance revision between page fetches would
 * silently duplicate or skip rows if windows from both revisions were
 * concatenated. `fetchComposedSheetPaged` pins the revision instead, so a
 * mixed-revision merge can never reach the grid.
 */
export interface ComposedSheetPagedSnapshot {
  /** Coherent single-revision merge of the loaded pages. */
  snapshot: ComposedSheetSnapshot
  /** Revision pinned by the first page every merged window agrees on. */
  pinnedRevision: number
  /** True when a mid-paging revision move forced a restart from offset 0. */
  restarted: boolean
  /** Visible status-bar notice for a restart; null when paging was coherent. */
  notice: string | null
  /** Page fetches performed by this call (linear in newly requested pages). */
  fetchedPages: number
}

/**
 * GRID-05 review fix — genuinely incremental paging with a revision/snapshot
 * boundary.
 *
 * `previous` is the already-merged snapshot covering `previousPageCount`
 * pages; only the missing windows are fetched (offset = pages already
 * loaded × page size), never pages 1..N again. The first page pins the
 * dataset revision; a later window that disagrees restarts paging from
 * offset 0 against the new revision with a visible notice, so the grid
 * either shows one coherent revision or says so. Restart is the correct
 * boundary (rather than freezing stale rows) because write-back commits
 * against `composition.revision` — a frozen snapshot would only produce
 * stale-revision rejections — and it reuses the established stale-revision
 * re-read pattern (re-read authoritative state, retry once). A second move
 * mid-restart returns the fresh first window coherently with the same
 * notice instead of looping.
 */
export async function fetchComposedSheetPaged(
  instanceId: string,
  options: {
    pageCount?: number
    pageSize?: number
    previous?: ComposedSheetSnapshot | null
    previousPageCount?: number
    fetchPage?: (
      offset: number,
      limit: number,
    ) => Promise<ComposedSheetSnapshot>
    client?: DataClient
    maxRestarts?: number
  } = {},
): Promise<ComposedSheetPagedSnapshot> {
  const pageCount = Math.max(1, Math.floor(options.pageCount ?? 1))
  const pageSize = options.pageSize ?? COMPOSED_SHEET_PAGE_SIZE
  const maxRestarts = options.maxRestarts ?? 1
  const client = options.client ?? createDataClient()
  const fetchPage =
    options.fetchPage ??
    ((offset: number, limit: number) =>
      fetchComposedSheetRows(instanceId, { offset, limit }, client))
  let fetchedPages = 0
  const pull = async (page: number): Promise<ComposedSheetSnapshot> => {
    fetchedPages += 1
    return fetchPage(page * pageSize, pageSize)
  }

  // A previous merge that already ran dry needs no fetch at all.
  if (options.previous && (options.previousPageCount ?? 0) >= pageCount) {
    return {
      snapshot: options.previous,
      pinnedRevision: options.previous.revision,
      restarted: false,
      notice: null,
      fetchedPages,
    }
  }
  if (
    options.previous &&
    (options.previousPageCount ?? 0) > 0 &&
    !options.previous.hasMore
  ) {
    return {
      snapshot: options.previous,
      pinnedRevision: options.previous.revision,
      restarted: false,
      notice: null,
      fetchedPages,
    }
  }

  const collect = async (
    wanted: number,
  ): Promise<{ pages: ComposedSheetSnapshot[]; pin: number }> => {
    const pages: ComposedSheetSnapshot[] = []
    for (let page = 0; page < wanted; page += 1) {
      const next = await pull(page)
      const pin = pages.at(0)?.revision
      if (pin !== undefined && next.revision !== pin) {
        throw { moved: true }
      }
      pages.push(next)
      if (!next.hasMore) break
    }
    const first = pages.at(0)
    if (!first) throw new Error('no pages')
    return { pages, pin: first.revision }
  }

  // Incremental path: the cached merge already covers previousPageCount
  // windows at its own revision — fetch only the missing window(s). A drift
  // here consumes the restart below, so the notice survives the handoff.
  let restarts = 0
  const cachedCount = Math.max(0, Math.floor(options.previousPageCount ?? 0))
  if (options.previous && cachedCount > 0) {
    const pin = options.previous.revision
    const pages: ComposedSheetSnapshot[] = []
    try {
      for (let page = cachedCount; page < pageCount; page += 1) {
        const next = await pull(page)
        if (next.revision !== pin) throw { moved: true }
        pages.push(next)
        if (!next.hasMore) break
      }
      const merged = mergeComposedSheetSnapshots([options.previous, ...pages])
      if (!merged) {
        throw new Error(
          'This Sheet could not be composed from its Dataset or Record bindings.',
        )
      }
      return {
        snapshot: merged,
        pinnedRevision: pin,
        restarted: false,
        notice: null,
        fetchedPages,
      }
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('moved' in error) ||
        maxRestarts < 1
      ) {
        throw error
      }
      // Fall through to a full restart from offset 0 below.
      restarts += 1
    }
  }

  // Full load (first page, post-invalidation refetch, or a restart after a
  // mid-paging revision move): pin on page 0 and restart once on drift.
  for (;;) {
    try {
      const { pages: done, pin } = await collect(pageCount)
      const merged = mergeComposedSheetSnapshots(done)
      if (!merged) {
        throw new Error(
          'This Sheet could not be composed from its Dataset or Record bindings.',
        )
      }
      return {
        snapshot: merged,
        pinnedRevision: pin,
        restarted: restarts > 0,
        notice:
          restarts > 0
            ? 'The Sheet changed while loading more rows — restarted from the first rows against the latest revision.'
            : null,
        fetchedPages,
      }
    } catch (error) {
      const moved = !!error && typeof error === 'object' && 'moved' in error
      if (!moved) throw error
      if (restarts < maxRestarts) {
        restarts += 1
        continue
      }
      // The revision kept moving under paging. Fall back to the fresh first
      // window alone: always coherent at the latest revision with `hasMore`
      // intact, so the grid shows current rows and Load more stays
      // available instead of looping or mixing revisions.
      const fresh = await pull(0)
      const merged = mergeComposedSheetSnapshots([fresh])
      if (!merged) {
        throw new Error(
          'This Sheet could not be composed from its Dataset or Record bindings.',
        )
      }
      return {
        snapshot: merged,
        pinnedRevision: fresh.revision,
        restarted: true,
        notice:
          'The Sheet changed while loading more rows — restarted from the first rows against the latest revision.',
        fetchedPages,
      }
    }
  }
}

/**
 * GRID-05 — merge paged composition windows into one snapshot for the grid.
 * Pages must arrive in offset order and share one authoritative revision
 * (see `fetchComposedSheetPaged`, which pins the revision before merging);
 * row identity stays stable because every rowKey is identity-derived (never
 * a position), so pending edits and write-back attribution survive paging.
 * `boundProjection.columns` are window-invariant; only rows concatenate.
 * `hasMore` is the last page's — the grid keeps paging until it is false.
 */
export function mergeComposedSheetSnapshots(
  pages: ComposedSheetSnapshot[],
): ComposedSheetSnapshot | null {
  const first = pages.at(0)
  if (!first) return null
  const last = pages.at(-1)
  return {
    ...first,
    offset: first.offset,
    hasMore: last?.hasMore ?? false,
    rows: pages.flatMap((page) => page.rows),
    ...(first.boundProjection
      ? {
          boundProjection: {
            columns: first.boundProjection.columns,
            rows: pages.flatMap((page) => page.boundProjection?.rows ?? []),
          },
        }
      : {}),
  }
}
