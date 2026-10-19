import { Link } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import { datasetListQueryKeys } from '#/components/v3/datasets/datasets-data'
import { importQueryKeys } from '#/lib/import/data'

/**
 * A connector ingest commits through the same import path as an upload, so its
 * rows land on the Dataset and its receipt on that Dataset's Imports tab. These
 * are the queries that must refresh for the Dataset to show them.
 */
export function invalidateDatasetLanding(
  queryClient: QueryClient,
  datasetId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['datasets'] })
  void queryClient.invalidateQueries({ queryKey: datasetListQueryKeys.page })
  void queryClient.invalidateQueries({
    queryKey: importQueryKeys.imports(datasetId),
  })
}

/** Where the rows went: a link to the Dataset's Imports tab, not a bare id. */
export function DatasetLandingLink({ datasetId }: { datasetId: string }) {
  return (
    <Link
      to="/datasets/$datasetId"
      params={{ datasetId }}
      search={{ view: 'imports' }}
      className="text-link underline"
    >
      Open the Dataset and its import receipt
    </Link>
  )
}
