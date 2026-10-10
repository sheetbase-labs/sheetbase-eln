import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Diff } from '#/components/v3/ui/source'
import { Muted } from '#/components/v3/ui/layout'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { stickyCell, stickyHead } from '#/components/v3/inventory/list'
import { FLAG_KIND_LABELS } from '#/components/v3/datasets/value-actions'
import {
  hasMoreSnapshotCompareRows,
  snapshotCompareTotalRows,
} from '#/components/v3/datasets/snapshot-data'
import { useDatasetVersions } from '../$datasetId'

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
  const to = search.to ?? list.at(0)?.id
  const from = search.from ?? list.at(1)?.id

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

  if (list.length < 2) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>
          Compare needs two snapshots. Save another to compare changes.
        </Muted>
      </div>
    )
  }

  const sel =
    'h-[30px] min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-body text-fg max-md:h-10 md:w-[240px] md:flex-none'
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
        <select
          id="from"
          className={sel}
          value={from}
          onChange={(e) => pick('from', e.target.value)}
        >
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} · {v.createdAt.slice(0, 10)}
            </option>
          ))}
        </select>
        <Icon name="chevronRight" size={14} />
        <label className="sr-only" htmlFor="to">
          To snapshot
        </label>
        <select
          id="to"
          className={sel}
          value={to}
          onChange={(e) => pick('to', e.target.value)}
        >
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} · {v.createdAt.slice(0, 10)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 md:flex md:gap-4">
        {[
          ['Rows added', data?.counts.added ?? 0],
          ['Rows changed', data?.counts.changed ?? 0],
          ['Rows removed', data?.counts.removed ?? 0],
          ['Columns changed', data?.columns.length ?? 0],
          ['Flag changes', data?.counts.flags ?? 0],
        ].map(([l, n]) => (
          <div
            key={l}
            className="rounded-md border border-border px-3.5 py-2.5 md:min-w-[150px]"
          >
            <div className="text-label text-fg-muted">{l}</div>
            <div className="num text-[20px] font-medium">{n}</div>
          </div>
        ))}
      </div>

      {entries.length ? (
        <TableBox>
          <Table className="max-lg:min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className={cn('first:pl-3', stickyHead)}>
                  Change
                </TableHead>
                <TableHead>Row</TableHead>
                <TableHead>Field</TableHead>
                <TableHead align="right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((r) =>
                entriesForRow(r).map((entry) => (
                  <TableRow key={`${r.rowId}-${entry.key}`}>
                    <TableCell className={cn('first:pl-3', stickyCell)}>
                      <Badge variant={badgeVariant[r.kind]}>
                        {label[r.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="mono">
                      {r.rowId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      {entry.isFlag ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="warn" size={12} />
                          {flagKindLabel(entry.kind ?? '')}
                          <span className="text-fg-muted">
                            · {entry.source}
                          </span>
                        </span>
                      ) : entry.fieldId ? (
                        entry.fieldId.slice(0, 8)
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {entry.isFlag || entry.fieldId ? (
                        <Diff
                          before={String(entry.from ?? '')}
                          after={String(entry.to ?? '')}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </TableBox>
      ) : (
        <Muted>No differences between these snapshots.</Muted>
      )}

      {diff.hasNextPage ? (
        <div>
          <Button
            onClick={() => void diff.fetchNextPage()}
            disabled={diff.isFetchingNextPage}
          >
            {diff.isFetchingNextPage
              ? 'Loading…'
              : `Load more (${Math.max(totalChanges - entries.length, 0)} left)`}
          </Button>
        </div>
      ) : null}

      <Muted>
        Comparing {from} with {to}. Field names show their ids until the schema
        label join is added. Flag changes list the flag kind, source and the
        reason before and after.
      </Muted>
    </div>
  )
}
