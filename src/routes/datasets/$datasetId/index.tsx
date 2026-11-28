import { createFileRoute } from '@tanstack/react-router'

import { t } from '#/copy'
import { Muted } from '#/components/ui/layout'
import { useDatasetSummaries } from '#/components/datasets/datasets-data'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import { RelationshipPanel } from '#/components/knowledge/relationship-panel'
import { RecordLineageSection } from '#/components/knowledge/record-lineage-section'
import { SimilarWorkPanel } from '#/components/search/similar-work-panel'

import { DatasetChecks, DatasetFirstRows } from './-overview-parts'

/**
 * R5-SURF-01 — the dataset detail index, which is the Overview screen the
 * Overview tab links to.
 *
 * Imports, Used by and History are selected by the `view` search parameter on
 * the parent dataset detail route (the layout renders the panel and skips this
 * Outlet), so each is a linkable, reloadable URL (`/datasets/<id>?view=imports`).
 */
export const Route = createFileRoute('/datasets/$datasetId/')({
  component: DatasetOverview,
})

function DatasetOverview() {
  const { datasetId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const summaries = useDatasetSummaries()
  const dataset = summaries.data?.find((d) => d.uuid === datasetId)

  if (!dataset) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>
          {summaries.isLoading
            ? t('data.datasetOverview.loadingDataset')
            : t('data.datasetOverview.datasetFound')}
        </Muted>
      </div>
    )
  }

  return (
    <DatasetOverviewPanel
      dataset={dataset}
      workspaceId={context.workspace?.id ?? ''}
    />
  )
}

/**
 * The dataset Overview: a look at its first rows, its checks, and how it
 * relates to the rest of the lab. Its identity and where it came from sit in
 * the header and the side panel.
 */
function DatasetOverviewPanel({
  dataset,
  workspaceId,
}: {
  dataset: DatasetListRow
  workspaceId: string
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-5 md:px-6">
      <DatasetFirstRows dataset={dataset} />
      <DatasetChecks dataset={dataset} />
      <RelationshipPanel recordId={dataset.uuid} />
      <RecordLineageSection recordId={dataset.uuid} />
      <SimilarWorkPanel
        workspaceId={workspaceId}
        objectType="dataset"
        objectId={dataset.uuid}
        identifier={dataset.id}
        title={dataset.name}
      />
    </div>
  )
}
