import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { ImportUploadFlow } from '#/components/import/import-flow'
import { parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'

/** What the import wizard reads from the URL: the shared create context plus
 * the instrument the file is being uploaded from. */
interface ImportSearch extends CreateContextSearch {
  instrument?: string
}

/** The instrument the wizard was opened from; anything else reads as absent. */
const IMPORT_SEARCH = z.object({ instrument: z.string().min(1).optional() })

/** Step 1 of the import wizard: choose the target (an existing Dataset or a new
 * one), store the file checksum-first and parse it on the server. */
export const Route = createFileRoute('/import/')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; IMPORT_SEARCH and parseCreateContext decode every key this route reads.
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    // The shared create-context params (project, experiment, dataset,
    // returnTo) travel with the instrument this screen also takes.
    ...parseCreateContext(search),
    instrument: IMPORT_SEARCH.catch({}).parse(search).instrument,
  }),

  component: ImportRoute,
})

function ImportRoute() {
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
}
