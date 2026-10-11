import { createFileRoute, redirect } from '@tanstack/react-router'

import { ImportUploadFlow } from '#/components/import/import-flow'

/** DSET-05 / R5-SURF-04 — step 1: choose the target (an existing Dataset or a
 * new one), store the file checksum-first and parse it on the server. The
 * stored file's own route then carries the mapping and check steps. */
export const Route = createFileRoute('/import')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ImportPage,
})

function ImportPage() {
  const { context } = Route.useRouteContext()
  return <ImportUploadFlow workspaceId={context.workspace?.id ?? ''} />
}
