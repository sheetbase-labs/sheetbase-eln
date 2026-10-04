import { createFileRoute, redirect } from '@tanstack/react-router'

import { ImportFlow } from '#/components/import/import-flow'

/** DSET-05 — the import route: the three-step Stepper (Upload → Map columns →
 * Review and import). Files are stored checksum-first and parsed on the
 * server; commit goes through the canonical Dataset batch writer. */
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
  return <ImportFlow />
}
