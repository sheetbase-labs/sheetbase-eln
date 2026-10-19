import { createFileRoute } from '@tanstack/react-router'

import { ImportUploadFlow } from '#/components/import/import-flow'

/** Step 1 of the import wizard: choose the target (an existing Dataset or a new
 * one), store the file checksum-first and parse it on the server. */
export const Route = createFileRoute('/import/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { instrument?: string; experiment?: string; dataset?: string } => {
    const text = (value: unknown) =>
      typeof value === 'string' && value ? value : undefined
    return {
      instrument: text(search.instrument),
      experiment: text(search.experiment),
      dataset: text(search.dataset),
    }
  },
  component: () => {
    const { context } = Route.useRouteContext()
    const { instrument, experiment, dataset } = Route.useSearch()
    return (
      <ImportUploadFlow
        workspaceId={context.workspace?.id ?? ''}
        createdByUserId={context.user.id}
        initialInstrumentId={instrument}
        initialExperimentId={experiment}
        initialDatasetId={dataset}
      />
    )
  },
})
