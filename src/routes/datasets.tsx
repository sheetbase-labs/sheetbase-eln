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
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/v3/ui/layout'
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
import {
  datasetIssueSummary,
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'

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
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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
  // With nothing chosen, open the worst offender: the design's inspector shows
  // the dataset with the most issues, which is also the one worth triaging.
  const defaultSel = visible.reduce<DatasetListRow | undefined>(
    (best, r) => (!best || r.issues > best.issues ? r : best),
    undefined,
  )
  const sel =
    visible.find((r) => r.uuid === (selected ?? search.dataset)) ?? defaultSel

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
            to="/datasets/$datasetId/rows"
            params={{ datasetId: row.original.uuid }}
            onClick={(event) => event.stopPropagation()}
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
    [],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.uuid ?? null,
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
                count: counts[t],
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
          <RegistryGrid
            className="max-md:hidden"
            label="Datasets"
            rows={visible}
            columns={columns}
            getRowId={(d) => d.uuid}
            rowSelection={rowSelection}
            onRowSelectionChange={onRowSelectionChange}
            isLoading={query.isLoading}
          />
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
                onSelect: () => setSelected(d.uuid),
                selected: d.uuid === sel?.uuid,
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

      {sel ? (
        <Inspector
          aria-label="Dataset summary"
          className="w-inspector gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-label text-fg-muted">{sel.id}</span>
            <div className="text-doc font-semibold">{sel.name}</div>
            <div className="text-label">
              <Status tone={datasetValidation(sel).tone}>
                {datasetValidation(sel).label}
              </Status>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Button
                variant={sel.issues > 0 ? 'primary' : undefined}
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/datasets/$datasetId/rows"
                    params={{ datasetId: sel.uuid }}
                  />
                }
              >
                {sel.issues > 0 ? 'Open and fix' : 'Open dataset'}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-[18px] px-4 py-3.5">
            {sel.issues > 0 ? (
              <InspectorSection title="Issues">
                <p className="m-0 text-label leading-[18px]">
                  {datasetIssueSummary(sel)}
                </p>
              </InspectorSection>
            ) : null}
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={80}
                items={[
                  ['Rows', String(sel.rows)],
                  ['Model', sel.model],
                  ['Experiment', sel.experimentId ?? '—'],
                  [
                    'Owner',
                    sel.createdByUserId === context.user.id
                      ? context.user.name
                      : '—',
                  ],
                ]}
              />
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}
