import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Status } from '#/components/v3/ui/status'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the dataset detail frame. Snapshots is ported;
 * Rows and Compare follow. */
export const Route = createFileRoute('/datasets/$datasetId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
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
            <span>{dataset.rows} rows</span>
          </>
        }
        tabs={
          <LinkTabs
            tabs={[
              {
                label: 'Overview',
                link: { to: '/datasets/$datasetId', params },
              },
              {
                label: 'Data',
                link: { to: '/datasets/$datasetId/rows', params },
              },
              {
                label: 'Snapshots',
                count: versions.data?.length,
                link: { to: '/datasets/$datasetId/snapshots', params },
              },
              {
                label: 'Compare',
                link: { to: '/datasets/$datasetId/compare', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
