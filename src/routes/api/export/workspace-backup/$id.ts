import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/export/workspace-backup/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handleBackupDownload } =
          await import('#/lib/workspace-export/routes.server')
        const { realWorkspaceExportDeps } =
          await import('#/lib/workspace-export/real-deps.server')
        return handleBackupDownload(request, params.id, realWorkspaceExportDeps)
      },
    },
  },
})
