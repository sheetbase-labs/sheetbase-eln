import { Link } from '@tanstack/react-router'

import { t } from '#/copy'

/**
 * A connector ingest commits through the same import path as an upload, so its
 * rows land on the Dataset and its receipt on that Dataset's Imports tab. The
 * queries it must refresh live in `dataset-landing-refresh.ts`, beside the link
 * that names the tab; both are re-exported here so callers have one import.
 */
export { invalidateDatasetLanding } from './dataset-landing-refresh'

/** Where the rows went: a link to the Dataset's Imports tab, not a bare id. */
export function DatasetLandingLink({ datasetId }: { datasetId: string }) {
  return (
    <Link
      to="/datasets/$datasetId"
      params={{ datasetId }}
      search={{ view: 'imports' }}
      className="text-link underline"
    >
      {t('settings.integrations.datasetLanding.openDatasetImport')}
    </Link>
  )
}
