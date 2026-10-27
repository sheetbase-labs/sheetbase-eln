import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/v3/projects/project-access'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { datasetPath } from '#/lib/navigation'
import {
  ListHeader,
  ListToolbar,
  MobileList,
} from '#/components/v3/inventory/list'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Tabs } from '#/components/v3/ui/tabs'
import { DatasetInspector } from '#/components/v3/datasets/dataset-inspector'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['all', 'mine', 'issues', 'locked'] as const
type DatasetTab = (typeof tabs)[number]
const tabLabel: Record<DatasetTab, string> = {
  all: 'All',
  mine: 'Mine',
  issues: 'Has issues',
  locked: 'Locked',
}

const sorts = ['Updated', 'ID', 'Rows'] as const
type DatasetSort = (typeof sorts)[number]

/** UI port (roadmap-4/ui-app3): the dataset registry list, wired to
 * dataset_list_summary. The explorer/rows/snapshots/compare child routes and
 * the import flow follow. */
export const Route = createFileRoute('/datasets')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    q?: string
    tab?: DatasetTab | 'pipelines' | 'versions'
    dataset?: string
    archived?: boolean
  } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    dataset: typeof search.dataset === 'string' ? search.dataset : undefined,
    archived: search.archived === true || search.archived === '1' || undefined,
    tab:
      search.tab === 'mine' ||
      search.tab === 'issues' ||
      search.tab === 'locked' ||
      search.tab === 'all' ||
      search.tab === 'pipelines' ||
      search.tab === 'versions'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: DatasetsRoute,
})

function DatasetsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/datasets',
  })
  return isIndex ? <DatasetsList /> : <Outlet />
}

function DatasetsList() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const openDataset = useOpenRow<DatasetListRow>(
    navigate,
    (row) => datasetPath(row.uuid),
    (row) => row.name,
  )
  const query = useDatasetSummaries()
  const rows = query.data ?? []
  const tab: DatasetTab =
    search.tab === 'mine' || search.tab === 'issues' || search.tab === 'locked'
      ? search.tab
      : 'all'
  const [selected, setSelected] = useState<string | null>(null)
  const [sort, setSort] = useState<DatasetSort>('Updated')

  const inTab = (r: DatasetListRow, t: DatasetTab): boolean =>
    t === 'all'
      ? true
      : t === 'mine'
        ? r.createdByUserId === context.user.id
        : t === 'issues'
          ? r.issues > 0
          : r.reviewState === 'locked'
  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
      ) as Record<DatasetTab, number>,
    [rows, context.user.id],
  )

  const sorted = useMemo(() => {
    const by: Record<
      DatasetSort,
      (a: DatasetListRow, b: DatasetListRow) => number
    > = {
      Updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      ID: (a, b) => a.id.localeCompare(b.id),
      Rows: (a, b) => b.rows - a.rows,
    }
    return [...rows].sort(by[sort])
  }, [rows, sort])

  const q = (search.q ?? '').trim().toLowerCase()
  const hasProjectAccess = useHasProjectAccess()
  const visible = sorted
    .filter((r) => inTab(r, tab))
    .filter(
      (r) =>
        !q || [r.id, r.name, r.model].some((v) => v.toLowerCase().includes(q)),
    )
  const columns = useMemo<RegistryColumn<DatasetListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <Link
            to="/datasets/$datasetId"
            params={{ datasetId: row.original.uuid }}
            onClick={(event) => openDataset(row.original, event)}
          >
            {row.original.name}
          </Link>
        ),
      },
      { id: 'model', header: 'Model', accessorFn: (d) => d.model },
      {
        id: 'experiment',
        header: 'Experiment',
        cell: ({ row }) => (
          <span className="mono">{row.original.experimentId ?? '—'}</span>
        ),
      },
      {
        id: 'rows',
        header: 'Rows',
        accessorFn: (d) => d.rows,
        meta: rightAligned<DatasetListRow>().meta,
      },
      {
        id: 'validation',
        header: 'Validation',
        cell: ({ row }) => {
          const v = datasetValidation(row.original)
          return <Status tone={v.tone}>{v.label}</Status>
        },
      },
    ],
    [openDataset],
  )

  const selectedRow = visible.find((d) => d.uuid === selected)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selected,
    setSelected,
  )

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Datasets"
          total={rows.length}
          actions={
            <>
              <Button
                nativeButton={false}
                render={<Link to="/settings/instruments" />}
              >
                Connect instrument
              </Button>
              <Button
                variant="primary"
                icon="upload"
                nativeButton={false}
                render={<Link to="/import" />}
              >
                Import data
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label="Dataset lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: query.isLoading ? undefined : counts[t],
                link: {
                  to: '/datasets',
                  search: { tab: t === 'all' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search datasets"
          placeholder="Search datasets"
          views={{
            sorts: [...sorts],
            sort,
            onSort: (s) => setSort(s as DatasetSort),
          }}
          onSearch={(next) =>
            void navigate({
              to: '/datasets',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isLoading || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Datasets"
              rows={visible}
              columns={columns}
              getRowId={(d) => d.uuid}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={openDataset}
              isLoading={query.isLoading}
            />
          ) : null}
          <MobileList
            label="Datasets"
            items={visible.map((d) => {
              const v = datasetValidation(d)
              return {
                key: d.uuid,
                id: d.id,
                title: d.name,
                sub: `${d.rows} rows · ${d.model}${
                  d.experimentId ? ` · ${d.experimentId}` : ''
                }`,
                status: <Status tone={v.tone}>{v.label}</Status>,
                link: {
                  to: '/datasets/$datasetId',
                  params: { datasetId: d.uuid },
                  onClick: (event: React.MouseEvent) => openDataset(d, event),
                },
                selected: d.uuid === selected,
              }
            })}
          />
          {!query.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'table'}
                className="items-center py-14 text-center"
                title={
                  hasProjectAccess === false
                    ? noProjectAccessTitle('datasets')
                    : q
                      ? `No datasets match “${search.q}”`
                      : tab === 'issues'
                        ? 'No datasets have issues'
                        : `No datasets in ${tabLabel[tab].toLowerCase()}`
                }
                description={
                  hasProjectAccess === false
                    ? NO_PROJECT_ACCESS_BODY
                    : q
                      ? 'Search looks at ID, name and model.'
                      : 'Datasets appear here when an import or a check puts them in this list.'
                }
                action={
                  hasProjectAccess !== false && (q || tab !== 'all') ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to="/datasets"
                          search={{ q: undefined, tab: q ? tab : undefined }}
                        />
                      }
                    >
                      {q ? 'Clear search' : 'Show all datasets'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
        </div>
      </div>
      {selectedRow ? <DatasetInspector dataset={selectedRow} /> : null}
    </div>
  )
}
