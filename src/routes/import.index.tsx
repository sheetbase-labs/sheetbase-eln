import { createFileRoute } from '@tanstack/react-router'

import { ImportUploadFlow } from '#/components/import/import-flow'
import { parseCreateContext } from '#/lib/create-context-search'

/** Step 1 of the import wizard: choose the target (an existing Dataset or a new
 * one), store the file checksum-first and parse it on the server. */
export const Route = createFileRoute('/import/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    instrument?: string
    experiment?: string
    dataset?: string
    project?: string
    returnTo?: string
  } => {
    const text = (value: unknown) =>
      typeof value === 'string' && value ? value : undefined
    // The shared create-context params (project, experiment, dataset,
    // returnTo) travel with the instrument this screen also takes.
    const { project, experiment, dataset, returnTo } =
      parseCreateContext(search)
    return {
      instrument: text(search.instrument),
      experiment,
      dataset,
      project,
      returnTo,
    }
  },
  component: () => {
    const { context } = Route.useRouteContext()
    const { instrument, experiment, dataset, project, returnTo } =
      Route.useSearch()
    return (
      <ImportUploadFlow
        workspaceId={context.workspace?.id ?? ''}
        createdByUserId={context.user.id}
        initialInstrumentId={instrument}
        initialExperimentId={experiment}
        initialDatasetId={dataset}
        initialProjectId={project}
        returnTo={returnTo}
      />
    )
  },
})
