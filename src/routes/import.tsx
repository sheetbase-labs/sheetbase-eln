import { useMemo, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { ImportWizard } from '#/components/import/import-wizard'
import { createDataClient } from '#/lib/data-client'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { datasetListQueryKeys } from '#/components/v3/datasets/datasets-data'

/** UI port (roadmap-4/ui-app3): the import entry point. app-3 walks upload →
 * map → check across two routes; the ELN keeps one route and runs the same
 * steps inside the existing, tested import wizard (which parses client-side and
 * commits through the canonical RPC), because there is no server-side import-job
 * model to page through. */
export const Route = createFileRoute('/import')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ImportPage,
})

const client = createDataClient()

function ImportPage() {
  const queryClient = useQueryClient()
  const datasets = useQuery({
    queryKey: ['ui-port', 'import', 'datasets'],
    queryFn: () => fetchDatasetSummaries(client),
    staleTime: 15_000,
  })
  const rows = datasets.data ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const table = useMemo(
    () => rows.find((d) => d.id === chosen) ?? rows.at(0),
    [rows, chosen],
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumbs="Import"
        title="Import data"
        meta={
          <>
            <span>
              Rows are added as a new dataset snapshot; earlier snapshots never
              change.
            </span>
            {table ? (
              <span className="max-lg:hidden">
                Target{' '}
                {table.display_id
                  ? `${table.display_id} · ${table.name}`
                  : table.name}
              </span>
            ) : null}
          </>
        }
        actions={
          <Button
            variant="primary"
            disabled={!table}
            onClick={() => setOpen(true)}
          >
            Import into {table?.display_id ?? 'dataset'}
          </Button>
        }
      />
      <div className="px-4 py-4 md:px-6">
        {datasets.isLoading ? (
          <Muted>Loading datasets…</Muted>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="table"
            title="No dataset to import into"
            body="Create a dataset from a model first, then import instrument files into it."
          />
        ) : (
          <>
            <p className="m-0 mb-3 max-w-[680px] text-body leading-5 text-fg-muted">
              Choose the dataset the file belongs to. Sheetbase parses the file
              in your browser, maps its columns to the dataset fields and shows
              every row before anything is saved.
            </p>
            <TableBox className="max-w-[820px]">
              <Table aria-label="Datasets to import into">
                <TableHeader>
                  <TableRow>
                    <TableHead>{''}</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Dataset</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead align="right">Rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => {
                    const selected = table?.id === d.id
                    return (
                      <TableRow
                        key={d.id}
                        selected={selected}
                        className="cursor-pointer"
                        onClick={() => setChosen(d.id)}
                      >
                        <TableCell>
                          <span
                            aria-hidden="true"
                            className={
                              selected
                                ? 'inline-block size-2.5 rounded-full bg-link'
                                : 'inline-block size-2.5 rounded-full border border-border-strong'
                            }
                          />
                        </TableCell>
                        <TableCell className="mono">
                          {d.display_id ?? d.id.slice(0, 8)}
                        </TableCell>
                        <TableCell
                          className={selected ? 'font-medium' : undefined}
                        >
                          {d.name}
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {d.schema_version_number != null
                            ? `schema v${d.schema_version_number}`
                            : '—'}
                        </TableCell>
                        <TableCell align="right">
                          <Status tone="stored">
                            {d.columns.length} columns
                          </Status>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          </>
        )}
      </div>

      {open && table ? (
        <ImportWizard
          open={open}
          onOpenChange={setOpen}
          client={client}
          mode={{ kind: 'dataset', table }}
          onDone={() => {
            void queryClient.invalidateQueries({
              queryKey: datasetListQueryKeys.page,
            })
            void queryClient.invalidateQueries({
              queryKey: ['ui-port', 'import', 'datasets'],
            })
          }}
        />
      ) : null}
    </div>
  )
}
