import { createServerFn } from '@tanstack/react-start'

import type { DemoPersona } from '#/lib/demo-persona'

/**
 * The people the demo can be viewed as: the members of the workspace the
 * visitor is in. Empty outside auth-free mode, so a real deployment never
 * lists anyone.
 */
export const listDemoPersonasFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DemoPersona[]> => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { isDevAuthFreeEnabled } = await import('#/lib/auth')
    if (!isDevAuthFreeEnabled()) return []
    const { getCurrentContext } = await import('#/lib/current-user')
    const context = await getCurrentContext(getRequestHeaders())
    if (!context?.workspace) return []
    const { and, eq, isNull } = await import('drizzle-orm')
    const { db } = await import('#/db/client.server')
    const { user, workspaceMemberships } = await import('#/db/schema')
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        role: workspaceMemberships.role,
      })
      .from(workspaceMemberships)
      .innerJoin(user, eq(user.id, workspaceMemberships.userId))
      .where(
        and(
          eq(workspaceMemberships.workspaceId, context.workspace.id),
          isNull(workspaceMemberships.suspendedAt),
        ),
      )
    // The team first, the client's people after, each by name.
    const isClient = (role: string) => (role === 'client_viewer' ? 1 : 0)
    return rows.sort(
      (a, b) =>
        isClient(a.role) - isClient(b.role) || a.name.localeCompare(b.name),
    )
  },
)
