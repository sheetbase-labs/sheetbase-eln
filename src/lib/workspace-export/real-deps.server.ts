import { realSessionAuthDeps } from '#/lib/request-auth'

import { defaultBackupDeps } from './backup.server'
import type { WorkspaceExportRouteDeps } from './routes.server'

/** Production wiring for the export byte routes. */
export const realWorkspaceExportDeps: WorkspaceExportRouteDeps = {
  auth: realSessionAuthDeps,
  canManage: async (userId, workspaceId) => {
    const { getScopedClient } = await import('#/lib/admin-platform')
    const session = await getScopedClient(workspaceId, userId)
    try {
      const { rows } = await session.client.query(
        'SELECT api.has_capability($1::uuid, $2) AS ok',
        [workspaceId, 'settings.backups.manage'],
      )
      return rows[0]?.ok === true
    } finally {
      await session.release()
    }
  },
  backup: defaultBackupDeps,
}
