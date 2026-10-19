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
import { Tabs } from '#/components/v3/ui/tabs'
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
import { ObjectLink } from '#/components/v3/ui/object-link'
import { fetchProject, notebookDataClient } from '#/lib/notebook-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

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
      throw redirect(signInRedirect(location))
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
  const projectId = dataset?.projectId ?? null
  const project = useQuery({
    queryKey: ['ui-port', 'dataset-project', projectId ?? ''],
    queryFn: () =>
      projectId ? fetchProject(notebookDataClient, projectId) : null,
    enabled: Boolean(projectId),
  })

  if (!dataset) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Datasets', link: { to: '/datasets' } }]}
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
  const exportable = !dataset.archived && current !== 'compare'
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        // Where the dataset sits: its project and the experiment that made it,
        // then itself; a dataset with neither keeps the Datasets list as root.
        trail={[
          ...(projectId
            ? [
                {
                  label: project.data?.title ?? 'Project',
                  link: {
                    to: '/projects/$projectId' as const,
                    params: { projectId },
                  },
                },
              ]
            : []),
          ...(dataset.experimentId
            ? [
                {
                  label: dataset.experimentId,
                  mono: true,
                  link: {
                    to: '/experiments/$expId' as const,
                    params: { expId: dataset.experimentId },
                  },
                },
              ]
            : []),
          ...(projectId || dataset.experimentId
            ? []
            : [{ label: 'Datasets', link: { to: '/datasets' as const } }]),
          { label: dataset.id, mono: true },
        ]}
        title={dataset.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone={datasetValidation(dataset).tone}>
                {datasetValidation(dataset).label}
              </Status>
            </span>
            <span>Model {dataset.model}</span>
            {dataset.experimentId ? (
              <ObjectLink kind="experiment" identifier={dataset.experimentId} />
            ) : null}
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
              {/* Analyse and Chart open the studio on this dataset from any
                  tab, not only the rows, so the next step is always here. */}
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/analysis/new"
                    search={{
                      mode: 'chart',
                      dataset: dataset.uuid,
                      returnTo: `/datasets/${dataset.uuid}`,
                    }}
                  />
                }
              >
                Chart
              </Button>
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/analysis/new"
                    search={{
                      mode: 'analyse',
                      dataset: dataset.uuid,
                      returnTo: `/datasets/${dataset.uuid}`,
                    }}
                  />
                }
              >
                Analyse
              </Button>
            </>
          ) : undefined
        }
        tabs={
          <Tabs
            mode="url"
            label="Dataset sections"
            value={current}
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
