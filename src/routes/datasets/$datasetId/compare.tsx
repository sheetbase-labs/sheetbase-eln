import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { Badge } from '#/components/v3/ui/badge'
import { LoadMore } from '#/components/v3/ui/load-more'
import { Diff } from '#/components/v3/ui/source'
import { Muted } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import { Icon } from '#/components/v3/icons'
import { notebookDataClient } from '#/lib/notebook-data'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { stickyCell, stickyHead } from '#/components/v3/inventory/list'
import { FLAG_KIND_LABELS } from '#/components/v3/datasets/value-actions'
import {
  hasMoreSnapshotCompareRows,
  snapshotCompareTotalRows,
} from '#/components/v3/datasets/snapshot-data'
import { useDatasetVersions } from '../$datasetId'
import { formatDate } from '#/lib/format-date'

/** DSET-03.2 — one flag-level change on a compared row. A kind or source
 * change arrives as the old flag removed and the new one added. */
interface FlagDelta {
  fieldId: string
  kind: string
  source: string
  change: 'added' | 'removed' | 'changed'
  from?: { reason: string; comment: string | null }
  to?: { reason: string; comment: string | null }
}

interface ComparePayload {
  versionA: string
  versionB: string
  offset: number
  limit: number
  counts: { added: number; removed: number; changed: number; flags: number }
  columns: { fieldId: string; kind: string }[]
  rows: {
    rowId: string
    kind: 'added' | 'removed' | 'changed'
    fields: { fieldId: string; from: unknown; to: unknown }[]
    flagFields: FlagDelta[]
  }[]
}

/** DSET-03.3 — comparison page size. The server supports p_limit/p_offset, so
 * the route asks for one window at a time and extends it through the visible
 * "Load more" control instead of fetching a fixed first 100 rows. */
const COMPARE_PAGE_SIZE = 100

/** UI port (roadmap-4/ui-app3): the dataset Compare tab, wired to
 * compare_dataset_versions. Flag-only changes (added, cleared or changed
 * reason/kind/source) are shown alongside value changes. */
export const Route = createFileRoute('/datasets/$datasetId/compare')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { from?: string; to?: string } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
    to: typeof search.to === 'string' ? search.to : undefined,
  }),
  component: Compare,
})

const label = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
} as const
const badgeVariant = { added: 'add', removed: 'del', changed: 'chg' } as const

/** A value change or a flag change rendered on the same diff row. */
interface DiffEntry {
  key: string
  isFlag: boolean
  fieldId: string | null
  kind?: string
  source?: string
  from: unknown
  to: unknown
}

/** One grid row: a compared row and one of its value or flag changes. */
interface CompareGridRow {
  row: ComparePayload['rows'][number]
  entry: DiffEntry
}

/** Human label for a flag kind, falling back to the raw value if unknown. */
function flagKindLabel(kind: string): string {
  const labels: Record<string, string | undefined> = FLAG_KIND_LABELS
  return labels[kind] ?? kind
}

function entriesForRow(row: ComparePayload['rows'][number]): DiffEntry[] {
  const entries: DiffEntry[] = row.fields.map((field) => ({
    key: `value-${field.fieldId}`,
    isFlag: false,
    fieldId: field.fieldId,
    from: field.from,
    to: field.to,
  }))
  for (const flag of row.flagFields) {
    entries.push({
      key: `flag-${flag.fieldId}-${flag.kind}-${flag.source}-${flag.change}`,
      isFlag: true,
      fieldId: flag.fieldId,
      kind: flag.kind,
      source: flag.source,
      from: flag.from?.reason ?? null,
      to: flag.to?.reason ?? null,
    })
  }
  return entries.length
    ? entries
    : [{ key: 'none', isFlag: false, fieldId: null, from: null, to: null }]
}

function Compare() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const versions = useDatasetVersions(datasetId)
  const list = versions.data ?? []
  const versionIds = list.map((version) => version.id)
  // Never compare a snapshot with itself: the RPC would compare a version to
  // itself and every counter would report nothing changed.
  const to =
    search.to && versionIds.includes(search.to) && search.to !== search.from
      ? search.to
      : list.at(0)?.id
  const from =
    search.from && versionIds.includes(search.from) && search.from !== to
      ? search.from
      : list.find((version) => version.id !== to)?.id

  const diff = useInfiniteQuery({
    queryKey: ['ui-port', 'dataset-compare', datasetId, from, to],
    queryFn: ({ pageParam }) =>
      notebookDataClient.rpc<ComparePayload>('compare_dataset_versions', {
        p_version_a: from!,
        p_version_b: to!,
        p_limit: COMPARE_PAGE_SIZE,
        p_offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      hasMoreSnapshotCompareRows(lastPage)
        ? lastPage.offset + lastPage.rows.length
        : undefined,
    enabled: Boolean(from && to),
  })
  const data = diff.data?.pages.at(0)
  const entries = diff.data?.pages.flatMap((page) => page.rows) ?? []
  const totalChanges = data ? snapshotCompareTotalRows(data.counts) : 0

  // DSET-03.2 — field names come from the schema version fields; the compare
  // payload carries field ids only.
  const fieldIds = useMemo(() => {
    const ids = new Set<string>()
    for (const page of diff.data?.pages ?? []) {
      for (const column of page.columns) ids.add(column.fieldId)
      for (const row of page.rows) {
        for (const field of row.fields) ids.add(field.fieldId)
        for (const flag of row.flagFields) ids.add(flag.fieldId)
      }
    }
    return [...ids]
  }, [diff.data])
  const fieldQuery = useQuery({
    queryKey: ['ui-port', 'dataset-field-labels', datasetId, fieldIds],
    enabled: fieldIds.length > 0,
    queryFn: () =>
      notebookDataClient.list<{ field_id: string; key: string; label: string }>(
        'dataset_schema_version_fields',
        `?field_id=in.(${fieldIds.map(encodeURIComponent).join(',')})&select=field_id,key,label`,
      ),
    staleTime: 60_000,
  })
  const labelByField = new Map(
    (fieldQuery.data ?? []).map((field) => [
      field.field_id,
      field.label || field.key,
    ]),
  )
  // One grid row per diff entry: the bespoke table flattened each compared row's
  // entries into its own rows.
  const gridRows: CompareGridRow[] = entries.flatMap((r) =>
    entriesForRow(r).map((entry) => ({ row: r, entry })),
  )
  const columns: RegistryColumn<CompareGridRow>[] = [
    {
      id: 'change',
      header: 'Change',
      cell: ({ row }) => (
        <Badge variant={badgeVariant[row.original.row.kind]}>
          {label[row.original.row.kind]}
        </Badge>
      ),
      // The bespoke table inset this first column to 12px rather than the 24px
      // every other table's first column takes.
      meta: {
        headerClassName: `pl-3! ${stickyHead}`,
        cellClassName: `pl-3! ${stickyCell}`,
      },
    },
    {
      id: 'row',
      header: 'Row',
      cell: ({ row }) => rowNumber.get(row.original.row.rowId),
      meta: { cellClassName: 'num text-fg-muted' },
    },
    {
      id: 'field',
      header: 'Field',
      cell: ({ row }) => {
        const entry = row.original.entry
        if (entry.isFlag) {
          return (
            <span className="inline-flex items-center gap-1">
              <Icon name="warn" size={12} />
              {flagKindLabel(entry.kind ?? '')}
              <span className="text-fg-muted">· {entry.source}</span>
            </span>
          )
        }
        return entry.fieldId ? fieldLabel(entry.fieldId) : '—'
      },
    },
    {
      id: 'values',
      header: 'Change',
      cell: ({ row }) => {
        const entry = row.original.entry
        return entry.isFlag || entry.fieldId ? (
          <Diff
            before={String(entry.from ?? '')}
            after={String(entry.to ?? '')}
          />
        ) : (
          '—'
        )
      },
      meta: rightAligned<CompareGridRow>().meta,
    },
  ]

  const fieldLabel = (fieldId: string) =>
    labelByField.get(fieldId) ?? 'Unknown field'

  // A snapshot stores no row number, so the table names each changed row by
  // its position in this comparison (the page the server returns is ordered).
  const rowNumber = new Map<string, number>()
  entries.forEach((row, index) => {
    if (!rowNumber.has(row.rowId)) rowNumber.set(row.rowId, index + 1)
  })
  const describeVersion = (id: string | undefined) => {
    const version = list.find((candidate) => candidate.id === id)
    return version
      ? `${version.label} · ${formatDate(version.createdAt)}`
      : 'No snapshot'
  }

  if (versions.isPending) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>Loading snapshots…</Muted>
      </div>
    )
  }

  if (versions.isError) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Notice tone="bad" title="The snapshots could not be loaded.">
          {versions.error instanceof Error
            ? versions.error.message
            : 'The database refused the request.'}
        </Notice>
      </div>
    )
  }

  if (list.length < 2) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>
          Compare needs two snapshots. Save another to compare changes.
        </Muted>
      </div>
    )
  }

  const pick = (key: 'from' | 'to', value: string) =>
    void navigate({
      to: '/datasets/$datasetId/compare',
      params: { datasetId },
      search: (s) => ({ ...s, [key]: value }),
      replace: true,
    })

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-center gap-2 text-body">
        <label className="sr-only" htmlFor="from">
          From snapshot
        </label>
        <Select
          id="from"
          className="min-w-0 flex-1 md:w-[240px] md:flex-none"
          value={from}
          onChange={(e) => pick('from', e.target.value)}
        >
          {list
            .filter((v) => v.id !== to)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {formatDate(v.createdAt)}
              </option>
            ))}
        </Select>
        <Icon name="chevronRight" size={14} />
        <label className="sr-only" htmlFor="to">
          To snapshot
        </label>
        <Select
          id="to"
          className="min-w-0 flex-1 md:w-[240px] md:flex-none"
          value={to}
          onChange={(e) => pick('to', e.target.value)}
        >
          {list
            .filter((v) => v.id !== from)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {formatDate(v.createdAt)}
              </option>
            ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2 md:flex md:gap-4">
        {(
          [
            ['Rows added', data?.counts.added],
            ['Rows changed', data?.counts.changed],
            ['Rows removed', data?.counts.removed],
            ['Columns changed', data?.columns.length],
            ['Flag changes', data?.counts.flags],
          ] as [string, number | undefined][]
        ).map(([metric, count]) => (
          <div
            key={metric}
            className="rounded-md border border-border px-3.5 py-2.5 md:min-w-[150px]"
          >
            <div className="text-label text-fg-muted">{metric}</div>
            <div className="num text-[20px] font-medium">{count ?? '—'}</div>
          </div>
        ))}
      </div>

      {diff.isPending ? (
        <Muted>Loading the comparison…</Muted>
      ) : diff.isError ? (
        <Notice tone="bad" title="The comparison could not be loaded.">
          {diff.error instanceof Error
            ? diff.error.message
            : 'The database refused the comparison.'}
        </Notice>
      ) : entries.length ? (
        <TableBox>
          <RegistryGrid
            label="Snapshot comparison"
            rows={gridRows}
            columns={columns}
            getRowId={(r) => `${r.row.rowId}-${r.entry.key}`}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>No differences between these snapshots.</Muted>
      )}

      <LoadMore
        label="Comparison changes"
        loaded={entries.length}
        total={totalChanges}
        noun="changes"
        hasMore={diff.hasNextPage}
        loading={diff.isFetchingNextPage}
        onLoadMore={() => void diff.fetchNextPage()}
      />

      <Muted>
        Comparing {describeVersion(from)} with {describeVersion(to)}. Rows are
        numbered by their position in this comparison — a snapshot stores no row
        number. Flag changes list the flag kind, source and the reason before
        and after.
      </Muted>
    </div>
  )
}
