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
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  SearchTabs,
  stickyCell,
  stickyHead,
} from '#/components/v3/inventory/list'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'

const tabs = ['all', 'mine', 'issues', 'locked'] as const
type DatasetTab = (typeof tabs)[number]
const tabLabel: Record<DatasetTab, string> = {
  all: 'All',
  mine: 'Mine',
  issues: 'Issues',
  locked: 'Locked',
}

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

  const inTab = (r: DatasetListRow, t: DatasetTab): boolean =>
    t === 'all'
      ? true
      : t === 'mine'
        ? r.createdByUserId === context.user.id
        : t === 'issues'
          ? r.issues > 0
          : false
  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
      ) as Record<DatasetTab, number>,
    [rows, context.user.id],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows
    .filter((r) => inTab(r, tab))
    .filter(
      (r) =>
        !q || [r.id, r.name, r.model].some((v) => v.toLowerCase().includes(q)),
    )
  const sel =
    visible.find((r) => r.uuid === (selected ?? search.dataset)) ??
    visible.at(0)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Datasets"
          total={rows.length}
          tabs={
            <SearchTabs
              label="Dataset lists"
              current={tab}
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
          onSearch={(next) =>
            void navigate({
              to: '/datasets',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table aria-label="Datasets" className="max-md:hidden">
            <TableHeader>
              <TableRow>
                <TableHead className={stickyHead}>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Model</TableHead>
                <TableHead align="right">Rows</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead align="right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((d) => {
                const v = datasetValidation(d)
                return (
                  <TableRow
                    key={d.uuid}
                    selected={d.uuid === sel?.uuid}
                    className="cursor-pointer"
                    onClick={() => setSelected(d.uuid)}
                  >
                    <TableCell className={stickyCell}>
                      <span className="mono">{d.id}</span>
                    </TableCell>
                    <TableCell
                      className={
                        d.uuid === sel?.uuid ? 'font-medium' : undefined
                      }
                    >
                      <Link
                        to="/datasets/$datasetId/snapshots"
                        params={{ datasetId: d.uuid }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell>{d.model}</TableCell>
                    <TableCell align="right">{d.rows}</TableCell>
                    <TableCell>
                      <Status tone={v.tone}>{v.label}</Status>
                    </TableCell>
                    <TableCell align="right" className="text-fg-muted">
                      {d.updated}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <MobileList
            label="Datasets"
            items={visible.map((d) => {
              const v = datasetValidation(d)
              return {
                key: d.uuid,
                id: d.id,
                title: d.name,
                sub: `${d.rows} rows · ${d.model}`,
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
                  q
                    ? `No datasets match “${search.q}”`
                    : tab === 'issues'
                      ? 'No datasets have issues'
                      : `No datasets in ${tabLabel[tab].toLowerCase()}`
                }
                body={
                  q
                    ? 'Search looks at ID, name and model.'
                    : 'Datasets appear here when an import or a check puts them in this list.'
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {visible.length} of {counts[tab]}{' '}
          {tab === 'all' ? 'datasets' : tabLabel[tab].toLowerCase()}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector aria-label="Dataset summary" className="w-[300px] gap-0 p-0">
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">{sel.id}</span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            <div className="text-label">
              <Status tone={datasetValidation(sel).tone}>
                {datasetValidation(sel).label}
              </Status>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={80}
                items={[
                  ['Model', sel.model],
                  ['Rows', String(sel.rows)],
                  ['Issues', String(sel.issues)],
                  ['Updated', sel.updated],
                ]}
              />
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}
