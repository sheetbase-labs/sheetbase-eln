import { createFileRoute } from '@tanstack/react-router'

import { ImportUploadFlow } from '#/components/import/import-flow'

/** Step 1 of the import wizard: choose the target (an existing Dataset or a new
 * one), store the file checksum-first and parse it on the server. */
export const Route = createFileRoute('/import/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { instrument?: string } => ({
    instrument:
      typeof search.instrument === 'string' && search.instrument
        ? search.instrument
        : undefined,
  }),
  component: () => {
    const { context } = Route.useRouteContext()
    const { instrument } = Route.useSearch()
    return (
      <ImportUploadFlow
        workspaceId={context.workspace?.id ?? ''}
        createdByUserId={context.user.id}
        initialInstrumentId={instrument}
      />
    )
  },
})
