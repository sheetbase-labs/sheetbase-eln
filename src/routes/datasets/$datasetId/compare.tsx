import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Badge } from '#/components/ui/badge'
import { LoadMore } from '#/components/ui/load-more'
import { Diff } from '#/components/ui/source'
import { Muted } from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { Icon } from '#/components/icons'
import { notebookDataClient } from '#/lib/notebook-data'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { stickyCell, stickyHead } from '#/components/inventory/list'
import { FLAG_KIND_LABELS } from '#/components/datasets/value-action-labels'
import {
  hasMoreSnapshotCompareRows,
  snapshotCompareTotalRows,
} from '#/components/datasets/snapshot-data'
import { useDatasetVersions } from '../$datasetId'
import type { DatasetVersion } from '../$datasetId'
import { formatDate } from '#/lib/format-date'
import { z } from 'zod'

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
/** The Compare tab's search: which two snapshots are being compared. */
interface CompareSearch {
  from?: string
  to?: string
}

export const Route = createFileRoute('/datasets/$datasetId/compare')({
  validateSearch: (search): CompareSearch => {
    const from = z.string().safeParse(search.from)
    const to = z.string().safeParse(search.to)
    const compared: CompareSearch = {}

    if (from.success) compared.from = from.data

    if (to.success) compared.to = to.data

    return compared
  },
  component: Compare,
})

const label = {
  added: t('data.datasetCompare.added'),
  removed: t('data.datasetCompare.removed'),
  changed: t('data.datasetCompare.changed'),
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

/** A compared value as the diff shows it: blank for nothing, its own text otherwise. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A snapshot's stored values are JSONB of no shape this screen knows; each form is read below and anything else renders as it stringifies.
function diffText(value: unknown): string {
  if (value === null || value === undefined) return ''

  const primitive = z
    .union([z.string(), z.number(), z.boolean()])
    .safeParse(value)

  if (primitive.success) return String(primitive.data)

  if (Array.isArray(value)) return value.map((item) => diffText(item)).join(',')

  // A nested JSON object stringifies the way `String()` renders one.
  return '[object Object]'
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

/** The two snapshot pickers: never the same snapshot on both sides. */
function SnapshotPickers({
  versions,
  from,
  to,
  onPick,
}: {
  versions: DatasetVersion[]
  from: string | undefined
  to: string | undefined
  onPick: (key: 'from' | 'to', value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-body">
      <SnapshotPicker
        id="from"
        caption={t('data.datasetCompare.fromSnapshot')}
        versions={versions.filter((version) => version.id !== to)}
        value={from}
        onPick={(value) => onPick('from', value)}
      />
      <Icon name="chevronRight" size={14} />
      <SnapshotPicker
        id="to"
        caption={t('data.datasetCompare.toSnapshot')}
        versions={versions.filter((version) => version.id !== from)}
        value={to}
        onPick={(value) => onPick('to', value)}
      />
    </div>
  )
}

/** One side of the comparison: the snapshots that side may name. */
function SnapshotPicker({
  id,
  caption,
  versions,
  value,
  onPick,
}: {
  id: string
  caption: string
  versions: DatasetVersion[]
  value: string | undefined
  onPick: (value: string) => void
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {caption}
      </label>
      <Select
        id={id}
        className="min-w-0 flex-1 md:w-[240px] md:flex-none"
        value={value}
        onChange={(e) => onPick(e.target.value)}
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.label} · {formatDate(version.createdAt)}
          </option>
        ))}
      </Select>
    </>
  )
}

/** How much changed between the two snapshots. */
function ComparisonMetrics({ data }: { data: ComparePayload | undefined }) {
  const metrics: Array<[string, number | undefined]> = [
    [t('data.datasetCompare.rowsAdded'), data?.counts.added],
    [t('data.datasetCompare.rowsChanged'), data?.counts.changed],
    [t('data.datasetCompare.rowsRemoved'), data?.counts.removed],
    [t('data.datasetCompare.columnsChanged'), data?.columns.length],
    [t('data.datasetCompare.flagChanges'), data?.counts.flags],
  ]

  return (
    <div className="grid grid-cols-2 gap-2 md:flex md:gap-4">
      {metrics.map(([metric, count]) => (
        <div
          key={metric}
          className="rounded-md border border-border px-3.5 py-2.5 md:min-w-[150px]"
        >
          <div className="text-label text-fg-muted">{metric}</div>
          <div className="num text-[20px] font-medium">{count ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

/** Which two snapshots the address names, corrected so it is never the same one twice. */
function chooseSnapshots(versions: DatasetVersion[], search: CompareSearch) {
  const versionIds = new Set(versions.map((version) => version.id))

  const named = (id: string | undefined) =>
    id !== undefined && versionIds.has(id) ? id : undefined

  const to = named(search.to) !== search.from ? named(search.to) : undefined

  const chosen = to ?? versions.at(0)?.id

  const from =
    named(search.from) !== chosen
      ? named(search.from)
      : versions.find((version) => version.id !== chosen)?.id

  return { from, to: chosen }
}

/** The comparison's columns, given the field names and row numbering they read. */
function compareColumns(
  labelByField: Map<string, string>,
  rowNumber: Map<string, number>,
): RegistryColumn<CompareGridRow>[] {
  const fieldLabel = (fieldId: string) =>
    labelByField.get(fieldId) ?? t('data.datasetCompare.unknownField')

  return [
    {
      id: 'change',
      header: t('data.datasetCompare.change'),
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
      header: t('data.datasetCompare.row'),
      cell: ({ row }) => rowNumber.get(row.original.row.rowId),
      meta: { cellClassName: 'num text-fg-muted' },
    },
    {
      id: 'field',
      header: t('data.datasetCompare.field'),
      cell: ({ row }) => (
        <CompareFieldCell entry={row.original.entry} labelFor={fieldLabel} />
      ),
    },
    {
      id: 'values',
      header: t('data.datasetCompare.change'),
      cell: ({ row }) => <CompareValueCell entry={row.original.entry} />,
      meta: rightAligned<CompareGridRow>().meta,
    },
  ]
}

/** Which field or flag changed on this row. */
function CompareFieldCell({
  entry,
  labelFor,
}: {
  entry: DiffEntry
  labelFor: (fieldId: string) => string
}) {
  if (entry.isFlag) {
    return (
      <span className="inline-flex items-center gap-1">
        <Icon name="warn" size={12} />
        {flagKindLabel(entry.kind ?? '')}
        <span className="text-fg-muted">· {entry.source}</span>
      </span>
    )
  }

  return entry.fieldId ? labelFor(entry.fieldId) : '—'
}

/** The before/after values of this row's change. */
function CompareValueCell({ entry }: { entry: DiffEntry }) {
  if (!entry.isFlag && !entry.fieldId) return '—'

  return <Diff before={diffText(entry.from)} after={diffText(entry.to)} />
}

/** What the comparison's read reports about itself. */
interface ComparisonState {
  isPending: boolean
  isError: boolean
  error: unknown
}

/** The diff itself: loading, refused, changes, or nothing changed. */
function ComparisonResults({
  diff,
  entries,
  gridRows,
  columns,
}: {
  diff: ComparisonState
  entries: ComparePayload['rows']
  gridRows: CompareGridRow[]
  columns: RegistryColumn<CompareGridRow>[]
}) {
  if (diff.isPending) {
    return <Muted>{t('data.datasetCompare.loadingComparison')}</Muted>
  }

  if (diff.isError) {
    return (
      <Notice tone="bad" title={t('data.datasetCompare.comparisonCouldLoaded')}>
        {diff.error instanceof Error
          ? diff.error.message
          : t('data.datasetCompare.databaseRefusedComparison')}
      </Notice>
    )
  }

  if (entries.length === 0) {
    return (
      <Muted>{t('data.datasetCompare.differencesBetweenTheseSnapshots')}</Muted>
    )
  }

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.datasetCompare.snapshotComparison')}
        rows={gridRows}
        columns={columns}
        getRowId={(r) => `${r.row.rowId}-${r.entry.key}`}
        selectable={false}
      />
    </TableBox>
  )
}

/** One snapshot's name and date, or the stand-in when neither side names it. */
function describeVersion(
  versions: DatasetVersion[],
  id: string | undefined,
): string {
  const version = versions.find((candidate) => candidate.id === id)

  return version
    ? `${version.label} · ${formatDate(version.createdAt)}`
    : t('data.datasetCompare.noSnapshot')
}

function Compare() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const versions = useDatasetVersions(datasetId)
  const list = versions.data ?? []
  // Never compare a snapshot with itself: the RPC would compare a version to
  // itself and every counter would report nothing changed.
  const { from, to } = chooseSnapshots(list, search)

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

  // A snapshot stores no row number, so the table names each changed row by
  // its position in this comparison (the page the server returns is ordered).
  const rowNumber = new Map<string, number>()

  entries.forEach((row, index) => {
    if (!rowNumber.has(row.rowId)) rowNumber.set(row.rowId, index + 1)
  })

  const columns = compareColumns(labelByField, rowNumber)

  if (versions.isPending) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>{t('data.datasetCompare.loadingSnapshots')}</Muted>
      </div>
    )
  }

  if (versions.isError) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Notice
          tone="bad"
          title={t('data.datasetCompare.snapshotsCouldLoaded')}
        >
          {versions.error instanceof Error
            ? versions.error.message
            : t('data.datasetCompare.databaseRefusedRequest')}
        </Notice>
      </div>
    )
  }

  if (list.length < 2) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>{t('data.datasetCompare.compareNeedsTwoSnapshots')}</Muted>
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
      <SnapshotPickers versions={list} from={from} to={to} onPick={pick} />

      <ComparisonMetrics data={data} />

      <ComparisonResults
        diff={diff}
        entries={entries}
        gridRows={gridRows}
        columns={columns}
      />

      <LoadMore
        label={t('data.datasetCompare.comparisonChanges')}
        loaded={entries.length}
        total={totalChanges}
        noun="changes"
        hasMore={diff.hasNextPage}
        loading={diff.isFetchingNextPage}
        onLoadMore={() => void diff.fetchNextPage()}
      />

      <Muted>
        {t('data.datasetCompare.comparingRowsNumberedTheir', {
          value: describeVersion(list, from),
          value2: describeVersion(list, to),
        })}
      </Muted>
    </div>
  )
}
