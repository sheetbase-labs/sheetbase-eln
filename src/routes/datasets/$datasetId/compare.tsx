import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Badge } from '#/components/v3/ui/badge'
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
import { useDatasetVersions } from '../$datasetId'

interface ComparePayload {
  versionA: string
  versionB: string
  counts: { added: number; removed: number; changed: number }
  columns: { fieldId: string; kind: string }[]
  rows: {
    rowId: string
    kind: 'added' | 'removed' | 'changed'
    fields: { fieldId: string; from: unknown; to: unknown }[]
  }[]
}

/** UI port (roadmap-4/ui-app3): the dataset Compare tab, wired to
 * compare_dataset_versions. */
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

function Compare() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const versions = useDatasetVersions(datasetId)
  const list = versions.data ?? []
  const to = search.to ?? list.at(0)?.id
  const from = search.from ?? list.at(1)?.id

  const diff = useQuery({
    queryKey: ['ui-port', 'dataset-compare', datasetId, from, to],
    queryFn: () =>
      notebookDataClient.rpc<ComparePayload>('compare_dataset_versions', {
        p_version_a: from!,
        p_version_b: to!,
        p_limit: 100,
        p_offset: 0,
      }),
    enabled: Boolean(from && to),
  })
  const data = diff.data

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

      {data?.rows.length ? (
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
              {data.rows.map((r) =>
                (r.fields.length ? r.fields : [null]).map((f, i) => (
                  <TableRow key={`${r.rowId}-${f?.fieldId ?? i}`}>
                    <TableCell className={cn('first:pl-3', stickyCell)}>
                      <Badge variant={badgeVariant[r.kind]}>
                        {label[r.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="mono">
                      {r.rowId.slice(0, 8)}
                    </TableCell>
                    <TableCell>{f ? f.fieldId.slice(0, 8) : '—'}</TableCell>
                    <TableCell align="right">
                      {f ? (
                        <Diff
                          before={String(f.from ?? '')}
                          after={String(f.to ?? '')}
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

      <Muted>
        Comparing {from} with {to}. Field names show their ids until the schema
        label join is added.
      </Muted>
    </div>
  )
}
