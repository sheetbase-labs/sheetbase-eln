import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/export/workspace')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleWorkspaceExport } =
          await import('#/lib/workspace-export/routes.server')
        const { realWorkspaceExportDeps } =
          await import('#/lib/workspace-export/real-deps.server')
        return handleWorkspaceExport(request, realWorkspaceExportDeps)
      },
    },
  },
})
