import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/export/workspace')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ handleWorkspaceExport }, { realWorkspaceExportDeps }] =
          await Promise.all([
            import('#/lib/workspace-export/routes.server'),
            import('#/lib/workspace-export/real-deps.server'),
          ])

        return handleWorkspaceExport(request, realWorkspaceExportDeps)
      },
    },
  },
})
