import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { SearchTabs } from '#/components/v3/inventory/list'
import { Status } from '#/components/v3/ui/status'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import { isDatasetDetailTab } from '#/components/v3/datasets/dataset-detail-tabs'
import type { DatasetDetailTab } from '#/components/v3/datasets/dataset-detail-tabs'
import { DatasetHistoryTab } from '#/components/v3/datasets/dataset-history-tab'
import { DatasetImportsTab } from '#/components/v3/datasets/dataset-imports-tab'
import { DatasetUsedByTab } from '#/components/v3/datasets/dataset-used-by-tab'
import { notebookDataClient } from '#/lib/notebook-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'

/** UI port (roadmap-4/ui-app3): the dataset detail frame. Rows, Snapshots and
 * Compare are child routes; R5-SURF-01 adds Imports, Used by and History,
 * selected by the `view` search parameter so each is a linkable, reloadable URL
 * without a second route tree. The index child is the Overview screen. */
export const Route = createFileRoute('/datasets/$datasetId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: DatasetDetailTab } => ({
    view: isDatasetDetailTab(search.view) ? search.view : undefined,
  }),
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    await resolveIdentifierParam({
      entity: 'dataset',
      ref: params.datasetId,
      href: location.href,
    })
    return { context }
  },
  component: DatasetLayout,
})

export interface DatasetVersion {
  id: string
  label: string
  createdAt: string
  createdByUserId: string | null
  sourceDatasetRevision: number
  rowCount: number
}

export const datasetVersionsQueryKey = (datasetId: string) =>
  ['ui-port', 'dataset-versions', datasetId] as const

export function useDatasetVersions(datasetId: string) {
  return useQuery({
    queryKey: datasetVersionsQueryKey(datasetId),
    queryFn: () =>
      notebookDataClient.rpc<DatasetVersion[]>('dataset_version_list', {
        p_dataset_id: datasetId,
      }),
  })
}

function DatasetLayout() {
  const { datasetId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const summaries = useDatasetSummaries()
  const versions = useDatasetVersions(datasetId)
  const dataset = summaries.data?.find((d) => d.uuid === datasetId)

  if (!dataset) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/datasets" className="text-link">
              Datasets
            </Link>
          }
          title={summaries.isLoading ? 'Loading dataset…' : 'Dataset not found'}
        />
      </div>
    )
  }

  const params = { datasetId: dataset.uuid }
  // The active section: the child routes from the path, the three data tabs
  // from the search parameter, and the index — whose screen is the Overview —
  // as Overview.
  const section = pathname.split('/').filter(Boolean).pop()
  const current =
    search.view ??
    (section === 'rows' || section === 'snapshots' || section === 'compare'
      ? section
      : 'overview')
  const isRows = current === 'rows'
  const exportable = !dataset.archived && current !== 'compare'
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/datasets" className="text-link">
              Datasets
            </Link>{' '}
            / <span className="mono">{dataset.id}</span>
          </>
        }
        title={dataset.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone={datasetValidation(dataset).tone}>
                {datasetValidation(dataset).label}
              </Status>
            </span>
            <span>Model {dataset.model}</span>
            {dataset.experimentId ? <span>{dataset.experimentId}</span> : null}
            <span>
              Owner{' '}
              {dataset.createdByUserId === context.user.id
                ? context.user.name
                : '—'}
            </span>
          </>
        }
        actions={
          exportable ? (
            <>
              <Button
                nativeButton={false}
                icon="download"
                render={
                  <a
                    href={`/api/export/dataset/${dataset.uuid}?format=csv`}
                    aria-label={`Download ${dataset.name} as CSV`}
                  />
                }
              >
                Download CSV
              </Button>
              {isRows ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to="/analysis/new"
                      search={{ mode: 'analyse', dataset: dataset.uuid }}
                    />
                  }
                >
                  Analyse
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        tabs={
          <SearchTabs
            label="Dataset sections"
            current={current}
            items={[
              {
                key: 'overview',
                label: 'Overview',
                link: { to: '/datasets/$datasetId', params },
              },
              {
                key: 'rows',
                label: 'Data',
                count: dataset.rows,
                link: { to: '/datasets/$datasetId/rows', params },
              },
              {
                key: 'snapshots',
                label: 'Snapshots',
                count: versions.data?.length,
                link: { to: '/datasets/$datasetId/snapshots', params },
              },
              {
                key: 'compare',
                label: 'Compare',
                link: { to: '/datasets/$datasetId/compare', params },
              },
              {
                key: 'imports',
                label: 'Imports',
                link: {
                  to: '/datasets/$datasetId',
                  params,
                  search: { view: 'imports' },
                },
              },
              {
                key: 'used-by',
                label: 'Used by',
                link: {
                  to: '/datasets/$datasetId',
                  params,
                  search: { view: 'used-by' },
                },
              },
              {
                key: 'history',
                label: 'History',
                link: {
                  to: '/datasets/$datasetId',
                  params,
                  search: { view: 'history' },
                },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        {search.view === 'imports' ? (
          <DatasetImportsTab datasetId={dataset.uuid} />
        ) : search.view === 'used-by' ? (
          <DatasetUsedByTab datasetId={dataset.uuid} />
        ) : search.view === 'history' ? (
          <DatasetHistoryTab datasetId={dataset.uuid} />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}

