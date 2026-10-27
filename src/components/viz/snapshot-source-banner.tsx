/**
 * Says that a chart or analysis is reading a snapshot, not the live rows, and
 * offers the way back. A snapshot is fixed: the figure on screen will not move
 * when the dataset does, which is the reason to choose one and the thing a
 * reader must not have to guess.
 */
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { sciDataClient } from '#/lib/chart-data'
import { listDatasetVersionSummaries } from '#/lib/dataset-explorer-data'
import { formatDate } from '#/lib/format-date'

export function SnapshotSourceBanner({
  datasetId,
  datasetVersionId,
  onUseLive,
}: {
  datasetId: string
  datasetVersionId: string
  onUseLive: () => void
}) {
  const versions = useQuery({
    queryKey: ['dataset-version-summaries', datasetId],
    queryFn: () => listDatasetVersionSummaries(sciDataClient, datasetId),
    staleTime: 30_000,
  })
  const version = versions.data?.find((v) => v.id === datasetVersionId)
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-fg/[0.04] px-3 py-1.5 text-sm"
    >
      <span className="text-fg">
        Reading snapshot{' '}
        <strong className="font-medium">
          {version?.label ?? 'of this dataset'}
        </strong>
        {version
          ? ` (${version.rowCount} rows, ${formatDate(version.createdAt)})`
          : ''}
        . These rows do not change when the dataset does. All snapshot values
        are included; flags do not exclude rows.
      </span>
      <Button type="button" size="sm" variant="quiet" onClick={onUseLive}>
        Use live data
      </Button>
    </div>
  )
}
