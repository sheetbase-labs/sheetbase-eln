import { createFileRoute } from '@tanstack/react-router'

import { ImportUploadFlow } from '#/components/import/import-flow'

/** Step 1 of the import wizard: choose the target (an existing Dataset or a new
 * one), store the file checksum-first and parse it on the server. */
export const Route = createFileRoute('/import/')({
  component: () => {
    const { context } = Route.useRouteContext()
    return (
      <ImportUploadFlow
        workspaceId={context.workspace?.id ?? ''}
        createdByUserId={context.user.id}
      />
    )
  },
})
