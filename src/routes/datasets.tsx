import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ObjectLink } from '#/components/ui/object-link'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { t } from '#/copy'
import { Status } from '#/components/ui/status'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/projects/project-access'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { datasetPath } from '#/lib/navigation'
import {
  ListHeader,
  ReadOnlyNote,
  ListToolbar,
  MobileList,
} from '#/components/inventory/list'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { OnChangeFn, RowSelectionState } from '@tanstack/react-table'
import { Tabs } from '#/components/ui/tabs'
import { DatasetInspector } from '#/components/datasets/dataset-inspector'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/datasets/datasets-data'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import { useHasCapability } from '#/lib/use-capability'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useListView } from '#/lib/list-views'
import { formatDate } from '#/lib/format-date'

const tabs = ['all', 'mine', 'issues', 'locked', 'archived'] as const

type DatasetTab = (typeof tabs)[number]

/** Whether a dataset belongs in a list tab, for the person signed in. */
function inDatasetTab(
  row: DatasetListRow,
  tabId: DatasetTab,
  userId: string,
): boolean {
  // An archived dataset is out of every working list.
  if (tabId === 'archived') return row.archived

  if (row.archived) return false

  if (tabId === 'all') return true

  if (tabId === 'mine') return row.createdByUserId === userId

  if (tabId === 'issues') return row.issues > 0

  return row.reviewState === 'locked'
}

/** What the registry reads from the URL. */
interface DatasetsSearch {
  q?: string
  tab?: DatasetTab | 'pipelines' | 'versions'
  dataset?: string
  archived?: boolean
}

/** The registry's search parameters; a value the URL cannot express reads as absent. */
const DATASETS_SEARCH = z.object({
  q: z.string().optional().catch(undefined),
  dataset: z.string().optional().catch(undefined),
  archived: z
    .union([z.literal(true), z.literal('1')])
    .optional()
    .transform((value) => (value === undefined ? undefined : true))
    .catch(undefined),
  tab: z
    .enum([
      'all',
      'mine',
      'issues',
      'locked',
      'archived',
      'pipelines',
      'versions',
    ])
    .optional()
    .catch(undefined),
})

const tabLabel: Record<DatasetTab, string> = {
  all: t('data.datasetsList.all'),
  mine: t('data.datasetsList.mine'),
  issues: t('data.datasetsList.hasIssues'),
  locked: t('data.datasetsList.locked'),
  archived: t('data.datasetsList.archived'),
}

/** UI port (roadmap-4/ui-app3): the dataset registry list, wired to
 * dataset_list_summary. The explorer/rows/snapshots/compare child routes and
 * the import flow follow. */
export const Route = createFileRoute('/datasets')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; DATASETS_SEARCH decodes every key this route reads.
  validateSearch: (search: Record<string, unknown>): DatasetsSearch => {
    const parsed = DATASETS_SEARCH.safeParse(search)

    return parsed.success ? parsed.data : {}
  },
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
  const canImport = useHasCapability('record.create')
  const canConnect = useHasCapability('instrument.manage')
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const openDataset = useOpenRow<DatasetListRow>(
    navigate,
    (row) => datasetPath(row.uuid),
    (row) => row.name,
  )

  const query = useDatasetSummaries()
  const rows = useMemo(() => query.data ?? [], [query.data])

  const tab: DatasetTab =
    search.tab === 'mine' ||
    search.tab === 'issues' ||
    search.tab === 'locked' ||
    search.tab === 'archived'
      ? search.tab
      : 'all'

  const [selected, setSelected] = useState<string | null>(null)
  const view = useListView('datasets')

  const userId = context.user.id

  const counts = useMemo(() => {
    const counted: Record<DatasetTab, number> = {
      all: 0,
      mine: 0,
      issues: 0,
      locked: 0,
      archived: 0,
    }

    for (const tabId of tabs) {
      counted[tabId] = rows.filter((r) => inDatasetTab(r, tabId, userId)).length
    }

    return counted
  }, [rows, userId])

  // Most recently updated first, until a column header is clicked.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [rows],
  )

  const q = (search.q ?? '').trim().toLowerCase()
  const hasProjectAccess = useHasProjectAccess()

  const visible = sorted
    .filter((r) => inDatasetTab(r, tab, userId))
    .filter(
      (r) =>
        !q || [r.id, r.name, r.model].some((v) => v.toLowerCase().includes(q)),
    )

  const columns = useMemo<RegistryColumn<DatasetListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        accessorFn: (d) => d.id,
        enableHiding: false,
        cell: ({ row }) => (
          <ObjectLink
            kind="dataset"
            id={row.original.uuid}
            identifier={row.original.id}
          />
        ),
      },
      {
        id: 'name',
        header: t('data.datasetsList.name'),
        accessorFn: (d) => d.name,
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
      {
        id: 'model',
        header: t('data.datasetsList.model'),
        accessorFn: (d) => d.model,
      },
      {
        id: 'experiment',
        header: t('data.datasetsList.experiment'),
        accessorFn: (d) => d.experimentId ?? undefined,
        cell: ({ row }) =>
          row.original.experimentId ? (
            <ObjectLink
              kind="experiment"
              identifier={row.original.experimentId}
            />
          ) : (
            <span className="mono">—</span>
          ),
      },
      {
        id: 'rows',
        header: t('data.datasetsList.rows'),
        accessorFn: (d) => d.rows,
        meta: rightAligned<DatasetListRow>().meta,
      },
      {
        id: 'updated',
        header: t('data.datasetsList.updated'),
        accessorFn: (d) => d.updatedAt,
        cell: ({ row }) => formatDate(row.original.updatedAt),
        meta: { exportValue: (d: DatasetListRow) => d.updated },
      },
      {
        id: 'validation',
        header: t('data.datasetsList.validation'),
        accessorFn: (d) => datasetValidation(d).label,
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
        <DatasetListHeader
          canConnect={canConnect}
          canImport={canImport}
          tab={tab}
          q={search.q}
          total={query.isPending ? undefined : rows.length}
          counts={query.isPending ? undefined : counts}
        />
        <DatasetSearchBar
          q={search.q}
          onSearch={(next) =>
            void navigate({
              to: '/datasets',
              search: (state) => ({ ...state, q: next || undefined }),
              replace: true,
            })
          }
        />
        <DatasetResults
          query={query}
          rows={rows}
          visible={visible}
          columns={columns}
          view={view}
          tab={tab}
          q={q}
          selected={selected}
          hasProjectAccess={hasProjectAccess}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          openDataset={openDataset}
        />
      </div>
      {selectedRow ? <DatasetInspector dataset={selectedRow} /> : null}
    </div>
  )
}

/** The list header: what the registry holds, its tabs and the create actions. */
function DatasetListHeader({
  canConnect,
  canImport,
  tab,
  q,
  total,
  counts,
}: {
  canConnect: boolean
  canImport: boolean
  tab: DatasetTab
  q?: string
  total?: number
  counts?: Record<DatasetTab, number>
}) {
  return (
    <ListHeader
      title={t('data.datasetsList.datasets')}
      total={total}
      actions={
        <>
          {canConnect ? (
            <Button
              nativeButton={false}
              render={<Link to="/settings/lab/instruments" />}
            >
              {t('data.datasetsList.connectInstrument')}
            </Button>
          ) : null}
          {canImport ? (
            <Button
              variant="primary"
              icon="upload"
              nativeButton={false}
              render={<Link to="/import" />}
            >
              {t('data.datasetsList.importData')}
            </Button>
          ) : (
            <ReadOnlyNote>
              {t('common.readOnly.cannotAdd', {
                things: t('common.readOnly.things.datasets'),
              })}
            </ReadOnlyNote>
          )}
        </>
      }
      tabs={
        <Tabs
          mode="url"
          label={t('data.datasetsList.datasetLists')}
          value={tab}
          items={tabs.map((tabId) => ({
            key: tabId,
            label: tabLabel[tabId],
            count: counts?.[tabId],
            link: {
              to: '/datasets',
              search: {
                tab: tabId === 'all' ? undefined : tabId,
                q,
              },
            },
          }))}
        />
      }
    />
  )
}

/** The search box; typing rewrites the `q` parameter in place. */
function DatasetSearchBar({
  q,
  onSearch,
}: {
  q?: string
  onSearch: (next: string) => void
}) {
  return (
    <ListToolbar
      q={q}
      label={t('data.datasetsList.searchDatasets')}
      placeholder={t('data.datasetsList.searchDatasets')}
      onSearch={onSearch}
    />
  )
}

/** The registry itself: the grid, the phone list, and the empty state. */
function DatasetResults({
  query,
  rows,
  visible,
  columns,
  view,
  tab,
  q,
  selected,
  hasProjectAccess,
  rowSelection,
  onRowSelectionChange,
  openDataset,
}: {
  query: ReturnType<typeof useDatasetSummaries>
  rows: DatasetListRow[]
  visible: DatasetListRow[]
  columns: RegistryColumn<DatasetListRow>[]
  view: ReturnType<typeof useListView>
  tab: DatasetTab
  q: string
  selected: string | null
  hasProjectAccess: boolean | undefined
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  openDataset: (row: DatasetListRow, event?: React.MouseEvent) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {query.isPending || visible.length > 0 ? (
        <RegistryGrid
          className="max-md:hidden"
          label={t('data.datasetsList.datasets')}
          view={view}
          rows={visible}
          columns={columns}
          getRowId={(d) => d.uuid}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          onRowClick={openDataset}
          isLoading={query.isPending}
        />
      ) : null}
      <MobileList
        label={t('data.datasetsList.datasets')}
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
      {!query.isPending && visible.length === 0 && rows.length >= 0 ? (
        <div role="status" className="flex justify-center px-6">
          <NoDatasets q={q} tab={tab} hasProjectAccess={hasProjectAccess} />
        </div>
      ) : null}
    </div>
  )
}

/** The words an empty registry shows: a title and the line under it. */
interface EmptyCopy {
  title: string
  description: string
}

/** What an empty registry says, given the filter and the person's access. */
function noDatasetsCopy(
  q: string,
  tab: DatasetTab,
  hasProjectAccess: boolean | undefined,
): EmptyCopy {
  if (hasProjectAccess === false) {
    return {
      title: noProjectAccessTitle('datasets'),
      description: NO_PROJECT_ACCESS_BODY,
    }
  }

  if (q) {
    return {
      title: t('data.datasetsList.datasetsMatch', { q }),
      description: t('data.datasetsList.searchLooksIdName'),
    }
  }

  if (tab === 'issues') {
    return {
      title: t('data.datasetsList.datasetsHaveIssues'),
      description: t('data.datasetsList.datasetsAppearHereWhen'),
    }
  }

  return {
    title:
      tab === 'all'
        ? t('data.datasetsList.noDatasetsYet')
        : t('data.datasetsList.noDatasetsIn', { tab: tabLabel[tab] }),
    description: t('data.datasetsList.datasetsAppearHereWhen'),
  }
}

/** The way out of an empty registry: clear the search, or import a file. */
function EmptyDatasetsAction({
  q,
  tab,
  hasProjectAccess,
}: {
  q: string
  tab: DatasetTab
  hasProjectAccess: boolean | undefined
}) {
  if (hasProjectAccess === false) return undefined

  if (q || tab !== 'all') {
    return (
      <Button
        nativeButton={false}
        render={
          <Link
            to="/datasets"
            search={{ q: undefined, tab: q ? tab : undefined }}
          />
        }
      >
        {q
          ? t('data.datasetsList.clearSearch')
          : t('data.datasetsList.showAllDatasets')}
      </Button>
    )
  }

  return (
    <Button nativeButton={false} render={<Link to="/import" />}>
      {t('data.datasetsList.importAFile')}
    </Button>
  )
}

/** Why the registry is empty, and the way out of it. */
function NoDatasets({
  q,
  tab,
  hasProjectAccess,
}: {
  q: string
  tab: DatasetTab
  hasProjectAccess: boolean | undefined
}) {
  const copy = noDatasetsCopy(q, tab, hasProjectAccess)

  return (
    <EmptyState
      icon={q ? 'search' : 'table'}
      className="items-center py-14 text-center"
      title={copy.title}
      description={copy.description}
      action={
        <EmptyDatasetsAction
          q={q}
          tab={tab}
          hasProjectAccess={hasProjectAccess}
        />
      }
    />
  )
}
